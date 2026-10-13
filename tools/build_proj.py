#!/usr/bin/env python3
"""Role Watch: who is getting more (or less) of his team's work than the drafts expected, week by week.

    python3 tools/build_proj.py [--data data] [--current 2026] [--check]

Reads the season files build_fb.py wrote (data/fb-<y>.js), the search index (draft round, birth date) and the preseason
PPR ADP snapshots in data/adp/ppr-<y>.json (Fantasy Football Calculator's last days before Week 1; the workflow saves this
season's before its first game and never overwrites it once games are played). Writes data/proj-<y>.js for every season.

Two groups, one share each, always in the games he played:
  RB     his carries + targets over his team's running backs' carries + targets
  WR/TE  his targets over his team's targets
For each player and each week K of the season:
  mk    the market's preseason share: a fit of share on ADP alone (his ADP, his rank among his team's same-group players,
        the best two teammates' ADP) -- what the drafts implied
  pre   the model's preseason share: the market fit plus what last season and the draft say (his share and games last
        year, rookie / round, age; for a back, the share and draft round of the best-drafted teammate)
  td    share to date (weeks 1..K), l3 his last three games, g games to date
  proj  rest-of-season share = a + b * td + c * l3 + d * pre, weights fitted per group and per K on the other seasons
  pts   rest-of-season PPR points a game, the same way from points to date and the preseason points fit
Past seasons are scored leave-one-season-out (that season never fits its own weights), so a 2024 flag is what the board
would have said in 2024. A season without a preseason ADP snapshot (2026: the snapshot service only serves the last week)
has no market column; its preseason line is the model without ADP.
"""
import argparse, json, math, os, re, collections, datetime as dt
import numpy as np

TMAP = {"LAR": "LA", "JAC": "JAX", "WSH": "WAS", "OAK": "LV", "SD": "LAC", "STL": "LA", "ARZ": "ARI"}
GROUP = {"RB": "RB", "FB": "RB", "WR": "WR", "TE": "WR"}
KMAX = 12          # weeks past 12 reuse week 12's weights
FIRST = 2017       # the first season with a season before it to learn from


def jsload(path):
    s = open(path).read()
    i = s.find("]=")   # "window.FB=window.FB||{};window.FB[2025]={…}" or "window.FB_INDEX={…}"
    return json.loads(s[(i + 2) if i >= 0 else (s.index("=") + 1):].rstrip().rstrip(";"))


def norm(n):
    n = n.lower().replace(".", "").replace("'", "").replace("-", " ")
    n = re.sub(r"\b(jr|sr|ii|iii|iv|v)\b", "", n)
    return re.sub(r"\s+", " ", n).strip()


class Season:
    """One season's players with their weekly rows, and the team-week totals each share is taken against."""
    def __init__(self, y, d):
        self.y = y
        F = d["meta"]["wfields"]; ix = {k: i for i, k in enumerate(F)}
        self.through = d["meta"].get("through") or 18
        self.P = {p["id"]: p for p in d["players"]}
        rb = collections.Counter(); tg = collections.Counter()
        self.rows = {}
        for p in d["players"]:
            W = []
            for r in p["w"]:
                tm, wk = r[ix["tm"]], r[ix["wk"]]
                car, tgt = r[ix["car"]] or 0, r[ix["tgt"]] or 0
                W.append((wk, tm, car, tgt, r[ix["fp"]] or 0.0))
                tg[(tm, wk)] += tgt
                if GROUP.get(p["pos"]) == "RB":
                    rb[(tm, wk)] += car + tgt
            self.rows[p["id"]] = sorted(W)
        self.rb, self.tg = rb, tg

    def share(self, pid, lo=1, hi=99):
        """(share %, games, PPR points a game) over weeks lo..hi, his team's totals in the same games."""
        p = self.P.get(pid)
        if not p:
            return None, 0, None
        g = GROUP.get(p["pos"]); a = b = n = 0; fp = 0.0
        for wk, tm, car, tgt, f in self.rows[pid]:
            if lo <= wk <= hi:
                n += 1; fp += f
                if g == "RB":
                    a += car + tgt; b += self.rb[(tm, wk)]
                else:
                    a += tgt; b += self.tg[(tm, wk)]
        return (100.0 * a / b if b else None), n, (fp / n if n else None)

    def last(self, pid, K, n=3):
        """His share over his last n games up to week K."""
        wks = [w[0] for w in self.rows.get(pid, []) if w[0] <= K][-n:]
        return self.share(pid, wks[0], K)[0] if wks else None


def adp_list(path, S, IDX, byname):
    """The ADP snapshot matched to player ids: {id: adp}. A name must match one player at the position; ties go to the
    one on that team this season."""
    if not os.path.exists(path):
        return None
    d = json.load(open(path)); out = {}
    for p in d.get("players", []):
        pos = p["position"]
        if pos not in ("RB", "WR", "TE"):
            continue
        tm = TMAP.get(p["team"], p["team"]); c = byname.get((norm(p["name"]), pos), [])
        if len(c) > 1:
            c = [i for i in c if S.y in IDX[i]["s"] or S.y - 1 in IDX[i]["s"]] or c
        if len(c) > 1:
            c = [i for i in c if (S.P.get(i) or {}).get("tm") == tm] or c[:0]
        if len(c) == 1:
            out[c[0]] = p["adp"]
    return out


def ols(X, Y, lam=0.0):
    mu = X.mean(0); sd = X.std(0) + 1e-9
    A = np.c_[np.ones(len(X)), (X - mu) / sd]
    b = np.linalg.solve(A.T @ A + lam * np.diag([0] + [1] * X.shape[1]), A.T @ Y)
    return lambda Z: np.c_[np.ones(len(Z)), (Z - mu) / sd] @ b


MKT = ["ladp", "teamrk", "m1", "m2", "te"]
OWN = ["psh", "pg", "pfpg", "rook", "rnd", "age", "newtm", "msh", "mrook", "mrnd"]


def features(S, prev, IDX, adp):
    """Preseason features for everyone with a role this season (or drafted for one)."""
    out = {}
    ids = {pid for pid, p in S.P.items() if GROUP.get(p["pos"])}
    if adp:
        ids |= {i for i in adp if i in IDX and GROUP.get(IDX[i]["pos"])}
    team = collections.defaultdict(list)
    for pid in ids:
        p = S.P.get(pid) or {}
        tm = p.get("tm") or (prev.P.get(pid) or {}).get("tm") if prev else p.get("tm")
        g = GROUP.get((p or {}).get("pos") or IDX.get(pid, {}).get("pos"))
        if tm and g:
            team[(tm, g)].append(pid)
    for (tm, g), L in team.items():
        A = {i: (adp or {}).get(i, 250.0) for i in L}
        for pid in L:
            e = IDX.get(pid, {}); dr = e.get("dr")
            rook = int(bool(dr and dr[0] == S.y))
            mates = sorted([i for i in L if i != pid], key=lambda i: A[i])
            ps, pg, pf = prev.share(pid) if prev else (None, 0, None)
            m = mates[0] if mates else None
            ms = prev.share(m)[0] if (prev and m) else None
            mdr = IDX.get(m, {}).get("dr") if m else None
            bd = e.get("bd"); age = (dt.date(S.y, 9, 1) - dt.date.fromisoformat(bd)).days / 365.25 if bd else 26.0
            out[pid] = dict(tm=tm, g=g, adp=(adp or {}).get(pid),
                            ladp=math.log(A[pid]), teamrk=1 + sum(A[i] < A[pid] for i in mates),
                            m1=math.log(A[mates[0]]) if mates else math.log(250), m2=math.log(A[mates[1]]) if len(mates) > 1 else math.log(250),
                            te=int(e.get("pos") == "TE"), psh=ps or 0.0, pg=pg, pfpg=pf or 0.0, rook=rook,
                            rnd=(dr[1] or 8) if dr else 8, age=age,
                            newtm=int(bool(prev and (prev.P.get(pid) or {}).get("tm") not in (None, tm))),
                            msh=ms or 0.0, mrook=int(bool(mdr and mdr[0] == S.y)), mrnd=(mdr[1] or 8) if mdr else 8)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="data")
    ap.add_argument("--current", type=int, default=None)
    ap.add_argument("--check", action="store_true", help="print the backtest numbers")
    a = ap.parse_args()
    IDX = jsload(os.path.join(a.data, "index.js"))
    byname = collections.defaultdict(list)
    for pid, e in IDX.items():
        byname[(norm(e["n"]), "RB" if e["pos"] == "FB" else e["pos"])].append(pid)
    yrs = sorted(int(f[3:7]) for f in os.listdir(a.data) if re.fullmatch(r"fb-\d{4}\.js", f))
    cur = a.current or yrs[-1]
    SE = {y: Season(y, jsload(os.path.join(a.data, f"fb-{y}.js"))) for y in yrs}
    ADP = {y: adp_list(os.path.join(a.data, "adp", f"ppr-{y}.json"), SE[y], IDX, byname) for y in yrs}
    FE = {y: features(SE[y], SE.get(y - 1), IDX, ADP[y]) for y in yrs if y >= FIRST}

    # ---- preseason fits: full-season share and points a game, 4+ games, by group ----
    pre = {}   # (y, pid) -> dict(mk, pre, own, mkp, prep)
    for g in ("RB", "WR"):
        rows = []
        for y in FE:
            if y == cur:
                continue
            for pid, f in FE[y].items():
                if f["g"] != g:
                    continue
                sh, n, fp = SE[y].share(pid)
                if sh is not None and n >= 4:
                    rows.append((y, pid, f, sh, fp))
        def fitset(keys, tgt, excl):
            tr = [r for r in rows if r[0] != excl and (ADP[r[0]] is not None or "ladp" not in keys)]
            X = np.array([[r[2][k] for k in keys] for r in tr], float)
            Y = np.array([r[3] if tgt == "sh" else r[4] for r in tr])
            return ols(X, Y, lam=2.0)
        for y in FE:
            has = ADP[y] is not None
            fm = fitset(MKT, "sh", y) if has else None; ff = fitset(MKT + OWN, "sh", y) if has else None
            fo = fitset(OWN, "sh", y)
            pm = fitset(MKT, "fp", y) if has else None; pf = fitset(MKT + OWN, "fp", y) if has else None
            po = fitset(OWN, "fp", y)
            L = [(pid, f) for pid, f in FE[y].items() if f["g"] == g]
            if not L:
                continue
            Xo = np.array([[f[k] for k in OWN] for _, f in L], float)
            own, ownp = fo(Xo), po(Xo)
            if has:
                Xm = np.array([[f[k] for k in MKT] for _, f in L], float); Xf = np.array([[f[k] for k in MKT + OWN] for _, f in L], float)
                mk, full, mkp, fullp = fm(Xm), ff(Xf), pm(Xm), pf(Xf)
            for i, (pid, f) in enumerate(L):
                pre[(y, pid)] = dict(mk=float(mk[i]) if has else None, pre=float(full[i] if has else own[i]),
                                     mkp=float(mkp[i]) if has else None, prep=float(fullp[i] if has else ownp[i]))

    # ---- in-season blend: rest-of-season share and points from to-date, last three and preseason, per group and week ----
    def samples(g, K, excl):
        out = []
        for y in FE:
            if y in (excl, cur):
                continue
            for pid, f in FE[y].items():
                if f["g"] != g or (y, pid) not in pre:
                    continue
                td, n, tf = SE[y].share(pid, 1, K); rest, n2, rf = SE[y].share(pid, K + 1, 99)
                if td is None or rest is None or n < 1 or n2 < 3:
                    continue
                l3 = SE[y].last(pid, K)
                out.append((td, l3 if l3 is not None else td, pre[(y, pid)]["pre"], rest, tf, pre[(y, pid)]["prep"], rf))
        return np.array(out) if out else None
    W = {}
    def weights(g, K, excl):
        key = (g, min(K, KMAX), excl)
        if key not in W:
            s = samples(g, min(K, KMAX), excl)
            sh = ols(s[:, [0, 1, 2]], s[:, 3], lam=1.0); pt = ols(s[:, [4, 5]], s[:, 6], lam=1.0)
            W[key] = (sh, pt)
        return W[key]

    # ---- output: one file per season ----
    for y in FE:
        S = SE[y]; last = max([w[0] for L in S.rows.values() for w in L] or [0])
        out = []
        for pid, f in FE[y].items():
            if (y, pid) not in pre:
                continue
            p = S.P.get(pid); e = IDX.get(pid, {})
            if not p and f["adp"] is None:
                continue
            fsh, fn, ffp = S.share(pid)
            if not p or not fn:
                continue
            wk = []
            for K in range(1, last + 1):
                td, n, tf = S.share(pid, 1, K)
                if td is None or n == 0:
                    continue
                l3 = S.last(pid, K)
                excl = y if y != cur else None
                sh, pt = weights(f["g"], K, excl)
                pr = pre[(y, pid)]
                proj = float(sh(np.array([[td, l3 if l3 is not None else td, pr["pre"]]]))[0])
                pts = float(pt(np.array([[tf, pr["prep"]]]))[0])
                rest, n2, rf = S.share(pid, K + 1, 99)
                wk.append([K, round(td, 1), round(l3, 1) if l3 is not None else None, n, round(proj, 1), round(pts, 1),
                           round(rest, 1) if (rest is not None and n2 >= 3) else None, round(rf, 1) if (rf is not None and n2 >= 3) else None])
            if not wk:
                continue
            pr = pre[(y, pid)]
            out.append(dict(id=pid, n=e.get("n") or p.get("n"), pos=p.get("pos"), g=f["g"], tm=f["tm"],
                            adp=round(f["adp"], 1) if f["adp"] else None,
                            mk=round(pr["mk"], 1) if pr["mk"] is not None else None, pre=round(pr["pre"], 1),
                            mkp=round(pr["mkp"], 1) if pr["mkp"] is not None else None, prep=round(pr["prep"], 1),
                            fin=round(fsh, 1) if fsh is not None else None, w=wk))
        meta = dict(season=y, through=S.through, weeks=last, market=ADP[y] is not None,
                    wfields=["k", "td", "l3", "g", "proj", "pts", "rest", "restpts"], built=dt.datetime.now().strftime("%Y-%m-%d %H:%M"))
        with open(os.path.join(a.data, f"proj-{y}.js"), "w") as fh:
            fh.write(f"window.FBP=window.FBP||{{}};window.FBP[{y}]=" + json.dumps(dict(meta=meta, rows=out), separators=(",", ":")) + ";\n")
        print(f"  wrote proj-{y}.js: {len(out)} players, through week {last}")

    if a.check:   # the backtest: held-out preseason fits and week-3 flags against the market
        for g in ("RB", "WR"):
            for K in (2, 3, 4):
                R = []
                for y in FE:
                    if y == cur or ADP[y] is None:
                        continue
                    d = jsload(os.path.join(a.data, f"proj-{y}.js"))["rows"]
                    for r in d:
                        if r["g"] != g or r["mk"] is None:
                            continue
                        w = next((x for x in r["w"] if x[0] == K), None)
                        if w and w[6] is not None:
                            R.append((r["mk"], r["pre"], w[1], w[4], w[6]))
                R = np.array(R); mk, prer, td, proj, rest = R.T
                big = (rest - mk) >= (15 if g == "RB" else 5); fl = (proj - mk) >= (10 if g == "RB" else 4)
                print(f"{g} week {K}: n {len(R)} | rest-of-season r: market {np.corrcoef(mk, rest)[0,1]:.3f}, preseason model {np.corrcoef(prer, rest)[0,1]:.3f}, "
                      f"to date {np.corrcoef(td, rest)[0,1]:.3f}, projection {np.corrcoef(proj, rest)[0,1]:.3f} | flagged {fl.sum()}: {np.mean(big[fl]):.0%} big misses "
                      f"(base {np.mean(big):.0%}), beat the market by {np.mean((rest - mk)[fl]):+.1f}")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Sean's football site: the projection models -> data/ros.js.

    python3 tools/build_ros.py [--cache .cache/fb] [--data data] [--current 2026] [--study]

(6 Nov 2026; Sean: "My goal is basically to be able to get some sort of model that projects players as accurate as possible, can you do
so for each position using literally every input that is possible".) Two gradient-boosted models a position (QB, RB, WR, TE): a player's
**rest-of-season PPR points a game** and his **next game's points**, from everything known after any week of a season — his points and
expected points to date, lately and last game; every usage share and rate the play-by-play gives (snaps, targets, air yards, carries,
red-zone, goal-line, end-zone and deep looks, weighted opportunity); efficiency (catch rate and YAC over expected, yards per target / carry,
EPA, TD rate); a QB's passing line (attempts, EPA, CPOE, sacks, air yards, scrambles); his last two seasons; age, draft capital, years in the
league, size; his team (Vegas implied totals, plays, pass rate, points, EPA, its QB's EPA for a pass catcher); his schedule (the next game's
implied total and home / away, the next and remaining opponents' matchup factors); and Role Watch's preseason line and projections.
Every row is a snapshot after week K using weeks <= K only, so nothing from the future leaks in; each season is scored by models fitted on
the others (--study prints the backtest). The season in progress is scored by models fitted on every finished season.
"""
import argparse, json, os, sys, time
from collections import defaultdict
import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_fb import reg, jsdump, clean, OLD_CODES   # noqa: E402

POSG = {"QB": "QB", "RB": "RB", "FB": "RB", "WR": "WR", "TE": "TE"}
SOS_K = 30


def readjs(path):
    s = open(path).read().strip().rstrip(";")
    i = s.index("]={") + 2 if "]={" in s[:200] else s.index("=") + 1
    return json.loads(s[i:])


# ---------- the player-week table ----------
PCOLS = ["game_id", "play_id", "season", "week", "season_type", "play_type", "two_point_attempt", "posteam", "defteam", "yardline_100",
         "pass_attempt", "rush_attempt", "receiver_player_id", "rusher_player_id", "passer_player_id", "complete_pass", "air_yards",
         "yards_after_catch", "xyac_mean_yardage", "cp", "receiving_yards", "rushing_yards", "passing_yards", "pass_touchdown",
         "rush_touchdown", "interception", "sack", "qb_dropback", "qb_scramble", "qb_kneel", "qb_spike", "epa", "qb_epa", "cpoe", "td_player_id"]


def pbp_extras(cache, y):
    p = reg(pd.read_parquet(f"{cache}/pbp_{y}.parquet", columns=PCOLS)); p = p[(p.week <= 18) & (p.two_point_attempt != 1)]
    t = p[(p.pass_attempt == 1) & p.receiver_player_id.notna() & (p.play_type == "pass")]
    ay = t.air_yards
    rt = pd.DataFrame({"id": t.receiver_player_id, "wk": t.week, "ay": ay.fillna(0), "cp": t.cp.fillna(0), "cpn": t.cp.notna().astype(int),
                       "ccp": (t.complete_pass.fillna(0) * t.cp.notna()), "yac": t.yards_after_catch.fillna(0) * t.complete_pass.fillna(0),
                       "xyac": t.xyac_mean_yardage.fillna(0) * t.complete_pass.fillna(0) * t.xyac_mean_yardage.notna(),
                       "yacn": (t.complete_pass.fillna(0) * t.xyac_mean_yardage.notna()), "yacs": t.yards_after_catch.fillna(0) * t.complete_pass.fillna(0) * t.xyac_mean_yardage.notna(),
                       "rzt": (t.yardline_100 <= 20).astype(int), "ezt": (ay.fillna(-99) >= t.yardline_100).astype(int), "dpt": (ay.fillna(0) >= 20).astype(int),
                       "epat": t.epa.fillna(0)}).groupby(["id", "wk"]).sum()
    c = p[(p.rush_attempt == 1) & p.rusher_player_id.notna() & (p.qb_kneel != 1)]
    cy = c.rushing_yards.fillna(0)
    ru = pd.DataFrame({"id": c.rusher_player_id, "wk": c.week, "rzc": (c.yardline_100 <= 20).astype(int), "glc": (c.yardline_100 <= 5).astype(int),
                       "c10": (c.yardline_100 <= 10).astype(int), "x10": (cy >= 10).astype(int), "stf": (cy <= 0).astype(int), "epac": c.epa.fillna(0),
                       "scr": c.qb_scramble.fillna(0)}).groupby(["id", "wk"]).sum()
    d = p[(p.qb_dropback == 1) & (p.qb_spike != 1) & p.passer_player_id.notna()]
    qb = pd.DataFrame({"id": d.passer_player_id, "wk": d.week, "db": 1, "att": d.pass_attempt.fillna(0) * (d.sack != 1), "cmp": d.complete_pass.fillna(0),
                       "pyd": d.passing_yards.fillna(0), "ptd": d.pass_touchdown.fillna(0), "int": d.interception.fillna(0), "sk": d.sack.fillna(0),
                       "qepa": d.qb_epa.fillna(0), "cpoe": d.cpoe.fillna(0), "cpoen": d.cpoe.notna().astype(int), "pay": d.air_yards.fillna(0) * (d.sack != 1)}).groupby(["id", "wk"]).sum()
    # team-week: its passers' EPA per dropback, red-zone opportunities (targets + carries inside the 20)
    tq = d.groupby(["posteam", "week"]).agg(tqe=("qb_epa", "sum"), tqn=("qb_epa", "size"))
    trz = pd.concat([t[t.yardline_100 <= 20][["posteam", "week"]], c[c.yardline_100 <= 20][["posteam", "week"]]]).groupby(["posteam", "week"]).size().rename("trz")
    return rt, ru, qb, tq.join(trz, how="outer").fillna(0)


def player_weeks(cache, data, seasons):
    E = readjs(f"{data}/env.js"); ei = {k: i for i, k in enumerate(E["f"])}
    rows = []
    for y in seasons:
        D = readjs(f"{data}/fb-{y}.js"); wf = {k: i for i, k in enumerate(D["meta"]["wfields"])}
        rt, ru, qb, tm = pbp_extras(cache, y)
        rt, ru, qb = rt.to_dict("index"), ru.to_dict("index"), qb.to_dict("index")
        tmd = tm.to_dict("index")
        env = {(tmn, r[0]): r for tmn, v in E["s"].get(str(y), {}).items() for r in v["w"]}
        base = []
        for p in D["players"]:
            g = POSG.get(p["pos"])
            if not g:
                continue
            for r in p["w"]:
                tmn = r[wf["tm"]]
                if not tmn:
                    continue
                o = dict(y=y, id=p["id"], g=g, wk=r[wf["wk"]], tm=tmn, opp=str(r[wf["opp"]] or "").lstrip("@"), snp=r[wf["snp"]] or 0,
                         tgt=r[wf["tgt"]], rec=r[wf["rec"]], ryd=r[wf["ryd"]], rtd=r[wf["rtd"]], car=r[wf["car"]], ruyd=r[wf["ruyd"]], rutd=r[wf["rutd"]],
                         fp=r[wf["fp"]] or 0, xfp=(r[wf["xfp"]] or 0) + ((r[wf["xp"]] or 0) if "xp" in wf and g == "QB" else 0))
                k = (p["id"], o["wk"])
                for src in (rt, ru, qb):
                    if k in src:
                        o.update(src[k])
                e = env.get((tmn, o["wk"]))
                if e:
                    o.update(T_pl=e[ei["pl"]], T_db=e[ei["db"]], T_np=e[ei["np"]], T_ndb=e[ei["ndb"]], T_pts=e[ei["pts"]], T_imp=e[ei["imp"]], T_epa=e[ei["epa"]])
                q = tmd.get((tmn, o["wk"]))
                if q:
                    o.update(T_qe=q["tqe"], T_qn=q["tqn"], T_rz=q["trz"])
                base.append(o)
        b = pd.DataFrame(base)
        tt = b.groupby(["tm", "wk"]).agg(T_tgt=("tgt", "sum"), T_car=("car", "sum"), T_ay=("ay", "sum"), T_ez=("ezt", "sum"), T_gl=("glc", "sum"))
        b = b.join(tt, on=["tm", "wk"])
        rows.append(b)
        print(f"  player-weeks {y}: {len(b)}", flush=True)
    return pd.concat(rows, ignore_index=True).fillna({c: 0 for c in ["ay", "cp", "cpn", "ccp", "yac", "xyac", "yacn", "yacs", "rzt", "ezt", "dpt", "epat", "rzc", "glc",
                                                                      "c10", "x10", "stf", "epac", "scr", "db", "att", "cmp", "pyd", "ptd", "int", "sk", "qepa", "cpoe", "cpoen", "pay"]})


# ---------- matchup factors to date (the Schedule page's: allowed over what those offenses score there elsewhere, shrunk n / (n + 30)) ----------
def def_factors(pw):
    tw = pw.groupby(["y", "tm", "opp", "wk", "g"]).fp.sum().reset_index()
    out = {}
    for (y, g), q in tw.groupby(["y", "g"]):
        q = q.sort_values("wk")
        for K in range(1, 19):
            a = q[q.wk <= K]
            if not len(a):
                continue
            os_, on = a.groupby("tm").fp.sum(), a.groupby("tm").wk.nunique()
            e = (os_.reindex(a.tm).to_numpy() - a.fp.to_numpy()) / np.maximum(on.reindex(a.tm).to_numpy() - 1, 1)
            e = np.where(on.reindex(a.tm).to_numpy() > 1, e, np.nan)
            A = pd.DataFrame({"d": a.opp.to_numpy(), "a": a.fp.to_numpy(), "e": e}).dropna().groupby("d").agg(a=("a", "sum"), e=("e", "sum"), n=("a", "size"))
            raw = A.a / A.e.where(A.e > 0)
            f = 1 + (raw.fillna(1) - 1) * A.n / (A.n + SOS_K)
            for dfn, v in f.items():
                out[(y, K, dfn, g)] = float(v)
    return out


def schedule(games, seasons):
    g = games[(games.season.isin(seasons)) & (games.game_type == "REG")]
    sch = defaultdict(list)   # (y, tm) -> [(wk, opp, home, implied)]
    for r in g.itertuples():
        h, a = OLD_CODES.get(r.home_team, r.home_team), OLD_CODES.get(r.away_team, r.away_team)
        ih = (r.total_line + r.spread_line) / 2 if r.total_line == r.total_line and r.spread_line == r.spread_line else np.nan
        ia = (r.total_line - r.spread_line) / 2 if ih == ih else np.nan
        sch[(r.season, h)].append((r.week, a, 1, ih)); sch[(r.season, a)].append((r.week, h, 0, ia))
    return {k: sorted(v) for k, v in sch.items()}


# ---------- snapshots: a row per player per week K with features from weeks <= K ----------
def safe(a, b):
    return a / b if b else np.nan


def season_line(pw):
    """a player-season's full line, for the next seasons' 'last season' features"""
    s = pw[pw.snp >= 5].groupby(["y", "id"]).agg(G=("fp", "size"), fp=("fp", "sum"), xfp=("xfp", "sum"), snp=("snp", "mean"), tgt=("tgt", "sum"),
                                                T_tgt=("T_tgt", "sum"), car=("car", "sum"), T_car=("T_car", "sum"), qepa=("qepa", "sum"), db=("db", "sum"))
    s["fpg"] = s.fp / s.G; s["xfpg"] = s.xfp / s.G; s["ts"] = s.tgt / s.T_tgt.replace(0, np.nan); s["cs"] = s.car / s.T_car.replace(0, np.nan)
    s["epadb"] = s.qepa / s.db.replace(0, np.nan)
    return s[["G", "fpg", "xfpg", "snp", "ts", "cs", "epadb"]].to_dict("index")


SUMS = ["fp", "xfp", "tgt", "rec", "ryd", "rtd", "car", "ruyd", "rutd", "ay", "cp", "cpn", "ccp", "yac", "xyac", "yacn", "yacs", "rzt", "ezt", "dpt", "epat",
        "rzc", "glc", "c10", "x10", "stf", "epac", "scr", "db", "att", "cmp", "pyd", "ptd", "int", "sk", "qepa", "cpoe", "cpoen", "pay",
        "T_tgt", "T_car", "T_ay", "T_ez", "T_gl", "T_rz", "T_pl", "T_db", "T_np", "T_ndb", "T_pts", "T_epa", "T_qe", "T_qn"]


def feats_of(a, pre):
    """features from a block of games (sums and rates); `pre` is the name prefix"""
    S = {k: float(a[k].sum()) for k in SUMS if k in a}
    G = len(a)
    f = {}
    f[pre + "fpg"] = S["fp"] / G; f[pre + "xfpg"] = S["xfp"] / G; f[pre + "oe"] = (S["fp"] - S["xfp"]) / G
    f[pre + "snp"] = float(a.snp.mean())
    f[pre + "tgtg"] = S["tgt"] / G; f[pre + "carg"] = S["car"] / G; f[pre + "wog"] = (S["car"] + 2.5 * S["tgt"]) / G
    f[pre + "ts"] = safe(S["tgt"], S["T_tgt"]); f[pre + "cs"] = safe(S["car"], S["T_car"]); f[pre + "ays"] = safe(S["ay"], S["T_ay"])
    f[pre + "os"] = safe(S["tgt"] + S["car"], S["T_tgt"] + S["T_car"]); f[pre + "wos"] = safe(S["car"] + 2.5 * S["tgt"], S["T_car"] + 2.5 * S["T_tgt"])
    f[pre + "rzs"] = safe(S["rzt"] + S["rzc"], S["T_rz"]); f[pre + "gls"] = safe(S["glc"], S["T_gl"]); f[pre + "ezs"] = safe(S["ezt"], S["T_ez"])
    f[pre + "rtr"] = safe(S["tgt"], S["T_db"] * f[pre + "snp"] / 100)   # targets per estimated route (snap share x team dropbacks: the same every season)
    if pre == "":
        f["adot"] = safe(S["ay"], S["tgt"]); f["ypt"] = safe(S["ryd"], S["tgt"]); f["ypc"] = safe(S["ruyd"], S["car"])
        f["croe"] = safe(S["ccp"] - S["cp"], S["cpn"]); f["yacoe"] = safe(S["yacs"] - S["xyac"], S["yacn"])
        f["epat"] = safe(S["epat"], S["tgt"]); f["epac"] = safe(S["epac"], S["car"]); f["tdr"] = safe(S["rtd"] + S["rutd"], S["rec"] + S["car"])
        f["x10"] = safe(S["x10"], S["car"]); f["stf"] = safe(S["stf"], S["car"]); f["dptg"] = S["dpt"] / G; f["ezg"] = S["ezt"] / G; f["glg"] = S["glc"] / G
        f["c10g"] = S["c10"] / G; f["fppo"] = safe(S["fp"], S["tgt"] + S["car"]); f["xppo"] = safe(S["xfp"], S["tgt"] + S["car"])
        f["attg"] = S["att"] / G; f["qepa"] = safe(S["qepa"], S["db"]); f["cpoe"] = safe(S["cpoe"], S["cpoen"]); f["skr"] = safe(S["sk"], S["db"])
        f["ypa"] = safe(S["pyd"], S["att"]); f["tdp"] = safe(S["ptd"], S["att"]); f["intp"] = safe(S["int"], S["att"]); f["padot"] = safe(S["pay"], S["att"])
        f["scrg"] = S["scr"] / G; f["T_plg"] = S["T_pl"] / G; f["T_ptsg"] = S["T_pts"] / G; f["T_epa"] = safe(S["T_epa"], S["T_pl"])
        f["T_npr"] = safe(S["T_ndb"], S["T_np"]); f["T_qepa"] = safe(S["T_qe"], S["T_qn"]); f["T_dbg"] = S["T_db"] / G
        f["T_imp"] = float(a.T_imp.mean()) if "T_imp" in a and a.T_imp.notna().any() else np.nan
    return f


def snapshots(pw, idx, rwp, fac, sch, prev, k_from=1, k_to=17, only=None):
    out = []
    pw = pw[pw.snp >= 5]
    for (y, pid), q in pw.groupby(["y", "id"]):
        q = q.sort_values("wk"); g = q.g.iloc[0]
        b = idx.get(pid, {})
        P1, P2 = prev.get((y - 1, pid)), prev.get((y - 2, pid))
        dr = b.get("dr"); rk = b.get("rk")
        bd = b.get("bd"); age = (pd.Timestamp(f"{y}-09-01") - pd.Timestamp(bd)).days / 365.25 if bd else np.nan
        Ks = range(k_from, k_to + 1) if only is None else [only]
        wks = q.wk.to_numpy()
        for K in Ks:
            n = int((wks <= K).sum())
            if n < 1:
                continue
            if only is None and K not in set(wks) and K > wks.max():
                break
            a = q[q.wk <= K]
            f = dict(y=y, id=pid, g=g, K=K, G=n)
            f.update(feats_of(a, "")); f.update(feats_of(a.tail(3), "l3_")); f.update({"l1_" + k: v for k, v in feats_of(a.tail(1), "").items() if k in ("fpg", "xfpg", "snp", "ts", "cs", "os")})
            f["miss"] = K - n   # games missed or under 5% of the snaps so far
            f["age"] = age; f["dpick"] = dr[2] if dr else 300; f["dround"] = dr[1] if dr else 8; f["yrs"] = y - rk if rk else np.nan
            f["ht"] = b.get("ht"); f["wt"] = b.get("wt")
            for nm, Pv in (("p1", P1), ("p2", P2)):
                f[nm + "G"] = Pv["G"] if Pv else 0
                for k in ("fpg", "xfpg", "snp", "ts", "cs", "epadb"):
                    f[nm + k] = Pv[k] if Pv else np.nan
            rw = rwp.get((y, pid))
            if rw:
                f["rw_pre"] = rw["prep"]; f["rw_pres"] = rw["pre"]
                wk = [x for x in rw["w"] if x[0] <= K]
                if wk:
                    f["rw_pts"] = wk[-1][5]; f["rw_proj"] = wk[-1][4]
            tm = a.tm.iloc[-1]
            S = sch.get((y, tm), [])
            nx = [s for s in S if s[0] > K]
            f["left"] = len(nx)
            if nx:
                f["nx_imp"] = nx[0][3]; f["nx_home"] = nx[0][2]; f["nx_fac"] = fac.get((y, K, nx[0][1], g), 1.0); f["nx_wk"] = nx[0][0]
                f["sos"] = float(np.mean([fac.get((y, K, s[1], g), 1.0) for s in nx]))
                ims = [s[3] for s in nx if s[3] == s[3]]
                f["ros_imp"] = float(np.mean(ims)) if ims else np.nan
            # targets: the rest of the season (games played, 5%+ snaps; 3+ needed) and his next game
            fut = q[q.wk > K]
            f["t_ros"] = float(fut.fp.mean()) if len(fut) >= 3 else np.nan; f["t_rosn"] = len(fut)
            f["t_nxt"] = float(fut.fp.iloc[0]) if len(fut) and (not nx or fut.wk.iloc[0] == nx[0][0]) else np.nan
            out.append(f)
    return pd.DataFrame(out)


# ---------- the models ----------
DROP = {"y", "id", "g", "t_ros", "t_rosn", "t_nxt"}


class Blend:
    """the average of a ridge on every input (medians filled in, a flag for each missing input, standardised) and a heavily regularised
    gradient-boosted tree model. Each player-season gives ~17 near-identical snapshots, so an unregularised boosted model on 100+ inputs
    overfits and did worse than the old five-input linear fit; these two together beat it at every position (study())"""
    def __init__(self, alpha, leaf=600, leaves=8, iters=300, lr=0.03, w=0.5, clip=False):
        # w: the ridge's weight in the average; clip: each input held to its 1st-99th percentile in training (12 Nov 2026, the preseason models:
        # a rate on a handful of plays, 30 yards a catch on one catch, had pulled the ridge around)
        self.alpha, self.leaf, self.leaves, self.iters, self.lr, self.w, self.clip = alpha, leaf, leaves, iters, lr, w, clip

    def _cl(self, X):
        return X.clip(self.lo, self.hi, axis=1) if self.clip else X

    def _prep(self, X):
        Z = X.fillna(self.med)
        fl = X[self.flags].isna().astype(float).add_suffix("_na")
        return (pd.concat([Z, fl], axis=1) - self.mu) / self.sd

    def fit(self, X, y):
        from sklearn.ensemble import HistGradientBoostingRegressor
        from sklearn.linear_model import Ridge
        if self.clip:
            self.lo, self.hi = X.quantile(0.01), X.quantile(0.99); X = X.clip(self.lo, self.hi, axis=1)
        self.med = X.median().fillna(0); self.flags = [c for c in X.columns if 0 < X[c].isna().mean() < 1]
        Z = pd.concat([X.fillna(self.med), X[self.flags].isna().astype(float).add_suffix("_na")], axis=1)
        self.mu = Z.mean(); self.sd = Z.std().replace(0, 1)
        self.r = Ridge(alpha=self.alpha).fit((Z - self.mu) / self.sd, y) if self.w > 0 else None
        self.hc = [c for c in X.columns if X[c].notna().any()]   # a column empty in this fold (a field a season lacked) is left out of the trees
        self.h = None if self.w >= 1 else HistGradientBoostingRegressor(max_iter=self.iters, learning_rate=self.lr, max_leaf_nodes=self.leaves, min_samples_leaf=self.leaf, l2_regularization=5,
                                               max_features=0.5, random_state=7).fit(X[self.hc], y)
        return self

    def predict(self, X):
        X = self._cl(X)
        return (self.w * self.r.predict(self._prep(X)) if self.r is not None else 0) + ((1 - self.w) * self.h.predict(X[self.hc]) if self.h is not None else 0)


ALPHA = {"t_ros": 1000, "t_nxt": 300}
# the backtest (study(), 7 Nov 2026: every 2016-25 player after weeks 2-15 / 2-17 with 3+ FP / G, each season held out of its own fit; mean
# miss QB / RB / WR / TE, r in study.log): rest of season 3.05 / 3.02 / 2.93 / 2.39 (r .60 / .73 / .73 / .70) against 3.25 / 3.24 / 3.03 / 2.43
# for the old five-input linear fit and 3.99 / 3.58 / 3.34 / 2.70 for FP / G to date; next game 5.97 / 5.26 / 5.28 / 4.42 (r .44 / .56 / .52 / .49)
# against 6.19 / 5.43 / 5.39 / 4.51 and 6.46 / 5.58 / 5.57 / 4.67
MAE = {"ros": [3.05, 3.02, 2.93, 2.39], "lin": [3.25, 3.24, 3.03, 2.43], "fpg": [3.99, 3.58, 3.34, 2.70], "nxt": [5.97, 5.26, 5.28, 4.42]}


def baseline(q):   # the current Projections page's linear inputs, refitted (for the backtest's comparison)
    return ["fpg", "xfpg", "l3_fpg", "l3_xfpg", "p1fpg", "T_imp", "sos"]


def study(sn, cols):
    from sklearn.linear_model import LinearRegression
    ys = sorted(sn.y.unique())
    res = {}
    for g in ("QB", "RB", "WR", "TE"):
        for tgt, mn in (("t_ros", 3), ("t_nxt", 1)):
            q = sn[(sn.g == g) & sn[tgt].notna() & (sn.K >= 2) & (sn.K <= (15 if tgt == "t_ros" else 17)) & (sn.fpg >= 3)].reset_index(drop=True)
            if tgt == "t_ros":
                q = q[q.t_rosn >= mn].reset_index(drop=True)
            cols_ = [c for c in cols if q[c].notna().any()]   # Role Watch has no QBs: a column with nothing in it is dropped
            p_gb = np.full(len(q), np.nan); p_ln = np.full(len(q), np.nan)
            for y in ys:
                te = (q.y == y).to_numpy(); tr = ~te
                if not te.any() or tr.sum() < 500:
                    continue
                m = Blend(ALPHA[tgt]).fit(q.loc[tr, cols_], q.loc[tr, tgt]); p_gb[te] = m.predict(q.loc[te, cols_])
                B = baseline(q); X = q[B].fillna({"p1fpg": 0}).assign(h1=q.p1fpg.notna().astype(float)).fillna(q[B].median())
                l = LinearRegression().fit(X[tr], q.loc[tr, tgt]); p_ln[te] = l.predict(X[te])
            ok = ~np.isnan(p_gb)
            t = q[tgt].to_numpy()[ok]
            mae = lambda p: float(np.mean(np.abs(p[ok] - t)))
            r = lambda p: float(np.corrcoef(p[ok], t)[0, 1])
            res[(g, tgt)] = dict(n=int(ok.sum()), gb=(mae(p_gb), r(p_gb)), lin=(mae(p_ln), r(p_ln)), fpg=(mae(q.fpg.to_numpy()), r(q.fpg.to_numpy())))
            print(f"{g} {tgt}: n {ok.sum()}  blend MAE {mae(p_gb):.3f} r {r(p_gb):.3f} | linear (current page) {mae(p_ln):.3f} r {r(p_ln):.3f} | FP/G to date {mae(q.fpg.to_numpy()):.3f} r {r(q.fpg.to_numpy()):.3f}", flush=True)
    return res


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", default=".cache/fb"); ap.add_argument("--data", default="data"); ap.add_argument("--current", type=int, default=2026)
    ap.add_argument("--study", action="store_true"); ap.add_argument("--snap", default=None, help="pickle the snapshots here (study)")
    ap.add_argument("--from-snap", default=None, help="study: read the snapshots from this pickle instead of rebuilding them")
    a = ap.parse_args()
    seasons = [y for y in range(2016, a.current + 1) if os.path.exists(f"{a.data}/fb-{y}.js") and os.path.exists(f"{a.cache}/pbp_{y}.parquet")]
    t0 = time.time()
    if a.study and a.from_snap:
        sn = pd.read_pickle(a.from_snap); study(sn, [c for c in sn.columns if c not in DROP]); return
    pw = player_weeks(a.cache, a.data, seasons)
    idx = readjs(f"{a.data}/index.js")
    rwp = {}
    for y in seasons:
        p = f"{a.data}/proj-{y}.js"
        if os.path.exists(p):
            for r in readjs(p)["rows"]:
                rwp[(y, r["id"])] = r
    games = pd.read_csv(f"{a.cache}/games.csv", low_memory=False)
    fac = def_factors(pw); sch = schedule(games, seasons); prev = season_line(pw)
    print(f"  tables {time.time() - t0:.0f}s", flush=True)
    hist = [y for y in seasons if y != a.current]
    sn = snapshots(pw[pw.y.isin(hist)], idx, rwp, fac, sch, prev)
    cols = [c for c in sn.columns if c not in DROP]
    print(f"  snapshots {len(sn)} rows, {len(cols)} features, {time.time() - t0:.0f}s", flush=True)
    if a.snap:
        sn.to_pickle(a.snap)
    if a.study:
        study(sn, cols); return
    # the season in progress: after its last week, every player with a game
    cur = pw[pw.y == a.current]; K = int(cur.wk.max())
    sc = snapshots(cur, idx, rwp, fac, sch, prev, only=K)
    out = {}
    for g in ("QB", "RB", "WR", "TE"):
        for tgt in ("t_ros", "t_nxt"):
            q = sn[(sn.g == g) & sn[tgt].notna() & (sn.K >= 2) & (sn.K <= (15 if tgt == "t_ros" else 17)) & (sn.fpg >= 3)]
            if tgt == "t_ros":
                q = q[q.t_rosn >= 3]
            cols_ = [c for c in cols if q[c].notna().any()]
            m = Blend(ALPHA[tgt]).fit(q[cols_], q[tgt])
            c = sc[sc.g == g]
            for pid, v in zip(c.id, m.predict(c[cols_])):
                out.setdefault(pid, {})["ros" if tgt == "t_ros" else "nxt"] = round(max(0.0, float(v)), 2)
    for r in sc.itertuples():
        o = out.setdefault(r.id, {})
        o.update(G=int(r.G), fpg=round(r.fpg, 2), xfpg=round(r.xfpg, 2), left=int(r.left), nxw=None if r.nx_wk != r.nx_wk else int(r.nx_wk),
                 nxi=None if r.nx_imp != r.nx_imp else round(r.nx_imp, 1), nxf=None if r.nx_fac != r.nx_fac else round(r.nx_fac, 3))
    meta = dict(season=a.current, through=K, built=time.strftime("%Y-%m-%d %H:%M"), features=len(cols), mae=MAE)
    with open(f"{a.data}/ros.js", "w") as f:
        f.write("window.FB_ROS=" + jsdump(clean({"meta": meta, "p": out})) + ";\n")
    print(f"  wrote ros.js: {len(out)} players after week {K}, {time.time() - t0:.0f}s", flush=True)


if __name__ == "__main__":
    main()

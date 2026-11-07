#!/usr/bin/env python3
"""Sean's football site: the preseason projection models -> data/pre.js.

    python3 tools/build_pre.py [--cache .cache/fb] [--data data] [--current 2026] [--study]

(7 Nov 2026; Sean: "I also want models that pre season project points using literally every single possible input available ... could've
predicted Jaylen Warren, Ashton Jeanty, Chuba Hubbard, Bucky Irving, cmc, Omarion Hampton being bad ... the individuals own skill/talent,
their coaching staffs ability to generate production as well as their playcalling history and preferences, their teams qb and his skill,
their o line".) A player's season PPR points a game (games with 5%+ of the snaps, 4+ needed) and his games played, from what was known at
kickoff: his last two seasons line by line (usage, efficiency, skill), his career, age, draft capital, the combine; his team at kickoff
(its offense, line and position-group production the year before); its Week 1 quarterback and his record; the play-caller's and head
coach's history (what their offenses produced, how they split the backfield and the targets); the depth chart around him (his teammates'
work the year before, what left, rookies added); the Week 1 Vegas total; and, in one version, the market (ADP). Every season 2017-25 is
scored by models fitted on the others (--study prints the backtest); this season and next by models fitted on every finished season.
"""
import argparse, json, os, sys, time
from collections import defaultdict
import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_fb import fetch, R, OLD_CODES, jsdump, clean   # noqa: E402
from build_ros import readjs, Blend, POSG   # noqa: E402

GROUPS = ("QB", "RB", "WR", "TE")


def sd(a, b):
    return a / b if b else np.nan


def season_feats(p, D):
    """one player-season's line as rates (the prior seasons' features)"""
    g = max(p.get("g") or 0, 1); tgt, car, rts = p.get("tgt") or 0, p.get("car") or 0, p.get("rts") or 0
    xfp = (p.get("xr") or 0) + (p.get("xu") or 0) + (p.get("xp") or 0)
    rec = p.get("rec") or 0
    f = dict(g=p.get("g"), fpg=p.get("fp", 0) / g, xfpg=xfp / g, oeg=(p.get("fp", 0) - xfp) / g, snp=p.get("snpct"),
             tgtg=tgt / g, carg=car / g, wog=(car + 2.5 * tgt) / g, ts=sd(tgt, p.get("tmt")), cs=sd(car, p.get("tmc")), ays=sd(p.get("ay") or 0, p.get("tmay")),
             os=sd(tgt + car, (p.get("tmt") or 0) + (p.get("tmc") or 0)), rzs=sd((p.get("rzt") or 0) + (p.get("rzc") or 0), (p.get("tmrzt") or 0) + (p.get("tmrzc") or 0)),
             gls=sd(p.get("glc") or 0, p.get("tmglc")), ezs=sd(p.get("ezt") or 0, p.get("tmezt")), rte=sd(rts, p.get("tmdb")), tprr=sd(tgt, rts),
             yprr=sd(p.get("ryd") or 0, rts), adot=sd(p.get("ay") or 0, tgt), ypt=sd(p.get("ryd") or 0, tgt), ypr=sd(p.get("ryd") or 0, rec), ypc=sd(p.get("ruyd") or 0, car),
             croe=sd((p.get("cc") or 0) - (p.get("xc") or 0), p.get("xcn")), yacoe=sd((p.get("yacs") or 0) - (p.get("xyac") or 0), p.get("yacn")),
             ryoe=sd(p.get("ryoe"), p.get("ngsatt")) if p.get("ryoe") is not None else np.nan, tdoe=((p.get("rtd") or 0) + (p.get("rutd") or 0) - (p.get("xtr") or 0) - (p.get("xtu") or 0)) / g,
             epat=sd(p.get("epat"), tgt) if p.get("epat") is not None else np.nan, epar=sd(p.get("epar"), car) if p.get("epar") is not None else np.nan,
             x10=sd(p.get("x10") or 0, car), stf=sd(p.get("stf") or 0, car), brkr=sd(p.get("btkr"), p.get("pfrrec")) if p.get("btkr") is not None else np.nan,
             brka=sd(p.get("btka"), p.get("pfratt")) if p.get("btka") is not None else np.nan, ybc=sd(p.get("ybc"), p.get("pfratt")) if p.get("ybc") is not None else np.nan,
             yaca=sd(p.get("ryac"), p.get("pfratt")) if p.get("ryac") is not None else np.nan, drop=sd(p.get("drops"), p.get("pfrtgt")) if p.get("drops") is not None else np.nan,
             sep=p.get("sep"), sepoe=p.get("sepoe"), nyoe=p.get("nyoe"), eff=p.get("eff"), box8=p.get("box8"), c10g=(p.get("c10") or 0) / g,
             hvt=sd((p.get("c10") or 0) + rec, car + rec), dbg=(p.get("db") or 0) / g, attg=(p.get("att") or 0) / g,
             epadb=sd(p.get("epa"), p.get("db")) if p.get("epa") is not None else np.nan, cpoe=p.get("cpoe"), skr=sd(p.get("sk") or 0, p.get("db")),
             ypa=sd(p.get("pyd") or 0, p.get("att")), tdp=sd(p.get("ptd") or 0, p.get("att")), intp=sd(p.get("int_") or 0, p.get("att")),
             pxg=(p.get("xp") or 0) / g if p.get("xp") is not None else np.nan, poeg=((p.get("pyd") or 0) / 25 + 4 * (p.get("ptd") or 0) - 2 * (p.get("int_") or 0) - (p.get("xp") or 0)) / g if p.get("xp") is not None else np.nan,
             scr=(p.get("scr") or 0) / g)
    return f


P2KEYS = ["g", "fpg", "xfpg", "oeg", "snp", "ts", "cs", "os", "wog", "tprr", "yprr", "ypc", "epadb"]


def load(data, cache, seasons):
    S, I = {}, readjs(f"{data}/index.js")
    for y in seasons:
        if os.path.exists(f"{data}/fb-{y}.js"):
            S[y] = readjs(f"{data}/fb-{y}.js")
    T = readjs(f"{data}/teams.js"); E = readjs(f"{data}/env.js")
    RW = {}
    for y in seasons:
        p = f"{data}/proj-{y}.js"
        if os.path.exists(p):
            for r in readjs(p)["rows"]:
                RW[(y, r["id"])] = r
    games = pd.read_csv(f"{cache}/games.csv", low_memory=False)
    comb = pd.read_parquet(fetch(f"{R}/combine/combine.parquet", f"{cache}/combine.parquet"))
    pl = pd.read_parquet(f"{cache}/players.parquet")
    pfr2g = dict(zip(pl.pfr_id, pl.gsis_id))
    C = {}
    for r in comb.itertuples():
        g = pfr2g.get(r.pfr_id)
        if isinstance(g, str):
            C[g] = dict(forty=r.forty, vert=r.vertical, broad=r.broad_jump, cone=r.cone, shuttle=r.shuttle, bench=r.bench)
    return S, I, T, E, RW, games, C


def team_tables(S, T, E):
    """per team-season: what its offense did (the year before is read off these)"""
    out = {}
    for y, D in S.items():
        wf = {k: i for i, k in enumerate(D["meta"]["wfields"])}
        pos_fp, pos_x, games = defaultdict(float), defaultdict(float), defaultdict(set)
        for p in D["players"]:
            g = POSG.get(p["pos"])
            if not g:
                continue
            for r in p["w"]:
                tm = r[wf["tm"]]
                if not tm:
                    continue
                pos_fp[(tm, g)] += r[wf["fp"]] or 0
                pos_x[(tm, g)] += (r[wf["xfp"]] or 0) + ((r[wf["xp"]] or 0) if "xp" in wf and g == "QB" else 0)
                games[tm].add(r[wf["wk"]])
        ef = E["f"]; ei = {k: i for i, k in enumerate(ef)}
        for tm, wk in games.items():
            n = len(wk); o = {f"fp_{g}": pos_fp[(tm, g)] / n for g in GROUPS}
            o.update({f"x_{g}": pos_x[(tm, g)] / n for g in GROUPS})
            ev = E["s"].get(str(y), {}).get(tm)
            if ev:
                w = ev["w"]; s = lambda k: sum((r[ei[k]] or 0) for r in w)
                im = [r[ei["imp"]] for r in w if r[ei["imp"]] is not None]
                o.update(plg=s("pl") / max(len(w), 1), npr=sd(s("ndb"), s("np")), proe=sd(s("noe"), s("noen")), ptsg=s("pts") / max(len(w), 1),
                         epa=sd(s("epa"), s("pl")), skr=sd(s("sk"), s("db")), qh=sd(s("qh"), s("db")), aly=sd(s("aly"), s("rbc")), stf=sd(s("rbs"), s("rbc")),
                         olsk=sd(s("olsk"), s("fdb")) if "olsk" in ei and s("fdb") else np.nan, alyx=ev.get("alyx"), imp=np.mean(im) if im else np.nan, rzg=s("rz") / max(len(w), 1))
            t = next((r for r in T.get(str(y), []) if r["tm"] == tm), None)
            if t:
                o.update(rb1car=t.get("rb1car"), rb1opp=t.get("rb1opp"), rbeff=t.get("eff"), rbtsh=sd(t.get("rbtgt"), t.get("tmtgt")), rbcsh=sd(t.get("rbcar"), t.get("tmcar")),
                         hc=t.get("hc"), pc=t.get("pc") or t.get("oc") or t.get("hc"))
            out[(y, tm)] = o
    return out


COACH_KEYS = ["fp_QB", "fp_RB", "fp_WR", "fp_TE", "x_RB", "x_WR", "x_TE", "plg", "npr", "proe", "ptsg", "epa", "rb1car", "rb1opp", "rbeff", "rbtsh"]


def coach_hist(tt, who, y, role):
    """a coach's teams before season y in that role (play-caller or head coach): the averages of what they did, and how many seasons"""
    rows = [v for (s, tm), v in tt.items() if s < y and v.get(role) == who]
    o = {f"{role}_n": len(rows)}
    for k in COACH_KEYS:
        v = [r[k] for r in rows if r.get(k) is not None and r.get(k) == r.get(k)]
        o[f"{role}_{k}"] = float(np.mean(v)) if v else np.nan
    return o


def build_rows(S, I, T, E, RW, games, C, seasons, current):
    tt = team_tables(S, T, E)
    # every player-season's line, and who was on which team at kickoff (his first game row)
    line, team0, wk1 = {}, {}, {}
    for y, D in S.items():
        wf = {k: i for i, k in enumerate(D["meta"]["wfields"])}
        for p in D["players"]:
            line[(y, p["id"])] = p
            rs = [r for r in p["w"] if r[wf["tm"]]]
            if rs:
                team0[(y, p["id"])] = rs[0][wf["tm"]]; wk1[(y, p["id"])] = rs[0][wf["wk"]]
    g1 = games[(games.game_type == "REG")]
    qb1, imp1 = {}, {}
    for r in g1[g1.week == g1.groupby("season").week.transform("min")].itertuples():
        h, a = OLD_CODES.get(r.home_team, r.home_team), OLD_CODES.get(r.away_team, r.away_team)
        qb1[(r.season, h)], qb1[(r.season, a)] = r.home_qb_id, r.away_qb_id
        if r.total_line == r.total_line and r.spread_line == r.spread_line:
            imp1[(r.season, h)] = (r.total_line + r.spread_line) / 2; imp1[(r.season, a)] = (r.total_line - r.spread_line) / 2
    out = []
    for y in seasons:
        if y not in S or y - 1 not in S and y > min(S):
            pass
        D = S.get(y)
        if not D:
            continue
        wf = {k: i for i, k in enumerate(D["meta"]["wfields"])}
        rooms = defaultdict(list)
        for p in D["players"]:
            g = POSG.get(p["pos"]); tm = team0.get((y, p["id"]))
            if g and tm and wk1.get((y, p["id"]), 99) <= 2:   # the room at kickoff: teammates in his group who played by week 2
                rooms[(tm, g)].append(p["id"])
        for p in D["players"]:
            g = POSG.get(p["pos"]); tm = team0.get((y, p["id"]))
            if not g or not tm:
                continue
            pid = p["id"]
            gw = [r for r in p["w"] if (r[wf["snp"]] or 0) >= 5]
            f = dict(y=y, id=pid, g=g, tm=tm, t_fpg=float(np.mean([r[wf["fp"]] or 0 for r in gw])) if len(gw) >= 4 else np.nan, t_g=len(gw),
                     t_fp=float(sum(r[wf["fp"]] or 0 for r in p["w"])))
            b = I.get(pid, {}); dr = b.get("dr"); rk = b.get("rk")
            f["age"] = (pd.Timestamp(f"{y}-09-01") - pd.Timestamp(b["bd"])).days / 365.25 if b.get("bd") else np.nan
            f["dpick"] = dr[2] if dr else 300; f["dround"] = dr[1] if dr else 8; f["yrs"] = y - rk if rk else np.nan
            f["rookie"] = 1.0 if rk == y else 0.0; f["ht"] = b.get("ht"); f["wt"] = b.get("wt")
            cb = C.get(pid, {})
            for k in ("forty", "vert", "broad", "cone", "shuttle", "bench"):
                f[k] = cb.get(k)
            f["speed"] = (f["wt"] * 200 / cb["forty"] ** 4) if cb.get("forty") and f["wt"] else np.nan
            # his last two seasons, and his career before this one
            for i, nm in ((1, "p1_"), (2, "p2_")):
                q = line.get((y - i, pid))
                sf = season_feats(q, S[y - i]) if q else {}
                for k, v in sf.items():
                    if i == 1 or k in P2KEYS:
                        f[nm + k] = v
            car = [line[(s, pid)] for s in range(2016, y) if (s, pid) in line]
            f["c_n"] = len(car); f["c_fpg"] = sd(sum(q["fp"] for q in car), sum(q["g"] for q in car)) if car else np.nan
            f["c_best"] = max((q["fp"] / max(q["g"], 1) for q in car if q["g"] >= 6), default=np.nan)
            t1 = team0.get((y - 1, pid)); f["moved"] = 1.0 if t1 and t1 != tm else 0.0
            # his team at kickoff, as it was the year before
            tp = tt.get((y - 1, tm), {})
            for k in ("plg", "npr", "proe", "ptsg", "epa", "skr", "qh", "aly", "alyx", "stf", "olsk", "imp", "rzg", "rb1car", "rb1opp", "rbeff", "rbtsh", "rbcsh", f"fp_{g}", f"x_{g}"):
                f["tp_" + k.replace(f"_{g}", "_pos")] = tp.get(k)
            f["imp1"] = imp1.get((y, tm))
            # his Week 1 quarterback (a QB: himself), and his record
            q1 = qb1.get((y, tm)); f["qb_is"] = 1.0 if q1 == pid else 0.0
            qq = line.get((y - 1, q1)) if isinstance(q1, str) else None
            qf = season_feats(qq, S[y - 1]) if qq else {}
            for k in ("epadb", "cpoe", "fpg", "pxg", "poeg", "skr", "ypa", "attg", "scr"):
                f["qb_" + k] = qf.get(k)
            qb_b = I.get(q1, {}) if isinstance(q1, str) else {}
            f["qb_pick"] = qb_b["dr"][2] if qb_b.get("dr") else 300; f["qb_rk"] = 1.0 if qb_b.get("rk") == y else 0.0
            f["qb_new"] = 1.0 if isinstance(q1, str) and team0.get((y - 1, q1)) != tm else 0.0
            # the coaches: this season's play-caller and head coach, their history before this season
            tc = tt.get((y, tm), {}); pc, hc = tc.get("pc"), tc.get("hc")
            f.update(coach_hist(tt, pc, y, "pc")); f.update(coach_hist(tt, hc, y, "hc"))
            f["pc_new"] = 1.0 if tp.get("pc") != pc else 0.0; f["hc_new"] = 1.0 if tp.get("hc") != hc else 0.0
            # the room: his teammates at his position at kickoff and their work the year before
            mates = [m for m in rooms[(tm, g)] if m != pid]
            prev = lambda m: line.get((y - 1, m))
            mo = [(prev(m)["tgt"] or 0) + (prev(m)["car"] or 0) if prev(m) else 0 for m in mates]
            mf = [prev(m)["fp"] / max(prev(m)["g"], 1) if prev(m) else np.nan for m in mates]
            mine = (p1 := line.get((y - 1, pid))) and ((p1["tgt"] or 0) + (p1["car"] or 0)) or 0
            f["rm_opp"] = float(sum(mo)); f["rm_sh"] = sd(mine, mine + sum(mo)); f["rm_best"] = float(np.nanmax(mf)) if any(v == v for v in mf) else np.nan
            mp = [I.get(m, {}).get("dr") for m in mates]
            f["rm_bestpick"] = min((d[2] for d in mp if d), default=300)
            f["rm_rook"] = float(sum(1 for m in mates if I.get(m, {}).get("rk") == y and (I.get(m, {}).get("dr") or [0, 9])[1] <= 3))
            # what the team's position group did the year before, against what returns
            gl = [q for q in S.get(y - 1, {"players": []})["players"] if POSG.get(q["pos"]) == g and team0.get((y - 1, q["id"])) == tm]
            tot = sum((q["tgt"] or 0) + (q["car"] or 0) for q in gl); ret = sum((q["tgt"] or 0) + (q["car"] or 0) for q in gl if q["id"] in rooms[(tm, g)])
            f["vac"] = tot - ret; f["vac_sh"] = sd(tot - ret, tot)
            # the market and Role Watch's preseason line
            rw = RW.get((y, pid))
            f["adp"] = rw.get("adp") if rw else np.nan; f["mkp"] = rw.get("mkp") if rw else np.nan; f["rw_prep"] = rw.get("prep") if rw else np.nan
            f["rw_pre"] = rw.get("pre") if rw else np.nan
            out.append(f)
        print(f"  preseason rows {y}: {sum(1 for o in out if o['y'] == y)}", flush=True)
    d = pd.DataFrame(out)
    for c in d.columns:
        if c not in ("id", "g", "tm", "y"):
            d[c] = pd.to_numeric(d[c], errors="coerce").astype(float)
    return d


DROP = {"y", "id", "g", "tm", "t_fpg", "t_g", "t_fp"}
MARKET = {"adp", "mkp", "rw_pre", "rw_prep"}   # Role Watch's preseason lines carry ADP in them, so they count as the market
ALPHA = 300   # the sample is ~1,000 player-seasons a position, so lighter than the in-season blend: ridge 300, 60 rows a leaf (tested 10-300 / 20-60)


def fit_pred(q, cols, tr, te, tgt):
    m = Blend(ALPHA, leaf=60).fit(q.loc[tr, cols], q.loc[tr, tgt])
    return m.predict(q.loc[te, cols]), m


def eligible(sn):
    # who a preseason projection is for: a QB who started Week 1, or anyone with a market price, a Role Watch line, or a role last season
    return (sn.qb_is == 1) | sn.adp.notna() | sn.rw_prep.notna() | (sn.p1_fpg >= 6) | ((sn.rookie == 1) & (sn.dround <= 3))


def study(sn):
    ys = [y for y in sorted(sn.y.unique()) if y >= 2017 and sn[(sn.y == y)].t_fpg.notna().sum() > 100 and y < sn.y.max()]
    for g in GROUPS:
        q = sn[(sn.g == g) & eligible(sn) & sn.t_fpg.notna() & sn.y.isin(ys)].reset_index(drop=True)
        colsA = [c for c in q.columns if c not in DROP and q[c].notna().any()]
        colsN = [c for c in colsA if c not in MARKET]
        pa = np.full(len(q), np.nan); pn = np.full(len(q), np.nan)
        for y in ys:
            te = (q.y == y).to_numpy(); tr = ~te
            pa[te], _ = fit_pred(q, colsA, tr, te, "t_fpg"); pn[te], _ = fit_pred(q, colsN, tr, te, "t_fpg")
        t = q.t_fpg.to_numpy(); mk = q.mkp.to_numpy(); has = ~np.isnan(mk)
        mae = lambda p, m=np.ones(len(q), bool): float(np.mean(np.abs(p[m] - t[m])))
        r = lambda p, m=np.ones(len(q), bool): float(np.corrcoef(p[m], t[m])[0, 1])
        lf = q.p1_fpg.to_numpy(); hl = ~np.isnan(lf)
        print(f"{g}: n {len(q)} | with market MAE {mae(pa):.2f} r {r(pa):.3f} | no market {mae(pn):.2f} r {r(pn):.3f}"
              f" || players with ADP (n {has.sum()}): market {mae(mk, has):.2f} r {r(mk, has):.3f}, model+market {mae(pa, has):.2f} r {r(pa, has):.3f}, model alone {mae(pn, has):.2f} r {r(pn, has):.3f}"
              f" || last season FP/G (n {hl.sum()}) {mae(lf, hl):.2f}, model {mae(pa, hl):.2f}", flush=True)
        q["pa"], q["pn"] = pa, pn
        q.to_pickle(f"/tmp/pre_{g}.pkl") if os.environ.get("PRE_DUMP") else None


# names for the "why" lines (the inputs that moved his projection most, from the ridge half of the blend)
LAB = {"p1_fpg": "last season's FP/G", "p1_xfpg": "last season's xFP/G", "p1_oeg": "last season's points over expected", "p1_snp": "last season's snap %",
       "p1_ts": "last season's target share", "p1_cs": "last season's carry share", "p1_os": "last season's opportunity share", "p1_wog": "last season's weighted opportunities",
       "p1_tprr": "targets per route", "p1_yprr": "yards per route", "p1_ypc": "yards per carry", "p1_ryoe": "rush yards over expected", "p1_croe": "catch rate over expected",
       "p1_yacoe": "YAC over expected", "p1_tdoe": "last season's TD luck", "p1_epadb": "last season's EPA / dropback", "p1_pxg": "last season's passing xFP", "p1_poeg": "last season's passing over expected",
       "p1_rzs": "red-zone share", "p1_gls": "goal-line share", "p1_hvt": "high-value touches", "p1_elus": "elusiveness", "p1_g": "games last season", "p2_fpg": "two seasons ago FP/G",
       "c_fpg": "career FP/G", "c_best": "best season", "c_n": "seasons in the league", "age": "age", "dpick": "draft pick", "dround": "draft round", "yrs": "years in the league",
       "rookie": "rookie", "speed": "speed score", "forty": "40 time", "wt": "weight", "moved": "a new team", "qb_epadb": "his QB's EPA / dropback", "qb_fpg": "his QB's FP/G",
       "qb_pxg": "his QB's passing volume", "qb_poeg": "his QB's passing over expected", "qb_cpoe": "his QB's CPOE", "qb_new": "a new QB", "qb_rk": "a rookie QB", "qb_is": "the Week 1 starter",
       "tp_ptsg": "his team's points last season", "tp_epa": "his team's EPA last season", "tp_plg": "his team's plays", "tp_npr": "his team's pass rate", "tp_proe": "his team's pass rate over expected",
       "tp_fp_pos": "his team's production at his position", "tp_x_pos": "his team's opportunity at his position", "tp_rb1car": "his team's lead-back share", "tp_rbtsh": "his team's RB target share",
       "tp_olsk": "his line's sacks", "tp_alyx": "his line's run blocking", "tp_skr": "his team's sack rate", "tp_imp": "his team's Vegas totals last season", "imp1": "the Week 1 Vegas total",
       "pc_n": "the play-caller's experience", "pc_new": "a new play-caller", "hc_new": "a new head coach", "pc_fp_RB": "the play-caller's RB production", "pc_fp_WR": "the play-caller's WR production",
       "pc_fp_TE": "the play-caller's TE production", "pc_fp_QB": "the play-caller's QB production", "pc_rb1car": "the play-caller's lead-back share", "pc_rbtsh": "the play-caller's RB targets",
       "pc_npr": "the play-caller's pass rate", "pc_ptsg": "the play-caller's scoring", "pc_plg": "the play-caller's pace", "hc_ptsg": "the head coach's scoring",
       "rm_opp": "teammates' work last season", "rm_sh": "his share of the room's work", "rm_best": "the best teammate at his spot", "rm_bestpick": "a teammate's draft capital", "rm_rook": "an early-round rookie added",
       "vac": "vacated work", "vac_sh": "share of work vacated", "rw_prep": "Role Watch's preseason line", "rw_pre": "Role Watch's preseason share", "adp": "ADP", "mkp": "the market"}
for k in list(LAB):
    if k.startswith("pc_"):
        LAB.setdefault("hc_" + k[3:], LAB[k].replace("play-caller", "head coach"))


# what moved his projection: each group of inputs set to an average player's (the training medians) and the whole model run again;
# the difference is that group's push, in FP / G
WHY = [("his last two seasons", ("p1_", "p2_")), ("his career", ("c_",)), ("age, draft and athleticism", ("age", "dpick", "dround", "yrs", "rookie", "ht", "wt", "forty", "vert", "broad", "cone", "shuttle", "bench", "speed")),
       ("his team's offense and line", ("tp_", "imp1", "moved")), ("his quarterback", ("qb_",)), ("his play-caller and head coach", ("pc_", "hc_")), ("the depth chart", ("rm_", "vac"))]


def why(m, X, base):
    out = []
    for nm, pre in WHY:
        cs = [c for c in X.columns if c.startswith(pre) or c in pre]
        if not cs:
            continue
        Z = X.copy(); Z[cs] = m.med[cs].to_numpy()
        out.append((nm, base - m.predict(Z)))
    return out


def write(sn, a):
    sn = sn.assign(y=sn.y.astype(int))
    cur = int(sn.y.max())
    ys = [int(y) for y in sorted(sn.y.unique()) if 2017 <= y < cur]
    out = {str(y): {} for y in ys + [cur]}
    for g in GROUPS:
        q = sn[(sn.g == g) & eligible(sn) & sn.y.isin(ys + [cur])].reset_index(drop=True)
        colsN = [c for c in q.columns if c not in DROP and c not in MARKET and q[c].notna().any()]
        colsA = [c for c in q.columns if c not in DROP and q[c].notna().any()]
        fin = (q.y < cur) & q.t_fpg.notna()
        for y in ys + [cur]:
            te = (q.y == y).to_numpy(); tr = (fin & (q.y != y)).to_numpy()
            m = Blend(ALPHA, leaf=60).fit(q.loc[tr, colsN], q.loc[tr, "t_fpg"])
            X = q.loc[te, colsN]; pred = m.predict(X); W = why(m, X, pred)
            hasm = q.loc[te, "adp"].notna().to_numpy()   # the version with the market, where there was one
            pm = np.full(len(X), np.nan)
            if hasm.any() and q.loc[tr, "adp"].notna().any():
                mA = Blend(ALPHA, leaf=60).fit(q.loc[tr, colsA], q.loc[tr, "t_fpg"]); pm = mA.predict(q.loc[te, colsA])
            for j, i in enumerate(np.where(te)[0]):
                r = q.iloc[i]
                nn = lambda v, d=2: None if v != v or v is None else round(float(v), d)
                out[str(y)][r.id] = dict(p=round(float(max(pred[j], 0)), 2), pm=nn(pm[j]) if hasm[j] else None, mk=nn(r.mkp), adp=nn(r.adp, 1), act=nn(r.t_fpg), g=int(r.t_g),
                                         tm=r.tm, age=nn(r.age, 1), p1=nn(r.p1_fpg), why=[[nm, round(float(v[j]), 1)] for nm, v in W])
        print(f"  preseason {g} done", flush=True)
    meta = dict(built=time.strftime("%Y-%m-%d %H:%M"), seasons=ys + [cur], current=cur, inputs=len([c for c in sn.columns if c not in DROP]), mae=MAE)
    with open(f"{a.data}/pre.js", "w") as f:
        f.write("window.FB_PRE=" + jsdump(clean({"meta": meta, "s": out})) + ";\n")
    print(f"  wrote pre.js", flush=True)


# the backtest (study(), 7 Nov 2026; every eligible player-season 2017-25 with 4+ games, each season held out of its own fit; mean miss in
# FP / G, QB / RB / WR / TE): the model with no market input (no ADP, no Role Watch line) 3.14 / 2.67 / 2.52 / 1.82 (r .65 / .78 / .78 / .78);
# with the market 3.14 / 2.54 / 2.44 / 1.76 (r .65 / .80 / .79 / .80); the market's own line (Role Watch's fit on ADP alone; no QBs) 2.76 /
# 2.71 / 2.23 (r .77 / .76 / .70); last season's FP / G 3.93 / 3.02 / 2.84 / 1.98
MAE = {"model": [3.14, 2.67, 2.52, 1.82], "withmkt": [3.14, 2.54, 2.44, 1.76], "market": [None, 2.76, 2.71, 2.23], "last": [3.93, 3.02, 2.84, 1.98]}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", default=".cache/fb"); ap.add_argument("--data", default="data"); ap.add_argument("--current", type=int, default=2026)
    ap.add_argument("--study", action="store_true"); ap.add_argument("--snap", default=None); ap.add_argument("--from-snap", default=None)
    a = ap.parse_args()
    t0 = time.time()
    if a.from_snap:
        sn = pd.read_pickle(a.from_snap)
    else:
        seasons = list(range(2016, a.current + 1))
        S, I, T, E, RW, games, C = load(a.data, a.cache, seasons)
        sn = build_rows(S, I, T, E, RW, games, C, seasons, a.current)
        if a.snap:
            sn.to_pickle(a.snap)
    print(f"  {len(sn)} player-seasons, {len([c for c in sn.columns if c not in DROP])} inputs, {time.time() - t0:.0f}s", flush=True)
    if a.study:
        study(sn); return
    write(sn, a)


if __name__ == "__main__":
    main()

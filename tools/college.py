#!/usr/bin/env python3
"""Sean's football site: college production and a RAS-style athletic score for the preseason models (12 Nov 2026).

College: ESPN's college box scores, every FBS game 2010 on (sportsdataverse's espn_cfb_player_box / espn_cfb_team_box releases, the
same anonymous GitHub downloads as nflverse's), joined to NFL players by ESPN id (nflverse's players.parquet carries it; ESPN uses one
athlete id from college to the pros). A player's college seasons are the ones before his first NFL season. Per season: his share of
his team's receiving yards and receiving TDs (the "dominator"), receiving yards per team pass attempt, his rushing share, yards and
touchdowns a game, a QB's completion rate, yards per attempt, TD and INT rates, rushing; then his last season, his best, his career,
and the age he first reached a 20% dominator (a receiver's breakout age) or a 20% share of his team's scrimmage yards (a back's).

Athletic score: Kent Lee Platte's Relative Athletic Score is the idea — each measurement placed among the combine's players at the
same position and the scores averaged, 0-10 — rebuilt here from nflverse's combine file (ras.football itself answers 429 to a build),
with size (height, weight), speed (40, and the weight-adjusted speed score), explosion (vertical, broad) and agility (cone, shuttle).
"""
import os
from collections import defaultdict
import numpy as np
import pandas as pd

SDV = "https://github.com/sportsdataverse/sportsdataverse-data/releases/download"
NUM = ["passingYards", "passingTouchdowns", "interceptions", "rushingAttempts", "rushingYards", "rushingTouchdowns", "receptions", "receivingYards", "receivingTouchdowns", "adjQBR"]


def _seasons(cache, fetch, first=2010, last=2025):
    P, T = [], []
    os.makedirs(f"{cache}/cfb", exist_ok=True)
    for y in range(first, last + 1):
        p = fetch(f"{SDV}/espn_cfb_player_box/player_box_{y}.parquet", f"{cache}/cfb/player_box_{y}.parquet")
        t = fetch(f"{SDV}/espn_cfb_team_box/team_box_{y}.parquet", f"{cache}/cfb/team_box_{y}.parquet")
        if not p or not t:
            continue
        b = pd.read_parquet(p)
        for c in NUM:
            b[c] = pd.to_numeric(b[c], errors="coerce") if c in b else np.nan
        ca = b["completions/passingAttempts"].astype(str).str.split("/", expand=True) if "completions/passingAttempts" in b else None
        b["cmp"] = pd.to_numeric(ca[0], errors="coerce") if ca is not None else np.nan
        b["patt"] = pd.to_numeric(ca[1], errors="coerce") if ca is not None and ca.shape[1] > 1 else np.nan
        b["season"] = y
        P.append(b[["season", "game_id", "team_id", "athlete_id", "category", "cmp", "patt"] + NUM])
        t = pd.read_parquet(t)
        ca = t["completionAttempts"].astype(str).str.split("-|/", regex=True, expand=True)
        t["tatt"] = pd.to_numeric(ca[1], errors="coerce") if ca.shape[1] > 1 else np.nan
        t["season"] = y
        T.append(t[["season", "game_id", "team_id", "tatt"]])
    return pd.concat(P), pd.concat(T)


def college_table(cache, fetch, last=2025):
    """one row per (ESPN athlete id, college season): his totals, games, and his team's totals over the games it played"""
    P, T = _seasons(cache, fetch, last=last)
    P["team_id"] = P.team_id.astype(str); P["athlete_id"] = P.athlete_id.astype(str); T["team_id"] = T.team_id.astype(str)
    # a player's line: each category's own row carries its stats (passing / rushing / receiving), so sum per game first
    g = P.groupby(["season", "athlete_id", "team_id", "game_id"])[["cmp", "patt"] + NUM].sum(min_count=1).reset_index()
    qbr = P[P.category == "passing"].groupby(["season", "athlete_id"]).adjQBR.mean()
    s = g.groupby(["season", "athlete_id", "team_id"]).agg(gp=("game_id", "nunique"), **{c: (c, "sum") for c in ["cmp", "patt"] + NUM if c != "adjQBR"}).reset_index()
    s["qbr"] = [qbr.get((a, b), np.nan) for a, b in zip(s.season, s.athlete_id)]
    # the team's season: receiving yards and TDs and rushing yards are the players' sums (so shares add to 1), pass attempts the team box's
    tm = g.groupby(["season", "team_id"])[["receivingYards", "receivingTouchdowns", "rushingYards", "rushingTouchdowns"]].sum().add_prefix("t_").reset_index()
    ta = T.groupby(["season", "team_id"]).agg(t_att=("tatt", "sum"), t_gp=("game_id", "nunique")).reset_index()
    s = s.merge(tm, on=["season", "team_id"], how="left").merge(ta, on=["season", "team_id"], how="left")
    # a transfer mid-season (rare) or two rows for one season: keep the team he played the most games for
    s = s.sort_values("gp").drop_duplicates(["season", "athlete_id"], keep="last")
    return s


def _sd(a, b):
    return a / b if b and b == b and b > 0 else np.nan


def college_feats(cache, fetch, pl, idx):
    """gsis id -> college features (the seasons before his first NFL season)"""
    s = college_table(cache, fetch)
    by = defaultdict(list)
    for r in s.itertuples(index=False):
        by[r.athlete_id].append(r)
    out = {}
    for p in pl.itertuples(index=False):
        e = p.espn_id
        if e != e or e is None:
            continue
        e = str(int(float(e))) if str(e).replace(".", "").isdigit() else str(e)
        rows = by.get(e)
        if not rows:
            continue
        b = idx.get(p.gsis_id, {})
        rk = b.get("rk") or (p.rookie_season if p.rookie_season == p.rookie_season else None)
        rows = sorted((r for r in rows if not rk or r.season < rk), key=lambda r: r.season)
        if not rows:
            continue
        bd = pd.Timestamp(b["bd"]) if b.get("bd") else (pd.Timestamp(p.birth_date) if isinstance(p.birth_date, str) else None)
        per = []
        for r in rows:
            ry, rtd, ru, rutd = r.receivingYards or 0, r.receivingTouchdowns or 0, r.rushingYards or 0, r.rushingTouchdowns or 0
            gp = max(r.gp, 1)
            dom = np.nanmean([_sd(ry, r.t_receivingYards), _sd(rtd, r.t_receivingTouchdowns)]) if r.t_receivingYards else np.nan
            scr = _sd(ry + ru, (r.t_receivingYards or 0) + (r.t_rushingYards or 0))
            age = (pd.Timestamp(f"{r.season}-09-01") - bd).days / 365.25 if bd is not None else np.nan
            per.append(dict(season=r.season, gp=r.gp, dom=dom, rys=_sd(ry, r.t_receivingYards), rtds=_sd(rtd, r.t_receivingTouchdowns), ryptpa=_sd(ry, r.t_att),
                            rus=_sd(ru, r.t_rushingYards), scr=scr, recg=(r.receptions or 0) / gp, rydg=ry / gp, rudg=ru / gp, ypr=_sd(ry, r.receptions), ypc=_sd(ru, r.rushingAttempts),
                            carg=(r.rushingAttempts or 0) / gp, tdg=(rtd + rutd) / gp, scrg=(ry + ru) / gp, age=age,
                            cmpp=_sd(r.cmp, r.patt), ypa=_sd(r.passingYards, r.patt), ptdp=_sd(r.passingTouchdowns, r.patt), pintp=_sd(r.interceptions, r.patt),
                            pattg=(r.patt or 0) / gp, pydg=(r.passingYards or 0) / gp, qbr=r.qbr, att=r.patt or 0, recs=r.receptions or 0, car=r.rushingAttempts or 0))
        last = per[-1]
        f = {"col_n": len(per), "col_g": sum(x["gp"] for x in per), "col_age_last": last["age"]}
        for k in ("dom", "rys", "rtds", "ryptpa", "rus", "scr", "recg", "rydg", "rudg", "ypr", "ypc", "carg", "tdg", "scrg", "cmpp", "ypa", "ptdp", "pintp", "pattg", "pydg", "qbr"):
            f["col_" + k] = last[k]
        # a passer's rates from his last season with 100+ attempts (a receiver's trick-play throw isn't a passing line)
        pq = [x for x in per if x["att"] >= 100]
        for k in ("cmpp", "ypa", "ptdp", "pintp", "pattg", "pydg", "qbr"):
            f["col_" + k] = pq[-1][k] if pq else np.nan
        meaty = [x for x in per if x["gp"] >= 6]
        f["col_best_dom"] = max((x["dom"] for x in meaty if x["dom"] == x["dom"]), default=np.nan)
        f["col_best_scr"] = max((x["scr"] for x in meaty if x["scr"] == x["scr"]), default=np.nan)
        f["col_best_ryptpa"] = max((x["ryptpa"] for x in meaty if x["ryptpa"] == x["ryptpa"]), default=np.nan)
        f["col_car_dom"] = np.nanmean([x["dom"] for x in meaty]) if meaty and any(x["dom"] == x["dom"] for x in meaty) else np.nan
        f["col_car_scrg"] = np.nanmean([x["scrg"] for x in per])
        brk = [x["age"] for x in meaty if (x["dom"] == x["dom"] and x["dom"] >= 0.2)]
        f["col_bo_age"] = brk[0] if brk else np.nan             # the age he first reached a 20% dominator (none: left missing, flagged)
        f["col_bo_none"] = 0.0 if brk else 1.0
        brs = [x["age"] for x in meaty if (x["scr"] == x["scr"] and x["scr"] >= 0.2)]
        f["col_bos_age"] = brs[0] if brs else np.nan
        f["col_qb_att"] = sum(x["att"] for x in per)
        out[p.gsis_id] = f
    return out


# the athletic score: each measurement's percentile among the combine's players at his position (all years), 0-10, averaged by area then overall
RAS_TESTS = {"ht": 1, "wt": 1, "forty": -1, "speed": 1, "vert": 1, "broad": 1, "cone": -1, "shuttle": -1}
RAS_AREA = {"size": ("ht", "wt"), "speed": ("forty", "speed"), "expl": ("vert", "broad"), "agil": ("cone", "shuttle")}


def ras_table(comb, pl):
    """gsis id -> ras (0-10) and its four areas, from the combine (heights in the combine file are '6-2')"""
    pfr2g = dict(zip(pl.pfr_id, pl.gsis_id))
    c = comb.copy()
    c["ht"] = c.ht.astype(str).str.split("-", expand=True).apply(lambda r: float(r[0]) * 12 + float(r[1]) if r[0] not in (None, "None", "nan") and r[1] is not None else np.nan, axis=1) if "ht" in c else np.nan
    c = c.rename(columns={"vertical": "vert", "broad_jump": "broad"})
    c["speed"] = c.wt * 200 / c.forty ** 4
    c["pg"] = c.pos.map(lambda x: {"QB": "QB", "RB": "RB", "FB": "RB", "WR": "WR", "TE": "TE"}.get(x))
    c = c[c.pg.notna()]
    for k, sgn in RAS_TESTS.items():
        c[k + "_s"] = c.groupby("pg")[k].transform(lambda v: v.rank(pct=True, ascending=sgn > 0) * 10)
    out = {}
    for r in c.itertuples(index=False):
        g = pfr2g.get(r.pfr_id)
        if not isinstance(g, str):
            continue
        a = {}
        for nm, ks in RAS_AREA.items():
            v = [getattr(r, k + "_s") for k in ks if getattr(r, k + "_s") == getattr(r, k + "_s")]
            a["ras_" + nm] = float(np.mean(v)) if v else np.nan
        v = [x for x in a.values() if x == x]
        # like RAS, it needs most of the tests: three of the four areas
        a["ras"] = float(np.mean(v)) if len(v) >= 3 else np.nan
        out[g] = a
    return out

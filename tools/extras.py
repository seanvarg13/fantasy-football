#!/usr/bin/env python3
"""Sean's football site: three more preseason inputs (12 Nov 2026) — the Week 1 depth chart, contracts, and injury history.

* Depth chart: nflverse's depth charts. Through 2024 they are the league's weekly charts (week 1 = the chart going into Week 1); from 2025
  they are ESPN's charts captured daily, and the one used is the last capture before the season's first game. His rank at his spot (1 =
  first team), and whether he was a starter.
* Contracts: nflverse's historical contracts (Over The Cap): his contract in force at kickoff — its share of the cap a year, its
  guarantees, whether it was signed this offseason, years left, a rookie deal or a second contract. A deal's signing date isn't in the file,
  only its league year, so a contract signed during season y counts from y (most are signed in the offseason).
* Injuries: nflverse's weekly injury reports (2009 on): last season's weeks listed Out / Doubtful, weeks on the report, soft-tissue injuries
  (hamstring, groin, calf, quad, Achilles), and the same over the three seasons before.
"""
import os
from collections import defaultdict
import numpy as np
import pandas as pd

R = "https://github.com/nflverse/nflverse-data/releases/download"
GRP = {"QB": "QB", "RB": "RB", "HB": "RB", "FB": "RB", "WR": "WR", "TE": "TE"}
SOFT = ("hamstring", "groin", "calf", "quad", "achilles", "thigh")


def depth(cache, fetch, seasons, games):
    """(season, gsis id) -> {dc_rank, dc_start}"""
    first = games[games.game_type == "REG"].groupby("season").gameday.min().to_dict()
    out = {}
    for y in seasons:
        f = fetch(f"{R}/depth_charts/depth_charts_{y}.parquet", f"{cache}/depth_{y}.parquet")
        if not f:
            continue
        d = pd.read_parquet(f)
        if "week" in d.columns:   # the league's weekly charts
            d = d[(d.week == 1) & (d.formation == "Offense") & (d.game_type == "REG")]
            d = d.assign(g=d.position.map(GRP), rank=pd.to_numeric(d.depth_team, errors="coerce"))
        else:   # ESPN's daily captures: the last one before kickoff
            k = str(first.get(y, f"{y}-09-05"))
            d = d[d.dt.str[:10] < k]
            if not len(d):
                continue
            d = d[(d.dt == d.dt.max()) & ~d.pos_grp.str.contains("D$|Special", regex=True)]
            d = d.assign(g=d.pos_abb.map(GRP), rank=pd.to_numeric(d.pos_rank, errors="coerce"))
        d = d[d.g.notna() & d.gsis_id.notna()]
        for gid, r in d.groupby("gsis_id")["rank"].min().items():
            out[(y, gid)] = {"dc_rank": float(r), "dc_start": float(r == 1), "dc_listed": 1.0}
    return out


def contracts(cache, fetch):
    """gsis id -> his contracts [(year signed, years, cap share, guaranteed (inflated), draft year)]"""
    f = fetch(f"{R}/contracts/historical_contracts.parquet", f"{cache}/contracts.parquet")
    if not f:
        return {}
    c = pd.read_parquet(f, columns=["gsis_id", "year_signed", "years", "apy_cap_pct", "inflated_guaranteed", "inflated_apy", "draft_year"])
    c = c[c.gsis_id.notna() & (c.year_signed > 0)]
    out = defaultdict(list)
    for r in c.itertuples(index=False):
        out[r.gsis_id].append((int(r.year_signed), int(r.years) if r.years == r.years and r.years else 1, r.apy_cap_pct, r.inflated_guaranteed, r.inflated_apy, r.draft_year))
    return out


def contract_feats(K, gid, y):
    ks = [k for k in K.get(gid, []) if k[0] <= y]
    if not ks:
        return {}
    k = max(ks, key=lambda k: (k[0], k[2] or 0))   # the latest deal (two in one year: the bigger)
    return {"k_cap": k[2], "k_gtd": k[3], "k_apy": k[4], "k_new": float(k[0] == y), "k_left": float(k[0] + k[1] - y), "k_rookie": float(k[5] == k[0]),
            "k_second": float(k[5] == k[5] and k[0] > k[5]), "k_n": float(len(ks))}


def injuries(cache, fetch, seasons):
    """(season, gsis id) -> {out, listed, soft} over that regular season"""
    out = defaultdict(lambda: {"out": 0, "listed": 0, "soft": 0})
    for y in seasons:
        f = fetch(f"{R}/injuries/injuries_{y}.parquet", f"{cache}/injuries_{y}.parquet")
        if not f:
            continue
        d = pd.read_parquet(f)
        d = d[(d.game_type == "REG") & d.gsis_id.notna()].drop_duplicates(["gsis_id", "week"])
        inj = (d.report_primary_injury.fillna("") + " " + d.practice_primary_injury.fillna("")).str.lower()
        d = d.assign(o=d.report_status.isin(["Out", "Doubtful"]).astype(int), s=inj.str.contains("|".join(SOFT)).astype(int))
        for gid, g in d.groupby("gsis_id"):
            out[(y, gid)] = {"out": int(g.o.sum()), "listed": len(g), "soft": int(g.s.sum())}
    return out


def injury_feats(J, gid, y):
    a = J.get((y - 1, gid)); f = {}
    if a:
        f.update(inj1_out=a["out"], inj1_listed=a["listed"], inj1_soft=a["soft"])
    else:
        f.update(inj1_out=0.0, inj1_listed=0.0, inj1_soft=0.0)
    three = [J.get((s, gid)) for s in (y - 1, y - 2, y - 3)]
    f.update(inj3_out=float(sum(t["out"] for t in three if t)), inj3_soft=float(sum(t["soft"] for t in three if t)))
    return f

#!/usr/bin/env python3
"""Breakout odds and a ceiling for the preseason projections (12 Nov 2026).

The preseason model is unbiased on average but can't tell a Golden / Hubbard / Irving from the pack: its misses are the top tail of each
player's own range. This fits, forward (each season from models fitted only on earlier seasons), two small models on the finished projections:
  bo  = chance he beats his projection by 4+ points a game (a gradient-boosted classifier)
  hi  = his 80th-percentile points a game (a quantile gradient-boosted regressor)
from the projection, last year's points, age, years in the league, draft round, the market gap and the position. Written into data/pre.js
beside each player's `p`. Run after build_pre.py:  python3 tools/upside.py --data data
"""
import argparse, json, warnings
import numpy as np, pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier, HistGradientBoostingRegressor
warnings.filterwarnings("ignore")


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--data", default="data"); a = ap.parse_args()
    t = open(f"{a.data}/pre.js").read(); head = t[:t.index("{")]; P = json.loads(t[t.index("{"):t.rindex("}") + 1])
    t2 = open(f"{a.data}/index.js").read(); I = json.loads(t2[t2.index("=") + 1:].strip().rstrip(";"))
    rows = []
    for y, d in P["s"].items():
        for k, r in d.items():
            v = I.get(k, {}); pos = v.get("pos")
            if pos not in ("RB", "WR", "TE"): continue
            dr = v.get("dr") or [None, None, None]
            rows.append(dict(y=int(y), id=k, pos=pos, p=r["p"], p1=r.get("p1"), age=r.get("age"), exp=(int(y) - v["rk"]) if v.get("rk") else np.nan,
                             rd=dr[1] if dr[1] else 8, gap=(r["mk"] - r["p"]) if r.get("mk") is not None else np.nan, act=r.get("act"), g=r.get("g") or 0,
                             is_rb=float(pos == "RB"), is_wr=float(pos == "WR")))
    D = pd.DataFrame(rows); F = ["p", "p1", "age", "exp", "rd", "gap", "is_rb", "is_wr"]
    out = {}
    for y in sorted(D.y.unique()):
        tr = D[(D.y < y) & D.act.notna() & (D.g >= 6)]; te = D[D.y == y]
        if len(tr) < 400: continue
        yb = ((tr.act - tr.p) >= 4).astype(int)
        c = HistGradientBoostingClassifier(max_iter=120, learning_rate=0.05, max_leaf_nodes=6, min_samples_leaf=40, l2_regularization=2.0, random_state=3).fit(tr[F], yb)
        q = HistGradientBoostingRegressor(loss="quantile", quantile=0.8, max_iter=120, learning_rate=0.05, max_leaf_nodes=6, min_samples_leaf=40, random_state=3).fit(tr[F], tr.act)
        pb = c.predict_proba(te[F])[:, 1]; hi = q.predict(te[F])
        for i, (id_, b, h) in enumerate(zip(te.id, pb, hi)): out[(str(y), id_)] = (round(100 * float(b), 1), round(max(float(h), float(te.p.iloc[i])), 2))
    n = 0
    for (y, id_), (b, h) in out.items(): P["s"][y][id_]["bo"] = b; P["s"][y][id_]["hi"] = h; n += 1
    # honest check on the held-out seasons: do the top-decile odds actually break out more often?
    E = D[(D.y >= 2021) & D.act.notna() & (D.g >= 6)].copy(); E["bo"] = [out.get((str(y), i), (np.nan, np.nan))[0] for y, i in zip(E.y, E.id)]; E["hi"] = [out.get((str(y), i), (np.nan, np.nan))[1] for y, i in zip(E.y, E.id)]
    E = E.dropna(subset=["bo"]); E["hit"] = (E.act - E.p >= 4)
    top = E[E.bo >= E.bo.quantile(0.9)]; rest = E[E.bo < E.bo.quantile(0.9)]
    cover = float((E.act <= E.hi).mean())
    P["meta"]["upside"] = {"top_rate": round(float(top.hit.mean()), 3), "rest_rate": round(float(rest.hit.mean()), 3), "base": round(float(E.hit.mean()), 3), "ceil_cover": round(cover, 3), "test": "2021-25"}
    open(f"{a.data}/pre.js", "w").write(head + json.dumps(P, separators=(",", ":")) + ";\n")
    print("upside: wrote", n, "players;", P["meta"]["upside"])


if __name__ == "__main__":
    main()

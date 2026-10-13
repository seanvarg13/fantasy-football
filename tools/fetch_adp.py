#!/usr/bin/env python3
"""Save this season's preseason PPR ADP for Role Watch's market column.

    python3 tools/fetch_adp.py [--out data/adp] [--season 2027]

Fantasy Football Calculator serves only its last seven days of drafts, so last August's ADP can't be had later: the workflow
runs this from mid-August and each run replaces data/adp/ppr-<season>.json with the newer week, as long as that week ended
before the season's kickoff (the Thursday after Labor Day). Once games are played the file is left alone. Never fatal.
"""
import argparse, datetime as dt, json, os, sys, urllib.request

URL = "https://fantasyfootballcalculator.com/api/v1/adp/ppr?teams=12&year={y}&position=all"


def kickoff(y):
    labor = dt.date(y, 9, 1)
    while labor.weekday() != 0:
        labor += dt.timedelta(days=1)
    return labor + dt.timedelta(days=3)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="data/adp")
    ap.add_argument("--season", type=int, default=None)
    a = ap.parse_args()
    t = dt.date.today()
    y = a.season or (t.year if t.month >= 8 else t.year - 1)
    k = kickoff(y)
    if t > k + dt.timedelta(days=1):
        print(f"fetch_adp: {y} kicked off {k}, keeping what's saved"); return
    try:
        req = urllib.request.Request(URL.format(y=y), headers={"User-Agent": "Mozilla/5.0 (fantasy-football site)"})
        d = json.load(urllib.request.urlopen(req, timeout=60))
    except Exception as e:
        print(f"fetch_adp: couldn't fetch {y}: {e}"); return
    m = d.get("meta") or {}
    end = m.get("end_date") or ""
    if d.get("status") != "Success" or len(d.get("players") or []) < 150:
        print(f"fetch_adp: {y} came back thin ({len(d.get('players') or [])} players), not saved"); return
    if not end or dt.date.fromisoformat(end[:10]) >= k:
        print(f"fetch_adp: {y}'s window ends {end}, not before kickoff {k}; not saved"); return
    os.makedirs(a.out, exist_ok=True)
    p = os.path.join(a.out, f"ppr-{y}.json")
    if os.path.exists(p):
        old = (json.load(open(p)).get("meta") or {}).get("end_date") or ""
        if old >= end:
            print(f"fetch_adp: {p} already through {old}"); return
    with open(p, "w") as f:
        json.dump(d, f)
    print(f"fetch_adp: saved {p} ({m.get('start_date')} to {end}, {m.get('total_drafts')} drafts, {len(d['players'])} players)")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:      # a snapshot is a nicety; never take the update down
        print(f"fetch_adp: {e}")
    sys.exit(0)

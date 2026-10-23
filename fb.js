/* Sean's football site. One IIFE, no build step, no framework.
   Data: data/index.js (FB_INDEX: every player), data/teams.js (FB_TEAMS: every team-season's coaches and RB usage),
   data/career.js (FB_CAREER: season lines for the season table), data/fb-<season>.js (FB[season]: that season's
   players with weekly rows), loaded on demand. Pages by hash: #leaders, #player/<id>, #backfields, #team/<TM>/<season>,
   #coaches, #coach/<name>. */
(() => {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const el = (t, cls, txt) => { const e = document.createElement(t); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  const IDX = window.FB_INDEX || {}, TEAMS = window.FB_TEAMS || {};
  const SEASONS = Object.keys(TEAMS).map(Number).sort((a, b) => a - b), CUR = SEASONS[SEASONS.length - 1];
  const store = { get(k, d) { try { const v = localStorage.getItem("fb." + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
                  set(k, v) { try { localStorage.setItem("fb." + k, JSON.stringify(v)); } catch (e) {} } };
  const S = Object.assign({ season: CUR, pos: "WR", sort: null, dir: -1, bfSeason: CUR, coachRole: "hc", coachMin: 2 }, store.get("state", {}));
  const save = () => store.set("state", S);

  // ---------- loading ----------
  const scripts = {};
  function loadScript(src) {   // the season table's career file only loads with a player page
    if (!scripts[src]) scripts[src] = new Promise((res, rej) => { const s = document.createElement("script"); s.src = `${src}?v=${window.FB_BUILD || ""}`; s.onload = res; s.onerror = () => { delete scripts[src]; rej(new Error("load")); }; document.head.append(s); });
    return scripts[src];
  }
  const loading = {};
  // a player object knows its season (SEASON_OF): M(p) is handed the player alone, and stable YPRR needs that season's league
  const SEASON_OF = new WeakMap();
  const stamp = (y) => { const D = window.FB[y]; if (D && !SEASON_OF.has(D.players)) { SEASON_OF.set(D.players, y); for (const p of D.players) SEASON_OF.set(p, y); } return D; };
  function ensure(y) {
    if (window.FB && window.FB[y]) return Promise.resolve(stamp(y));
    if (!loading[y]) loading[y] = new Promise((res, rej) => { const s = document.createElement("script"); s.src = `data/fb-${y}.js?v=${window.FB_BUILD || ""}`;
      s.onload = () => res(stamp(y)); s.onerror = () => { delete loading[y]; rej(new Error("load")); }; document.head.append(s); });
    return loading[y];
  }

  // ---------- formatting and colour ----------
  const STOPS = [[54, 97, 173], [180, 207, 209], [216, 33, 41]];   // Savant's blue / middle / red, as the baseball site's pctStyle
  function heat(p) {
    const t = Math.max(0, Math.min(100, p)) / 100, lo = t < .5, a = lo ? STOPS[0] : STOPS[1], b = lo ? STOPS[1] : STOPS[2], u = lo ? t * 2 : (t - .5) * 2;
    const c = a.map((x, i) => Math.round(x + (b[i] - x) * u)), lum = (.2126 * c[0] + .7152 * c[1] + .0722 * c[2]) / 255;
    return { bg: `rgb(${c})`, fg: lum < .55 ? "#fff" : "#0c2340" };
  }
  const paint = (node, p) => { if (p == null || !isFinite(p)) return node; const h = heat(p); node.style.background = h.bg; node.style.color = h.fg; node.classList.add("heat"); return node; };
  const num = (v, d = 1) => v == null || !isFinite(v) ? "–" : v.toFixed(d);
  const sgn = (v, d = 1) => v == null || !isFinite(v) ? "–" : (Math.abs(v) < Math.pow(10, -d) / 2 ? (0).toFixed(d) : (v > 0 ? "+" : "−") + Math.abs(v).toFixed(d));
  const pc = (v, d = 1) => v == null || !isFinite(v) ? "–" : v.toFixed(d) + "%";
  const ord = (n) => { const s = ["th", "st", "nd", "rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
  const posGroup = (p) => (p === "FB" ? "RB" : p);
  const htFmt = (h) => (h ? `${Math.floor(h / 12)}-${h % 12}` : null);

  // ---------- derived metrics ----------
  const passFP = (p) => (p.pyd || 0) / 25 + 4 * (p.ptd || 0) - 2 * (p.int_ || 0);
  const memo = new WeakMap();
  // a target is worth 2.5 carries: an RB's target by xFP over his carry, 2016-25 (1.52 PPR against 0.61), and the weight that best
  // predicts a back's next-season points per game of every one from 1 to 5 tried
  const WO_K = 2.5;
  // stable YPRR (23 Oct 2026; Sean: "add stable YPRR ... the single-season version"): his targets per route × his yards per target
  // pulled toward his position's league by targets / (targets + SY_K). The league is the season's players of his group (FB with RB) with
  // 40+ targets (pro-rated in a season in progress, as qualifies() does), pooled yards over pooled targets. No QB or offense term: six
  // offense adjustments were tried that day and none transferred to a new club — the shrinkage is what carried (CLAUDE.md, Stable YPRR)
  const SY_K = 180, lgYptMemo = {};
  function lgYpt(y, pos) {
    const key = y + ":" + pos; if (key in lgYptMemo) return lgYptMemo[key];
    const D = window.FB[y]; let yd = 0, tg = 0;
    if (D) for (const q of D.players) if (posGroup(q.pos) === pos && (q.tgt || 0) >= 40 * frac(D.meta)) { yd += q.ryd || 0; tg += q.tgt || 0; }
    return (lgYptMemo[key] = tg ? yd / tg : null);
  }
  function stableYprr(p) {
    const y = SEASON_OF.get(p); if (!y || !(p.rts >= 1) || !(p.tgt >= 1)) return null;
    const lg = lgYpt(y, posGroup(p.pos)); if (lg == null) return null;
    return (p.tgt / p.rts) * (lg + (p.ryd / p.tgt - lg) * p.tgt / (p.tgt + SY_K));
  }
  function M(p) {
    if (memo.has(p)) return memo.get(p);
    const g = Math.max(p.g || 0, 1), opp = (p.car || 0) + (p.tgt || 0), touch = (p.car || 0) + (p.rec || 0);
    const xfp = (p.xr || 0) + (p.xu || 0) + (posGroup(p.pos) === "QB" ? passFP(p) : 0);
    const m = {
      g: p.g, tgt: p.tgt, rec: p.rec, ryd: p.ryd, rtd: p.rtd, car: p.car, ruyd: p.ruyd, rutd: p.rutd,
      att: p.att, pyd: p.pyd, ptd: p.ptd, int: p.int_, rts: p.rts,
      cmpp: p.att ? 100 * p.cmp / p.att : null,
      rte: p.tmdb ? 100 * p.rts / p.tmdb : null,
      tprr: p.rts >= 1 ? 100 * p.tgt / p.rts : null,
      tgtsh: p.tmt ? 100 * p.tgt / p.tmt : null,
      aysh: p.tmay > 0 ? 100 * p.ay / p.tmay : null,
      adot: p.tgt ? p.ay / p.tgt : null,
      wopr: p.tmt && p.tmay > 0 ? 1.5 * p.tgt / p.tmt + 0.7 * p.ay / p.tmay : null,
      rzt: p.rzt, glc: p.glc, rzc: p.rzc,
      yprr: p.rts >= 1 ? p.ryd / p.rts : null,
      syprr: stableYprr(p),
      ypr: p.rec ? p.ryd / p.rec : null,
      croe: p.xcn ? 100 * (p.cc - p.xc) / p.xcn : null,
      yacoe: p.yacn ? (p.yacs - p.xyac) / p.yacn : null,
      carsh: p.tmc ? 100 * p.car / p.tmc : null,
      snp: p.snpct, ypc: p.car ? p.ruyd / p.car : null,
      ryoe: p.ngsatt ? p.ryoe / p.ngsatt : null,
      oppg: opp / g, fppo: opp ? ((p.frt || 0) + (p.fru || 0)) / opp : null, fppt: touch ? p.fp / touch : null,
      xppo: opp ? ((p.xr || 0) + (p.xu || 0)) / opp : null,
      fpg: p.fp / g, xfpg: xfp / g, fpoeg: (p.fp - xfp) / g,
      tdoe: ((p.rtd || 0) + (p.rutd || 0)) - ((p.xtr || 0) + (p.xtu || 0)),
      epadb: p.db ? p.epa / p.db : null, cpoe: p.cpoe, sackp: p.db ? 100 * p.sk / p.db : null,
      ruxg: (p.xu || 0) / g, carg: (p.car || 0) / g,
      // the skill stats (16 Oct 2026): Next Gen's season row (sep / cush / nyoe, eff / tlos / box8) and PFR's charted counts over PFR's
      // own receptions, targets and carries
      sep: p.sep, cush: p.cush, nyoe: p.nyoe, eff: p.eff, tlos: p.tlos, box8: p.box8,
      // separation (21 Oct 2026; Sean: "I'd like to include those on the site", the free separation sources): NGS separation over what his
      // depth of target and cushion imply (the build's fit, sepoe), and FTN's contested targets — the share with a defender on him at the
      // catch, and that share over his position's rate at his target depths (null under 20 charted targets; FTN starts in 2022)
      sepoe: p.sepoe, cont: p.ftgt >= 20 ? 100 * p.cnt / p.ftgt : null, contoe: p.ftgt >= 20 ? 100 * (p.cnt - p.xcnt) / p.ftgt : null,
      // (null under 10 catches / 15 targets / 20 carries — PFR's season in progress lags the play-by-play by a week or two)
      brkr: p.pfrrec >= 10 ? 100 * p.btkr / p.pfrrec : null, dropp: p.pfrtgt >= 15 ? 100 * p.drops / p.pfrtgt : null,
      brka: p.pfratt >= 20 ? 100 * p.btka / p.pfratt : null, ybca: p.pfratt >= 20 ? p.ybc / p.pfratt : null, yaca: p.pfratt >= 20 ? p.ryac / p.pfratt : null,
      // elusiveness (18 Oct 2026; Sean: "for RBs like the broken tackle elusive metrics etc"): PFF's elusive-rating formula on PFR's
      // charting — broken tackles per touch × yards after contact per carry × 100 — and the run sizes from the play-by-play
      elus: p.pfratt >= 20 ? ((p.btka || 0) + (p.btkr || 0)) / (p.pfratt + (p.pfrrec || 0)) * (p.ryac / p.pfratt) * 100 : null,
      expl: p.x10 != null && p.car >= 20 ? 100 * p.x10 / p.car : null,
      bkwy: p.y15 != null && p.car >= 20 && p.ruyd > 0 ? 100 * p.y15 / p.ruyd : null,
      stuff: p.stf != null && p.car >= 20 ? 100 * p.stf / p.car : null,
      // weighted opportunity (20 Oct 2026; Sean: "fantasy football opportunity measures ... That like weight their opportunity"): a
      // target counts as WO_K carries — per game and as his share of his team's in his games; high-value touches (catches + carries
      // inside the 10) and his shares of his team's red-zone opportunities, carries inside the 5 and end-zone targets
      wog: ((p.car || 0) + WO_K * (p.tgt || 0)) / g,
      wos: p.tmc || p.tmt ? 100 * ((p.car || 0) + WO_K * (p.tgt || 0)) / ((p.tmc || 0) + WO_K * (p.tmt || 0)) : null,
      hvtg: p.c10 != null ? ((p.rec || 0) + p.c10) / g : null,
      hvtp: p.c10 != null && touch ? 100 * ((p.rec || 0) + p.c10) / touch : null,
      rzs: p.tmrzt != null && p.tmrzt + p.tmrzc ? 100 * ((p.rzt || 0) + (p.rzc || 0)) / (p.tmrzt + p.tmrzc) : null,
      gls: p.tmglc ? 100 * (p.glc || 0) / p.tmglc : null,
      ezs: p.tmezt ? 100 * (p.ezt || 0) / p.tmezt : null,
    };
    memo.set(p, m); return m;
  }
  // a full season is 17 games; a season in progress scales every minimum by the weeks played
  function frac(meta) { return Math.min(1, (meta.through || 18) / 17); }
  function qualifies(p, meta) {
    const f = frac(meta), g = posGroup(p.pos);
    if (g === "WR" || g === "TE") return p.rts >= 200 * f || p.tgt >= 40 * f;
    if (g === "RB") return (p.car || 0) + (p.tgt || 0) >= 90 * f;
    if (g === "QB") return (p.db || 0) >= 200 * f;
    return false;
  }
  const METRIC = {
    g: { h: "G", d: 0, hib: 1 }, rts: { h: "Rts", d: 0, hib: 1, t: "Routes run: dropbacks he was out on" }, tgt: { h: "Tgt", d: 0, hib: 1 }, rec: { h: "Rec", d: 0, hib: 1 }, ryd: { h: "Yds", d: 0, hib: 1 }, rtd: { h: "TD", d: 0, hib: 1 },
    car: { h: "Car", d: 0, hib: 1 }, ruyd: { h: "Yds", d: 0, hib: 1 }, rutd: { h: "TD", d: 0, hib: 1 },
    att: { h: "Att", d: 0, hib: 1 }, cmpp: { h: "Cmp%", d: 1, p: 1, hib: 1 }, pyd: { h: "Yds", d: 0, hib: 1 }, ptd: { h: "TD", d: 0, hib: 1 }, int: { h: "INT", d: 0, hib: 0 },
    rte: { h: "Route%", d: 0, p: 1, hib: 1, t: "Routes run on his team's dropbacks in his games" },
    tprr: { h: "TPRR", d: 1, p: 1, hib: 1, t: "Targets per route run" },
    tgtsh: { h: "Tgt%", d: 1, p: 1, hib: 1, t: "Share of his team's targets in his games" },
    aysh: { h: "AY%", d: 1, p: 1, hib: 1, t: "Share of his team's air yards in his games" },
    adot: { h: "aDOT", d: 1, hib: 1, t: "Average depth of target" },
    wopr: { h: "WOPR", d: 2, hib: 1, t: "1.5 × target share + 0.7 × air-yard share" },
    rzt: { h: "RZ Tgt", d: 0, hib: 1, t: "Targets inside the 20" },
    glc: { h: "GL Car", d: 0, hib: 1, t: "Carries inside the 5" }, rzc: { h: "RZ Car", d: 0, hib: 1 },
    yprr: { h: "YPRR", d: 2, hib: 1, t: "Receiving yards per route run" }, ypr: { h: "Y/R", d: 1, hib: 1 },
    syprr: { h: "sYPRR", d: 2, hib: 1, t: "Stable YPRR: his targets per route × his yards per target pulled toward his position's league average by targets / (targets + 180) — no QB or offense term (tested 23 Oct 2026: offense adjustments didn't transfer; this does). Repeats across a change of club at r .51 (raw YPRR .42), predicts a mover's next-season raw YPRR at .47 (.43) and next season's points per game at .62 (.61); describes this season's points the same (.82)" },
    croe: { h: "CROE", d: 1, s: 1, hib: 1, t: "Catch rate over expected (completion probability of each target)" },
    yacoe: { h: "YACOE", d: 1, s: 1, hib: 1, t: "Yards after catch over expected, per catch" },
    carsh: { h: "Car%", d: 1, p: 1, hib: 1, t: "Share of his team's carries in his games" },
    snp: { h: "Snap%", d: 0, p: 1, hib: 1, t: "Offensive snap share in his games" },
    ypc: { h: "YPC", d: 1, hib: 1 }, ryoe: { h: "RYOE/att", d: 2, s: 1, hib: 1, t: "Next Gen Stats rush yards over expected, per carry" },
    oppg: { h: "Opp/G", d: 1, hib: 1, t: "Carries + targets per game" },
    fppo: { h: "FP/Opp", d: 2, hib: 1, t: "PPR points per carry + target" }, fppt: { h: "FP/Tch", d: 2, hib: 1, t: "PPR points per carry + catch" },
    fpg: { h: "FP/G", d: 1, hib: 1, t: "PPR points per game" },
    xfpg: { h: "xFP/G", d: 1, hib: 1, t: "Expected PPR points per game: each target and carry priced by depth, field position, down and distance" },
    fpoeg: { h: "FPOE/G", d: 1, s: 1, hib: 1, t: "PPR points over expected, per game" },
    tdoe: { h: "TDOE", d: 1, s: 1, hib: 1, t: "Touchdowns over expected" },
    epadb: { h: "EPA/db", d: 2, s: 1, hib: 1, t: "Expected points added per dropback" }, cpoe: { h: "CPOE", d: 1, s: 1, hib: 1, t: "Completion % over expected" },
    sackp: { h: "Sack%", d: 1, p: 1, hib: 0 }, ruxg: { h: "Rush xFP/G", d: 1, hib: 1 }, carg: { h: "Car/G", d: 1, hib: 1 },
    // skills (16 Oct 2026; Sean: "wide receiver separation metrics ... rb broken tackles and skill stuff"): what he does with the ball, as
    // against the opportunity xFP prices. The tooltips carry what each one is worth (2018-25, qualified seasons): its tie to the season's
    // points per target / opportunity and to points over expected, and how well it repeats year to year — separation is a steady trait
    // that barely touches points; the catch-and-run stats explain this season's FPOE and carry a little forward; broken tackles are noise
    sep: { h: "Sep", d: 1, hib: 1, t: "Next Gen Stats: yards of separation from the nearest defender at the throw, on his targets. Repeats year to year at r .58 — but only +.14 with points per target and nothing with next season's points: a trait, not a points driver" },
    cush: { h: "Cushion", d: 1, hib: 1, t: "Next Gen Stats: yards the nearest defender gave him at the snap, on his targets. Repeats at r .46; a weak tie to points either way (−.14 with FP / G)" },
    // separation (21 Oct 2026): the same tests on every 40+ target season, separation over expected 2016-25 and FTN's contested targets
    // 2022-25 (985 / 389 receiver seasons; 632 / 224 back-to-back pairs): neither says more about points than separation does
    sepoe: { h: "SepOE", d: 2, s: 1, hib: 1, t: "Separation over expected: his Next Gen separation less what a receiver of his position gets at his depth of target and cushion (a fit over each season's WR / TE rows) — the depth taken out, as ESPN's Open Score does, but on his targets only. Repeats at r .45 (TE .27); +.24 with points per target and +.26 with points over expected this season, and nothing with next season's points (−.01; TE −.10)" },
    cont: { h: "Cont%", d: 1, p: 1, hib: 0, t: "Contested %: share of his targets with a defender on him at the catch point — lower is more open. FTN Data's charting via nflverse, 2022 on. Mostly noise year to year (r .29); −.10 with points per target and −.20 with points over expected this season, nothing with next season's points — and no warning sign: the most-covered receivers include stars their quarterbacks throw to anyway" },
    contoe: { h: "ContOE", d: 1, s: 1, hib: 0, t: "Contested over expected: his contested % less his position's rate at his target depths (each air-yard band, screens their own) — lower is more open than his routes' depth implies. FTN Data's charting via nflverse, 2022 on. Repeats at r .24 (TE .30); −.15 with points per target, nothing with next season's points" },
    nyoe: { h: "YAC+ (NGS)", d: 1, s: 1, hib: 1, t: "Next Gen Stats: yards after the catch over what the catch point, defenders and blockers expected, per catch. +.36 with points per target and +.35 with points over expected this season; repeats at r .35" },
    brkr: { h: "BrkT/Rec", d: 1, p: 1, hib: 1, t: "PFR's charted broken tackles per catch. +.12 with points per target; repeats at r .31" },
    dropp: { h: "Drop%", d: 1, p: 1, hib: 0, t: "PFR's charted drops per target. −.15 with points per target; repeats at only r .12 — nearly noise" },
    brka: { h: "BrkT/Att", d: 1, p: 1, hib: 1, t: "PFR's charted broken tackles per carry. +.19 with points per opportunity and +.27 with rushing points over expected this season; repeats at r .21" },
    ybca: { h: "YBC/att", d: 2, hib: 1, t: "PFR: rushing yards before contact per carry — the line and the scheme as much as the back. +.41 with points per opportunity; repeats at r .25" },
    yaca: { h: "YAC/att", d: 2, hib: 1, t: "PFR: rushing yards after contact per carry. +.26 with points per opportunity; repeats at r .34" },
    eff: { h: "Efficiency", d: 2, hib: 0, t: "Next Gen Stats: yards run per yard gained, as the tracking sees it — lower is a straighter runner. −.28 with points per opportunity (straighter is better); repeats at r .25" },
    tlos: { h: "Time to LOS", d: 2, hib: 0, t: "Next Gen Stats: seconds from the handoff to the line of scrimmage — lower is more decisive. Repeats at r .52; a weak tie to points (+.07 for the slower, patient backs)" },
    box8: { h: "8+ box%", d: 1, p: 1, hib: 1, t: "Next Gen Stats: share of his carries against eight or more defenders in the box — what the defense thinks of him, not his skill. Repeats at r .39" },
    // elusiveness (18 Oct 2026): every back's 100+ carry season, 2016-25 (PFR's charting from 2018), against this season's points per
    // opportunity and rushing points over expected per carry; year to year on 271 back-to-back pairs
    elus: { h: "Elusive", d: 1, hib: 1, t: "Elusive rating, PFF's formula on PFR's charting: broken tackles per touch (carries + catches) × yards after contact per carry × 100. PFR charts fewer broken tackles than PFF does missed tackles, so the scale runs lower than PFF's (a typical back ~15, the best ~30). +.32 with points per opportunity and +.37 with rushing points over expected this season; repeats at r .29" },
    expl: { h: "Expl%", d: 1, p: 1, hib: 1, t: "Explosive runs: carries of 10+ yards per carry. +.47 with points per opportunity and +.62 with rushing points over expected this season; repeats at r .27 — and with yards per carry the best of these at next season's rushing points over expected (+.24)" },
    bkwy: { h: "Breakaway%", d: 1, p: 1, hib: 1, t: "Breakaway %: share of his rushing yards gained on runs of 15+ yards — the big-play back as against the grinder. +.37 with points per opportunity and +.58 with rushing points over expected; repeats at r .30" },
    // weighted opportunity (20 Oct 2026): every qualified 2016-25 season against that season's FP / G, the same stat the next season and
    // next season's FP / G (6+ games) — 1,141 receiver, 501 tight-end and 608 back seasons
    wog: { h: "WO/G", d: 1, hib: 1, t: "Weighted opportunities per game: carries + 2.5 × targets — a back's target is worth 2.5 carries by xFP (1.52 PPR against 0.61). For backs the best volume measure of next season: r .63 with next season's FP/G, against .62 for xFP/G and .59 for plain carries + targets; repeats at r .65" },
    wos: { h: "WO%", d: 1, p: 1, hib: 1, t: "Weighted opportunity share: his carries + 2.5 × targets over his team's, in his games — his share of the offense, a target counted as 2.5 carries. r .68 (WR), .71 (TE), .62 (RB) with next season's FP/G, as good as xFP/G; repeats at r .72 / .73 / .65" },
    hvtg: { h: "HVT/G", d: 1, hib: 1, t: "High-value touches per game: catches + carries inside the 10, the touches that score (Ben Gretch's). r .84 with this season's FP/G and .55 with next season's; repeats at r .62" },
    hvtp: { h: "HVT%", d: 1, p: 1, hib: 1, t: "Share of his touches that are high-value (catches + carries inside the 10): what kind of back he is, not how much he plays — it repeats at r .73, the steadiest of these, but means nothing for points on its own (r .10)" },
    rzs: { h: "RZ Opp%", d: 1, p: 1, hib: 1, t: "His share of his team's targets and carries inside the 20, in his games. r .52 (WR), .59 (TE), .53 (RB) with next season's FP/G; repeats at r .52 / .53 / .59 — the scoring role moves more than overall volume" },
    gls: { h: "GL%", d: 1, p: 1, hib: 1, t: "His share of his team's carries inside the 5, in his games. Repeats at r .47; r .37 with next season's FP/G" },
    ezs: { h: "EZ Tgt%", d: 1, p: 1, hib: 1, t: "His share of his team's end-zone targets (thrown to the goal line or past it), in his games. Repeats at r .50 (WR) / .44 (TE); r .41 / .53 with next season's FP/G" },
    stuff: { h: "Stuff%", d: 1, p: 1, hib: 0, t: "Carries stopped at or behind the line — the line and the box as much as the back. −.23 with points per opportunity; repeats at r .27" },
  };
  const fmtM = (k, v) => { const d = METRIC[k] || { d: 1 }; return d.s ? sgn(v, d.d) : d.p ? pc(v, d.d) : num(v, d.d); };
  const COLS = {
    WR: [["Basic", ["g", "tgt", "rec", "ryd", "rtd"]], ["Usage", ["rte", "tprr", "tgtsh", "aysh", "adot", "wopr", "rzt"]], ["Weighted opportunity", ["wos", "rzs", "ezs"]], ["Efficiency", ["yprr", "syprr", "ypr", "croe", "yacoe"]], ["Separation", ["sep", "sepoe", "cush", "cont", "contoe"]], ["Skills", ["nyoe", "brkr", "dropp"]], ["Fantasy", ["xfpg", "fpg", "fpoeg", "tdoe"]]],
    RB: [["Basic", ["g", "car", "ruyd", "rutd", "tgt", "rec", "ryd"]], ["Usage", ["snp", "carsh", "tgtsh", "oppg", "glc", "rzc"]], ["Weighted opportunity", ["wog", "wos", "hvtg", "hvtp", "rzs", "gls"]], ["Efficiency", ["ypc", "ryoe", "yprr", "syprr", "fppo"]], ["Elusiveness", ["elus", "brka", "brkr", "yaca", "expl", "bkwy"]], ["Skills", ["ybca", "eff", "tlos", "box8", "stuff"]], ["Fantasy", ["xfpg", "fpg", "fpoeg", "tdoe"]]],
    QB: [["Passing", ["g", "att", "cmpp", "pyd", "ptd", "int"]], ["Efficiency", ["epadb", "cpoe", "sackp"]], ["Rushing", ["car", "ruyd", "rutd", "ruxg"]], ["Fantasy", ["xfpg", "fpg", "fpoeg"]]],
  };
  COLS.TE = COLS.WR;

  // pools: the season's qualifiers at his position, with every metric sorted for percentiles
  const pools = new Map();
  function pool(y, pos) {
    const key = y + ":" + pos; if (pools.has(key)) return pools.get(key);
    const D = window.FB[y], ref = D.players.filter((p) => posGroup(p.pos) === pos && qualifies(p, D.meta));
    const sorted = {}; for (const k in METRIC) sorted[k] = ref.map((p) => M(p)[k]).filter((v) => v != null && isFinite(v)).sort((a, b) => a - b);
    const sum = (f) => ref.reduce((s, p) => s + (f(p) || 0), 0);
    const L = { g: sum((p) => p.g), rts: sum((p) => p.rts), tgt: sum((p) => p.tgt), xr: sum((p) => p.xr), car: sum((p) => p.car), xu: sum((p) => p.xu),
                fp: sum((p) => p.fp), pfp: sum((p) => posGroup(p.pos) === "QB" ? passFP(p) : 0), n: ref.length };
    const r = { ref, sorted, L }; pools.set(key, r); return r;
  }
  function pctOf(y, pos, k, v) {
    const s = pool(y, pos).sorted[k]; if (v == null || !isFinite(v) || !s || s.length < 8) return null;
    let lo = 0, eq = 0; for (const x of s) { if (x < v) lo++; else if (x === v) eq++; }
    const p = 100 * (lo + eq / 2) / s.length; return (METRIC[k] && METRIC[k].hib === 0) ? 100 - p : p;
  }

  // ---------- B-Ref table helper ----------
  function table(groups, opts = {}) {
    const t = el("table", "br"), th = el("thead"), tb = el("tbody");
    if (groups.some((g) => g.name)) { const o = el("tr", "over"); for (const g of groups) { const c = el("th", g.end ? "ge" : "", g.name || ""); c.colSpan = g.cols.length; if (g.cls) c.className += " " + g.cls; o.append(c); } th.append(o); }
    const h = el("tr");
    for (const g of groups) g.cols.forEach((c, i) => { const cell = el("th", [c.cls || "", i === g.cols.length - 1 && g.end ? "ge" : ""].join(" ").trim(), c.h); if (c.t) cell.title = c.t; if (c.onSort) { cell.classList.add("sort"); cell.addEventListener("click", c.onSort); } if (c.lit) cell.classList.add("lit"); h.append(cell); });
    th.append(h); t.append(th, tb);
    const ends = []; let i = 0; for (const g of groups) { i += g.cols.length; if (g.end) ends.push(i - 1); }
    t.addRow = (cells, cls) => { const tr = el("tr", cls || ""); cells.forEach((c, j) => { const td = c instanceof Node ? c : el("td", null, c == null ? "" : String(c)); if (ends.includes(j)) td.classList.add("ge"); tr.append(td); }); tb.append(tr); return tr; };
    const box = el("div", "tbox" + (opts.tall ? " tall" : "")); box.append(t);
    if (opts.tall) { const w = el("div", "twrap"); w.append(floatHead(t, box, w), box); t.box = w; } else t.box = box;
    return t;
  }
  // a phone scrolls a tall table's rows with the page (Sean, 20 Oct 2026: "get rid of the table bouncy effect on mobile"): a box that
  // scrolls inside the page rubber-bands at its ends on an iPhone, so there the box is the table's full height and only slides sideways
  // (which doesn't bounce), and this copy of the column names is pinned under the site header by the page, slid sideways with the table,
  // its taps passed to the real names. A desktop doesn't draw it (fb.css); its box keeps scrolling inside.
  let floatSorted = false;   // a sort tapped on the pinned copy brings the re-sorted table's top back under the header
  function floatHead(t, box, w) {
    const fh = el("div", "fhead"), clip = el("div", "fhclip"), t2 = el("table", "br fhtable");
    t2.append(t.tHead.cloneNode(true)); clip.append(t2); fh.append(clip); fh.setAttribute("aria-hidden", "true");
    const size = () => {
      if (!fh.isConnected || !fh.offsetParent) return;
      const names = t.tHead.rows[t.tHead.rows.length - 1].cells;
      let cg = t2.querySelector("colgroup"); if (!cg) { cg = el("colgroup"); t2.prepend(cg); }
      cg.textContent = ""; for (const c of names) { const col = el("col"); col.style.width = c.getBoundingClientRect().width + "px"; cg.append(col); }
      t2.style.width = t.getBoundingClientRect().width + "px"; clip.style.width = box.clientWidth + "px";
      w.style.setProperty("--fhh", t.tHead.getBoundingClientRect().height + "px");
      const fz = names[0] && names[0].classList.contains("fz") ? names[0].getBoundingClientRect().width : 0; if (fz) t2.style.setProperty("--fzw", fz + "px");
      clip.scrollLeft = box.scrollLeft;
      if (floatSorted) { floatSorted = false; const y = w.getBoundingClientRect().top - (parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--toph")) || 0); if (y < 0) window.scrollBy(0, y); }
    };
    const ro = new ResizeObserver(() => size()); ro.observe(t); ro.observe(box);
    box.addEventListener("scroll", () => { if (clip.scrollLeft !== box.scrollLeft) clip.scrollLeft = box.scrollLeft; }, { passive: true });
    clip.addEventListener("scroll", () => { if (box.scrollLeft !== clip.scrollLeft) box.scrollLeft = clip.scrollLeft; }, { passive: true });
    t2.addEventListener("click", (e) => {
      const c = e.target.closest("th"); if (!c) return;
      const real = t.tHead.querySelectorAll("th")[[...t2.tHead.querySelectorAll("th")].indexOf(c)]; if (!real) return;
      if (fh.getBoundingClientRect().top > box.getBoundingClientRect().top + 1) floatSorted = true;   // pinned, so the page is down in the rows
      real.click();
    });
    return fh;
  }
  const td = (txt, cls) => el("td", cls || null, txt);
  const link = (txt, href) => { const a = el("a", "lnk", txt); a.href = href; return a; };
  const cellLink = (txt, href, cls) => { const c = td(null, cls || "l"); c.append(link(txt, href)); return c; };

  // ---------- header and search ----------
  // the baseball site's header (23 Oct 2026): the band with the red rule, every page a white boxy button in the condensed face — the
  // current one filled navy — and the search at the right; on a phone the search and a "☰ Menu" button share the one line and the
  // pages open under it as a grid of the same buttons (body.navopen), closing on a pick, a page change or a tap elsewhere
  const PAGES = [["#leaders", "Leaders"], ["#teams", "Teams"], ["#roles", "Role Watch"], ["#backfields", "Backfields"], ["#coaches", "Coaches"], ["#dynasty", "Dynasty"], ["#settings", "Settings"]];
  function header() {
    const top = el("header", "top"), inn = el("div", "in"), nav = el("nav", "nav");
    nav.setAttribute("aria-label", "Pages");
    for (const [h, lab] of PAGES) { const a = el("a", null, lab); a.href = h; a.dataset.page = h.slice(1); if (h === "#settings") a.title = "Stat glossary, appearance and how the pages work"; nav.append(a); }
    const sr = el("div", "srch"), inp = el("input"); inp.type = "search"; inp.placeholder = "Find a player…"; inp.setAttribute("aria-label", "Find a player");
    const hits = el("div", "hits"); hits.hidden = true; sr.append(inp, hits);
    const ALL = Object.entries(IDX).map(([id, e]) => ({ id, e, k: e.n.toLowerCase(), last: Math.max(...e.s) }));
    let cur = -1;
    const draw = () => {
      const q = inp.value.trim().toLowerCase(); hits.textContent = ""; cur = -1;
      if (q.length < 2) { hits.hidden = true; return; }
      const r = ALL.filter((x) => x.k.includes(q)).sort((a, b) => (b.k.startsWith(q) - a.k.startsWith(q)) || (b.last - a.last)).slice(0, 12);
      for (const x of r) { const b = el("button"); b.type = "button"; b.append(el("span", null, x.e.n), el("small", null, `${x.e.pos} · ${x.e.tm || ""} · ${Math.min(...x.e.s)}–${String(x.last).slice(2)}`)); b.addEventListener("click", () => { inp.value = ""; hits.hidden = true; location.hash = "#player/" + x.id; }); hits.append(b); }
      hits.hidden = !r.length;
    };
    inp.addEventListener("input", draw);
    inp.addEventListener("keydown", (e) => { const bs = [...hits.querySelectorAll("button")]; if (!bs.length) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); cur = (cur + (e.key === "ArrowDown" ? 1 : -1) + bs.length) % bs.length; bs.forEach((b, i) => b.classList.toggle("cur", i === cur)); }
      if (e.key === "Enter") (bs[cur] || bs[0]).click(); if (e.key === "Escape") { hits.hidden = true; } });
    document.addEventListener("click", (e) => { if (!sr.contains(e.target)) hits.hidden = true; });
    document.addEventListener("keydown", (e) => { if (e.key === "/" && !/^(input|textarea|select)$/i.test(e.target.tagName)) { e.preventDefault(); inp.focus(); } });   // "/" finds a player, as on the baseball site
    const nt = el("button", "navtog", "☰ Menu"); nt.type = "button"; nt.setAttribute("aria-expanded", "false");
    const setNav = (on) => { document.body.classList.toggle("navopen", on); nt.setAttribute("aria-expanded", String(on)); nt.textContent = on ? "✕ Close" : "☰ Menu"; };
    nt.addEventListener("click", (e) => { e.stopPropagation(); setNav(!document.body.classList.contains("navopen")); });
    window.addEventListener("hashchange", () => setNav(false));
    document.addEventListener("click", (e) => { if (document.body.classList.contains("navopen") && !top.contains(e.target)) setNav(false); });
    nav.querySelectorAll("a").forEach((a) => a.addEventListener("click", () => setNav(false)));
    inn.append(nav, sr, nt); top.append(inn); return top;
  }

  // ---------- Leaders ----------
  async function leaders(main) {
    const y = SEASONS.includes(+S.season) ? +S.season : CUR, pos = ["WR", "TE", "RB", "QB"].includes(S.pos) ? S.pos : "WR";
    const D = await ensure(y), meta = D.meta;
    const defSort = pos === "QB" ? "fpg" : "xfpg";
    if (!S.sort || !COLS[pos].some((g) => g[1].includes(S.sort))) { S.sort = defSort; S.dir = -1; }
    main.textContent = "";
    const tools = el("div", "tools"), seg = el("div", "seg");
    for (const p of ["WR", "TE", "RB", "QB"]) { const b = el("button", null, p); b.type = "button"; b.setAttribute("aria-pressed", p === pos); b.addEventListener("click", () => { S.pos = p; S.sort = null; save(); route(); }); seg.append(b); }
    const ss = el("select", "sel"); ss.setAttribute("aria-label", "Season");
    for (const s of [...SEASONS].reverse()) { const o = el("option", null, String(s)); o.value = s; if (s === y) o.selected = true; ss.append(o); }
    ss.addEventListener("change", () => { S.season = +ss.value; save(); route(); });
    const all = el("button", "tbtn", "Qualified only"); all.type = "button"; all.setAttribute("aria-pressed", S.qualOnly !== false);
    all.addEventListener("click", () => { S.qualOnly = S.qualOnly === false; save(); route(); });
    const rows = D.players.filter((p) => posGroup(p.pos) === pos && (S.qualOnly === false ? (p.tgt || p.car || p.db) : qualifies(p, meta)));
    const k = S.sort, dir = S.dir;
    rows.sort((a, b) => { const va = M(a)[k], vb = M(b)[k]; if (va == null) return 1; if (vb == null) return -1; return dir * (va - vb); });
    const f = frac(meta), minTxt = pos === "QB" ? `${Math.round(200 * f)}+ dropbacks` : pos === "RB" ? `${Math.round(90 * f)}+ carries + targets` : `${Math.round(200 * f)}+ routes or ${Math.round(40 * f)}+ targets`;
    tools.append(seg, ss, all, el("span", "count", `${rows.length} ${pos}s · ${y}${meta.through < 18 ? " · through week " + meta.through : ""} · PPR${S.qualOnly === false ? "" : " · " + minTxt}`));
    main.append(el("h1", "ttl", `${pos === "QB" ? "Quarterback" : pos === "RB" ? "Running back" : pos === "TE" ? "Tight end" : "Receiver"} Leaderboard`), tools);
    const sortBy = (key) => () => { if (S.sort === key) S.dir = -S.dir; else { S.sort = key; S.dir = METRIC[key].hib === 0 ? 1 : -1; } save(); route(); };
    const groups = [{ cols: [{ h: "Rk", cls: "fz" }, { h: "Player", cls: "l fz2" }, { h: "Tm" }], end: 1 }];
    for (const [name, keys] of COLS[pos]) groups.push({ name, end: 1, cols: keys.map((kk) => ({ h: METRIC[kk].h, t: METRIC[kk].t, onSort: sortBy(kk), lit: kk === k })) });
    const t = table(groups, { tall: true });
    rows.forEach((p, i) => {
      const m = M(p), cells = [td(String(i + 1), "fz"), cellLink(p.n, "#player/" + p.id, "l fz2"), td(p.tms && p.tms.length > 1 ? p.tms.join("/") : p.tm)];
      for (const [, keys] of COLS[pos]) for (const kk of keys) { const c = td(fmtM(kk, m[kk])); if (kk === k) paint(c, pctOf(y, pos, kk, m[kk])); cells.push(c); }
      t.addRow(cells);
    });
    main.append(t.box);
    const pl = pool(y, pos), avg = (kk) => { const v = pl.ref.map((p) => M(p)[kk]).filter((x) => x != null && isFinite(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
    const ac = [td(""), td(`Qualified avg (${pl.ref.length})`, "l fz2"), td("")];
    for (const [, keys] of COLS[pos]) for (const kk of keys) ac.push(td(fmtM(kk, avg(kk))));
    t.addRow(ac, "tot first");
    requestAnimationFrame(() => { const first = t.querySelector("tbody td.fz"); if (first) t.style.setProperty("--fzw", first.offsetWidth + "px"); });
    main.append(el("p", "note", "Tap a column name to sort, tap a name for his page. xFP prices each target and carry by what a play like it scores on average in PPR, fitted on the other seasons. " + (meta.estRoutes ? "Routes this season are estimated from snap share × team dropbacks until nflverse publishes participation." : "Routes are dropbacks he was on the field for.") + (pos === "WR" || pos === "TE" ? " Cont% and ContOE are FTN Data's charting via nflverse (CC BY-SA 4.0), from 2022." : "")));
  }

  // ---------- Player page ----------
  const BARS = {
    WR: [[["Opportunity", ["rte", "tgtsh", "tprr", "aysh", "rzt"]], ["Fantasy", ["xfpg", "fpg", "fpoeg", "tdoe"]], ["Profile", ["adot", "wopr", "snp"]]], [["Weighted opportunity", ["wos", "rzs", "ezs"]], ["Efficiency", ["yprr", "syprr", "croe", "yacoe", "ypr"]], ["Separation", ["sep", "sepoe", "cush", "cont", "contoe"]], ["Skills", ["nyoe", "brkr", "dropp"]]]],
    RB: [[["Opportunity", ["snp", "carsh", "tgtsh", "oppg", "glc"]], ["Weighted opportunity", ["wog", "wos", "hvtg", "hvtp", "rzs", "gls"]], ["Fantasy", ["xfpg", "fpg", "fpoeg", "tdoe"]]], [["Efficiency", ["ypc", "ryoe", "fppo", "yprr", "syprr"]], ["Elusiveness", ["elus", "brka", "yaca", "expl", "bkwy"]], ["Skills", ["ybca", "eff", "tlos", "stuff"]], ["Receiving", ["tprr", "croe", "yacoe", "brkr"]]]],
    QB: [[["Passing", ["epadb", "cpoe", "cmpp", "sackp"]], ["Fantasy", ["xfpg", "fpg", "fpoeg"]]], [["Rushing", ["carg", "ruxg", "ypc", "rutd"]], ["Volume", ["att", "pyd", "ptd"]]]],
  };
  BARS.TE = BARS.WR;
  const LABEL = { rte: "Route %", tgtsh: "Target share", tprr: "Targets / route", aysh: "Air-yard share", rzt: "Red-zone targets", xfpg: "xFP / game", fpg: "FP / game", fpoeg: "Points over exp. / G",
                  tdoe: "TD over expected", yprr: "Yards / route", syprr: "Stable YPRR", croe: "Catch rate over exp.", yacoe: "YAC over exp.", ypr: "Yards / catch", adot: "aDOT", wopr: "WOPR", snp: "Snap %",
                  carsh: "Carry share", oppg: "Opportunities / G", glc: "Goal-line carries", ypc: "Yards / carry", ryoe: "Rush yds over exp.", fppo: "FP / opportunity",
                  epadb: "EPA / dropback", cpoe: "CPOE", cmpp: "Completion %", sackp: "Sack %", carg: "Carries / game", ruxg: "Rush xFP / game", rutd: "Rush TD", att: "Attempts", pyd: "Pass yards", ptd: "Pass TD",
                  sep: "Separation", sepoe: "Separation over exp.", cont: "Contested target %", contoe: "Contested over exp.", cush: "Cushion", nyoe: "YAC over exp. (NGS)", brkr: "Broken tackles / catch", dropp: "Drop %", brka: "Broken tackles / carry", ybca: "Yds before contact", yaca: "Yds after contact", eff: "Efficiency (NGS)", tlos: "Time to the line",
                  elus: "Elusive rating", expl: "Explosive run %", bkwy: "Breakaway %", stuff: "Stuffed %",
                  wog: "Weighted opp. / G", wos: "Weighted opp. share", hvtg: "High-value touches / G", hvtp: "High-value touch %", rzs: "Red-zone opp. share", gls: "Goal-line carry share", ezs: "End-zone target share" };
  // what the skill stats are worth, under the bars (the study of 16 Oct 2026: every qualified season 2018-25 against this season's points
  // per target / opportunity, points over expected and next season's; year-to-year r in brackets)
  const SKILL_NOTE = {
    WR: "Separation and Skills: how open he gets and what he does with the ball, where the Opportunity bars are what he's given. Separation (repeats at r .58) and cushion (.46) are steady traits that barely touch points — separation reads +.14 with points per target this season and nothing with next season's. Separation over expected takes his depth of target and cushion out of it (repeats at r .45): +.24 with points per target, still nothing with next season's points. Contested % is the share of his targets with a defender on him at the catch (FTN Data's charting via nflverse, from 2022), and contested over expected the same against his position's rate at his target depths: both are mostly noise year to year (r .29 / .24) and no warning sign — the most-covered receivers include stars their quarterbacks throw to anyway. YAC over expected (.35), broken tackles (.31) and drops (.12) explain this season's points over expected and carry a little forward. None of them forecasts next season's points beyond this season's targets per route. Stable YPRR is his targets per route × his yards per target pulled toward his position's league by targets / (targets + 180) — the YPRR that travels: it repeats across a change of club at r .51 against raw YPRR's .42 (an offense or QB adjustment doesn't; the shrinkage does).",
    RB: "Elusiveness and Skills: what he does with a carry, where the Opportunity bars are how many he gets. The elusive rating (broken tackles per touch × yards after contact; +.32 with points per opportunity, repeats at r .29), explosive runs (10+ yards; +.47, repeats .27) and breakaway % (the share of his yards on 15+ yard runs; +.37, repeats .30) are the big-play side; yards before contact (+.41, repeats .25) and stuffed runs are the line and the scheme as much as the back. None of them holds year to year the way his workload does — next season's points follow this season's opportunities, not these.",
  };
  // weighted opportunity (20 Oct 2026): what the bars of that name are, and which of them carry into next season
  SKILL_NOTE.RB += " Weighted opportunity counts a target as 2.5 carries — what a back's target is worth over his carry by expected points — and per game it is the best volume measure of next season's points (r .63 with next season's FP/G, xFP/G .62, plain carries + targets .59). High-value touches are catches plus carries inside the 10; the high-value share says what kind of back he is (it repeats at r .73) more than how much he scores. The red-zone and goal-line shares are his slice of his team's chances there and move more from year to year (r .59 / .47).";
  SKILL_NOTE.WR += " Weighted opportunity share is his carries + 2.5 × targets over his team's, in his games: his slice of the offense, as good as xFP/G at next season's points (r .68 for receivers, .71 for tight ends) and a touch steadier year to year than his targets per game. For receivers, weighting targets by depth doesn't beat plain targets — a target is a target. The red-zone and end-zone shares are his part of his team's scoring chances; they move more from year to year (r .52 / .50 for receivers, .53 / .44 for tight ends).";
  SKILL_NOTE.TE = SKILL_NOTE.WR;

  async function player(main, id) {
    const e = IDX[id]; if (!e) { main.textContent = ""; main.append(el("p", "load", "No player with that id.")); return; }
    const seasons = [...e.s].sort((a, b) => a - b);
    let y = S.pseason && S.pseason[id] && seasons.includes(S.pseason[id]) ? S.pseason[id] : seasons[seasons.length - 1];
    const [D] = await Promise.all([ensure(y), loadScript("data/career.js").catch(() => null)]), p = D.players.find((q) => q.id === id);
    if (!p) { main.textContent = ""; main.append(el("p", "load", "No line for that season.")); return; }
    const pos = posGroup(p.pos), m = M(p), meta = D.meta;
    main.textContent = "";
    // band
    const band = el("section", "band"), r1 = el("div", "row1"), mug = el("div", "mug"); if (e.img) mug.style.backgroundImage = `url("${e.img}")`;
    const who = el("div", "who"); who.append(el("h1", null, e.n));
    const bio = el("div", "bio"), age = p.age != null ? Math.floor(p.age) : null;
    for (const s of [p.pos, p.tms && p.tms.length > 1 ? p.tms.join(" / ") : p.tm, age != null ? "Age " + age : null, e.ht ? `${htFmt(e.ht)} · ${e.wt}` : null, e.col, e.dr ? `${e.dr[0]} R${e.dr[1]} #${e.dr[2]}` : null]) if (s) bio.append(el("span", null, s));
    who.append(bio);
    const ctl = el("div", "ctl"), sel = el("select"); sel.setAttribute("aria-label", "Season");
    for (const s of [...seasons].reverse()) { const o = el("option", null, String(s)); o.value = s; if (s === y) o.selected = true; sel.append(o); }
    sel.addEventListener("change", () => { S.pseason = Object.assign({}, S.pseason, { [id]: +sel.value }); save(); route(); });
    ctl.append(sel); r1.append(mug, who, ctl);
    const facts = el("div", "facts");
    const fact = (lab, val, pcv) => { const d = el("div"), b = el("b"); if (pcv != null) { const s = el("span", "chip", val); paint(s, pcv); s.classList.remove("heat"); b.append(s); } else b.textContent = val; d.append(b, el("small", null, lab)); facts.append(d); };
    fact("G", String(p.g));
    if (pos === "QB") { fact("Pass Yds", String(p.pyd)); fact("Pass TD", String(p.ptd)); fact("INT", String(p.int_)); fact("Rush Yds", String(p.ruyd)); }
    else if (pos === "RB") { fact("Car", String(p.car)); fact("Rush Yds", String(p.ruyd)); fact("TD", String(p.rutd + p.rtd)); fact("Rec", String(p.rec)); }
    else { fact("Tgt", String(p.tgt)); fact("Rec", String(p.rec)); fact("Yds", String(p.ryd)); fact("TD", String(p.rtd)); }
    fact("FP/G", num(m.fpg), pctOf(y, pos, "fpg", m.fpg)); fact("xFP/G", num(m.xfpg), pctOf(y, pos, "xfpg", m.xfpg)); fact("FPOE/G", sgn(m.fpoeg), pctOf(y, pos, "fpoeg", m.fpoeg));
    band.append(r1, facts); main.append(band);
    // percentile bars
    const q = qualifies(p, meta);
    main.append(el("h2", "pcthd", `${y} ${pos} Percentiles`));
    if (!q) main.append(el("p", "note", `Under the ${pos} minimum this season, so he's placed among the qualified ${pos}s rather than counted in them.`));
    const cols = el("div", "pcols");
    BARS[pos].forEach((col, ci) => {
      const c = el("div");
      const sc = el("div", "scale"), mid = el("div"); mid.append(el("span", null, "Poor"), el("span", null, "Average"), el("span", null, "Great")); sc.append(el("span"), mid, el("span")); if (ci === 0) c.append(sc); else { sc.classList.add("desk"); c.append(sc); }
      for (const [name, keys] of col) {
        const s = el("div", "psec"); s.append(el("h4", null, name));
        for (const k of keys) {
          const v = m[k], pv = pctOf(y, pos, k, v), r = el("div", "prow" + (pv == null ? " none" : "")), trk = el("div", "trk");
          for (const x of [10, 50, 90]) { const tk = el("div", "tick"); tk.style.left = x + "%"; trk.append(tk); }
          if (pv != null) { const P = Math.round(pv), h = heat(P), fill = el("div", "fill"), bub = el("div", "bub", String(P)); fill.style.width = P + "%"; fill.style.background = h.bg; bub.style.left = P + "%"; bub.style.background = h.bg; trk.append(fill, bub); r.title = `${LABEL[k] || k}: ${fmtM(k, v)}, ${ord(P)} percentile among ${pool(y, pos).ref.length} qualified ${pos}s`; }
          r.append(el("div", "lb", LABEL[k] || METRIC[k].h), trk, el("div", "val", fmtM(k, v))); s.append(r);
        }
        c.append(s);
      }
      cols.append(c);
    });
    main.append(cols);
    if (SKILL_NOTE[pos]) main.append(el("p", "note", SKILL_NOTE[pos] + (m.sep == null && (pos === "WR" || pos === "TE") ? " Next Gen Stats carries no season row for him (under its target minimum)." : "") + (y < 2022 && (pos === "WR" || pos === "TE") ? " FTN's contested-target charting starts in 2022." : "")));
    // tabs
    const tabs = el("div", "tabs"), body = el("div");
    const TABS = [["build", "xFP build-up"], ["log", "Game log"]]; if (pos === "RB" && p.tm) TABS.push(["bf", "Backfield"]);
    const pick = TABS.some((t) => t[0] === S.ptab) ? S.ptab : "build";
    for (const [k, lab] of TABS) { const b = el("button", null, lab); b.type = "button"; b.setAttribute("aria-pressed", k === pick); b.addEventListener("click", () => { if (k === "bf") { location.hash = `#team/${p.tm}/${y}`; return; } S.ptab = k; save(); route(); }); tabs.append(b); }
    main.append(tabs, body);
    if (pick === "log") gameLog(body, p, meta); else buildUp(body, p, y, pos);
    seasonTable(main, id, e, y, pos);
  }

  function buildUp(host, p, y, pos) {
    const L = pool(y, pos).L, g = Math.max(p.g, 1), m = M(p);
    const rows = []; let run;
    const step = (lab, his, lg, next, t) => { const d = next - run; rows.push({ lab, his, lg, d, run: next, t }); run = next; };
    if (pos === "WR" || pos === "TE") {
      const Lr = L.rts / L.g, Lt = L.tgt / L.rts, Lx = L.xr / L.tgt, Lu = L.xu / L.g, r = p.rts / g, t = p.rts ? p.tgt / p.rts : 0, x = p.tgt ? p.xr / p.tgt : 0, u = p.xu / g;
      run = Lr * Lt * Lx + Lu; rows.push({ lab: `League ${pos}`, his: "", lg: "", d: null, run });
      step("Routes / game", num(r), num(Lr), r * Lt * Lx + Lu, "How often he's out running routes");
      step("Targets / route", pc(100 * t), pc(100 * Lt), r * t * Lx + Lu, "How often he gets the ball thrown his way when he's out there");
      step("xFP / target", num(x, 2), num(Lx, 2), r * t * x + Lu, "What his targets are worth: deep, end-zone and red-zone looks price higher");
      step("Rushing xFP / game", num(u, 2), num(Lu, 2), r * t * x + u, "Carries, priced the same way");
    } else if (pos === "RB") {
      const Lc = L.car / L.g, Lxc = L.xu / L.car, Lt = L.tgt / L.g, Lx = L.xr / L.tgt, c = p.car / g, xc = p.car ? p.xu / p.car : 0, t = p.tgt / g, x = p.tgt ? p.xr / p.tgt : 0;
      run = Lc * Lxc + Lt * Lx; rows.push({ lab: "League RB", his: "", lg: "", d: null, run });
      step("Carries / game", num(c), num(Lc), c * Lxc + Lt * Lx, "His share of the work on the ground");
      step("xFP / carry", num(xc, 2), num(Lxc, 2), c * xc + Lt * Lx, "Where his carries come: goal-line work prices highest");
      step("Targets / game", num(t), num(Lt), c * xc + t * Lx, "His role in the passing game");
      step("xFP / target", num(x, 2), num(Lx, 2), c * xc + t * x, "What his targets are worth");
    } else {
      const Lp = L.pfp / L.g, Lc = L.car / L.g, Lxc = L.xu / L.car, pf = passFP(p) / g, c = p.car / g, xc = p.car ? p.xu / p.car : 0;
      run = Lp + Lc * Lxc; rows.push({ lab: "League QB", his: "", lg: "", d: null, run });
      step("Passing points / game", num(pf), num(Lp), pf + Lc * Lxc, "Passing yards, touchdowns and interceptions as scored");
      step("Carries / game", num(c), num(Lc), pf + c * Lxc, "Designed runs and scrambles");
      step("xFP / carry", num(xc, 2), num(Lxc, 2), pf + c * xc, "Where his carries come");
    }
    const xfpg = run; rows[rows.length - 1].mark = true;
    const tdo = ((p.rtd || 0) + (p.rutd || 0)) - ((p.xtr || 0) + (p.xtu || 0));
    const tdPts = 6 * tdo / g, playPts = ((p.frt || 0) + (p.fru || 0) - (p.xr || 0) - (p.xu || 0)) / g - tdPts;
    step("Touchdowns over expected", sgn(tdo), "0.0", run + tdPts, `${(p.rtd || 0) + (p.rutd || 0)} touchdowns against ${num((p.xtr || 0) + (p.xtu || 0))} expected: the least repeatable part`);
    step("Catches and yards over expected", "", "", run + playPts, "Catching more than expected and gaining more after the catch or per carry: partly skill");
    step("Other", "", "", m.fpg, "Fumbles lost, two-point conversions, and for non-QBs any passing");
    const split = el("div", "split"), left = el("div");
    left.append(el("h3", "secttl", "Fantasy points build-up"));
    const t = table([{ cols: [{ h: "Step", cls: "l" }, { h: "His" }, { h: "Lg" }, { h: "± FP/G" }, { h: "FP/G" }] }]);
    for (const r of rows) {
      const lab = td(r.lab, "l"); if (r.t) lab.title = r.t;
      const dc = td(""); if (r.d != null) { const s = el("span", "pill", sgn(r.d)); paint(s, 50 + 14 * r.d); s.classList.remove("heat"); dc.append(s); }
      const rc = td(num(r.run), r.mark ? "kexp" : ""); if (r.mark) rc.title = "Expected FP / game: what his usage says he should score";
      t.addRow([lab, td(r.his), td(r.lg), dc, rc]);
    }
    t.addRow([td("FP / game", "l"), td(""), td(""), td(sgn(m.fpg - rows[0].run)), td(num(m.fpg))], "tot first");
    left.append(t.box, el("p", "note", `Each step swaps the qualified ${pos}s' average for his. The yellow cell is his expected points per game (${num(xfpg)}): his usage priced play by play. Below it, touchdown luck and the rest of the gap to what he scored.`));
    // TD detail
    const right = el("div"); right.append(el("h3", "secttl", "Where the gap comes from"));
    const t2 = table([{ cols: [{ h: "Piece", cls: "l" }, { h: "Exp" }, { h: "Act" }, { h: "± FP/G" }, { h: "Share" }] }]);
    const parts = [];
    if (p.tgt) parts.push(["Receiving TD", num(p.xtr), String(p.rtd), 6 * ((p.rtd || 0) - (p.xtr || 0)) / g]);
    if (p.car) parts.push(["Rushing TD", num(p.xtu), String(p.rutd), 6 * ((p.rutd || 0) - (p.xtu || 0)) / g]);
    if (p.tgt) parts.push(["Catches + rec. yards", num((p.xr - 6 * (p.xtr || 0)) / g, 1) + "/G", num((p.frt - 6 * (p.rtd || 0)) / g, 1) + "/G", ((p.frt - 6 * (p.rtd || 0)) - (p.xr - 6 * (p.xtr || 0))) / g]);
    if (p.car) parts.push(["Rushing yards", num((p.xu - 6 * (p.xtu || 0)) / g, 1) + "/G", num((p.fru - 6 * (p.rutd || 0)) / g, 1) + "/G", ((p.fru - 6 * (p.rutd || 0)) - (p.xu - 6 * (p.xtu || 0))) / g]);
    const other = m.fpg - (p.frt + p.fru) / g - (pos === "QB" ? passFP(p) / g : 0); if (Math.abs(other) >= 0.05) parts.push(["Fumbles, 2-pt, other", "", "", other]);
    const tot = parts.reduce((s, x) => s + Math.abs(x[3]), 0);
    for (const [lab, ex, ac, d] of parts.sort((a, b) => Math.abs(b[3]) - Math.abs(a[3]))) { const dc = td(""), s = el("span", "pill", sgn(d)); paint(s, 50 + 14 * d); s.classList.remove("heat"); dc.append(s); t2.addRow([td(lab, "l"), td(ex), td(ac), dc, td(tot >= 0.1 ? Math.round(100 * Math.abs(d) / tot) + "%" : "–")]); }
    t2.addRow([td("FP / game", "l"), td(num(m.xfpg)), td(num(m.fpg)), td(sgn(m.fpoeg)), td(tot >= 0.1 ? "100%" : "")], "tot first");
    right.append(t2.box, el("p", "note", "Each piece's part of the gap between his expected and actual points; the shares add to 100%. Touchdown luck is the part least likely to carry into next season."));
    split.append(left, right); host.append(split);
  }

  function gameLog(host, p, meta) {
    host.append(el("h3", "secttl", "Game log"));
    const F = meta.wfields, ix = (k) => F.indexOf(k);
    const t = table([{ cols: [{ h: "Wk" }, { h: "Opp" }, { h: "Snap%" }, { h: "Rts" }], end: 1 }, { name: "Receiving", end: 1, cols: [{ h: "Tgt" }, { h: "Rec" }, { h: "Yds" }, { h: "TD" }] },
                     { name: "Rushing", end: 1, cols: [{ h: "Car" }, { h: "Yds" }, { h: "TD" }] }, { name: "Fantasy", end: 1, cols: [{ h: "xFP" }, { h: "FP" }, { h: "Diff" }] }]);
    const xs = p.w.map((r) => r[ix("xfp")]), lo = Math.min(...xs), hi = Math.max(...xs);
    for (const r of p.w) {
      const x = r[ix("xfp")], f = r[ix("fp")], xc = td(num(x)); if (hi > lo) paint(xc, 100 * (x - lo) / (hi - lo));
      const dc = td(sgn(f - x)); dc.style.color = f - x > 0.5 ? "var(--stripe)" : f - x < -0.5 ? "#3661ad" : "";
      t.addRow([td(String(r[ix("wk")])), td((r[ix("tm")] && p.tms && p.tms.length > 1 ? r[ix("tm")] + " v " : "") + (r[ix("opp")] || "")), td(r[ix("snp")] == null ? "–" : r[ix("snp")] + "%"), td(num(r[ix("rts")], 0)),
                td(String(r[ix("tgt")])), td(String(r[ix("rec")])), td(String(r[ix("ryd")])), td(String(r[ix("rtd")])), td(String(r[ix("car")])), td(String(r[ix("ruyd")])), td(String(r[ix("rutd")])), xc, td(num(f)), dc]);
    }
    const sum = (k) => p.w.reduce((s, r) => s + (r[ix(k)] || 0), 0);
    t.addRow([td("Season", "l"), td(""), td(p.snpct == null ? "" : Math.round(p.snpct) + "%"), td(String(Math.round(sum("rts")))), td(String(sum("tgt"))), td(String(sum("rec"))), td(String(sum("ryd"))), td(String(sum("rtd"))),
              td(String(sum("car"))), td(String(sum("ruyd"))), td(String(sum("rutd"))), td(num(sum("xfp"))), td(num(sum("fp"))), td(sgn(sum("fp") - sum("xfp")))], "tot first");
    host.append(t.box, el("p", "note", "xFP is coloured within his own season, darkest red his biggest-opportunity game. Passing stats aren't in the weekly rows yet; a QB's FP includes them."));
  }

  function staffOf(y, tm) { const r = (TEAMS[y] || []).find((x) => x.tm === tm); return r || {}; }
  function seasonTable(host, id, e, cy, pos) {
    const C = (window.FB_CAREER || {})[id] || {}, ys = Object.keys(C).map(Number).sort((a, b) => a - b); if (!ys.length) return;
    host.append(el("h3", "secttl", "Season by season"));
    const recv = pos !== "QB", groups = [{ cols: [{ h: "Season", cls: "fz" }, { h: "Age" }, { h: "Tm" }, { h: "Head coach", cls: "l" }, { h: "Off. coordinator", cls: "l" }], end: 1 }, { cols: [{ h: "G" }], end: 1 }];
    if (pos === "QB") groups.push({ name: "Passing", end: 1, cols: [{ h: "Cmp" }, { h: "Att" }, { h: "Yds" }, { h: "TD" }, { h: "INT" }, { h: "EPA/db" }] });
    groups.push({ name: "Receiving", end: 1, cols: [{ h: "Tgt" }, { h: "Rec" }, { h: "Yds" }, { h: "TD" }, { h: "Tgt%" }] });
    groups.push({ name: "Rushing", end: 1, cols: [{ h: "Car" }, { h: "Yds" }, { h: "TD" }, { h: "Car%" }] });
    groups.push({ name: "Fantasy", end: 1, cols: [...(recv ? [{ h: "WO%", t: METRIC.wos.t }] : []), { h: "xFP/G" }, { h: "FP/G" }, { h: "FPOE/G" }, { h: "Rank" }] });
    const t = table(groups), wo = (r) => (r.car || 0) + WO_K * (r.tgt || 0), tmwo = (r) => (r.tmc || 0) + WO_K * (r.tmt || 0);   // weighted opportunity share, as the Leaders' WO%
    let G = 0, fpS = 0, xS = 0, woS = 0, tmwoS = 0; const tot = { tgt: 0, rec: 0, ryd: 0, rtd: 0, car: 0, ruyd: 0, rutd: 0, cmp: 0, att: 0, pyd: 0, ptd: 0, int_: 0 };
    for (const y of ys) {
      const r = C[y], g = Math.max(r.g || 0, 1), xfp = (r.xr || 0) + (r.xu || 0) + (pos === "QB" ? passFP(r) : 0), st = staffOf(y, r.tm);
      G += r.g || 0; fpS += r.fp || 0; xS += xfp; woS += wo(r); tmwoS += tmwo(r); for (const k in tot) tot[k] += r[k] || 0;
      const coachCell = (n) => { const c = td(null, "l"); if (n) for (const [i, nm] of n.split(" / ").entries()) { if (i) c.append(" / "); c.append(link(nm, "#coach/" + encodeURIComponent(nm))); } else c.textContent = "–"; return c; };
      const cells = [td(String(y), "fz"), td(r.age != null ? String(Math.floor(r.age)) : ""), td(r.tms && r.tms.length > 1 ? r.tms.join("/") : r.tm), coachCell(st.hc), coachCell(st.oc || (st.pc ? st.pc + " (HC)" : null)), td(String(r.g))];
      if (pos === "QB") cells.push(td(String(r.cmp || 0)), td(String(r.att || 0)), td(String(r.pyd || 0)), td(String(r.ptd || 0)), td(String(r.int_ || 0)), td(r.db ? sgn(r.epa / r.db, 2) : "–"));
      cells.push(td(String(r.tgt || 0)), td(String(r.rec || 0)), td(String(r.ryd || 0)), td(String(r.rtd || 0)), td(r.tmt ? pc(100 * r.tgt / r.tmt) : "–"));
      cells.push(td(String(r.car || 0)), td(String(r.ruyd || 0)), td(String(r.rutd || 0)), td(r.tmc ? pc(100 * r.car / r.tmc) : "–"));
      const xc = td(num(xfp / g)); paint(xc, Math.min(99, Math.max(1, 100 - 100 * ((r.xrk || 60) - 1) / 60)));
      if (recv) cells.push(td(tmwo(r) ? pc(100 * wo(r) / tmwo(r)) : "–"));
      cells.push(xc, td(num((r.fp || 0) / g)), td(sgn(((r.fp || 0) - xfp) / g)), td(r.rk ? pos + r.rk : "–"));
      const tr = t.addRow(cells, y === cy ? "cur" : ""); tr.querySelector("td").title = y === cy ? "The season shown above" : "";
    }
    const g = Math.max(G, 1), cells = [td(`${ys.length} Yrs`, "fz"), td(""), td(""), td(""), td(""), td(String(G))];
    if (pos === "QB") cells.push(td(String(tot.cmp)), td(String(tot.att)), td(String(tot.pyd)), td(String(tot.ptd)), td(String(tot.int_)), td(""));
    cells.push(td(String(tot.tgt)), td(String(tot.rec)), td(String(tot.ryd)), td(String(tot.rtd)), td(""), td(String(tot.car)), td(String(tot.ruyd)), td(String(tot.rutd)), td(""), ...(recv ? [td(tmwoS ? pc(100 * woS / tmwoS) : "")] : []), td(num(xS / g)), td(num(fpS / g)), td(sgn((fpS - xS) / g)), td(""));
    t.addRow(cells, "tot first"); host.append(t.box);
    host.append(el("p", "note", "Coaches are the team's head coach and offensive coordinator that season (a traded player shows his main team's). xFP/G is coloured by his rank at the position that season by expected points."));
  }

  // ---------- Backfields ----------
  const share = (a, b) => (b ? 100 * a / b : null);
  async function backfields(main) {
    const y = SEASONS.includes(+S.bfSeason) ? +S.bfSeason : CUR, rows = TEAMS[y] || [];
    main.textContent = "";
    main.append(el("h1", "ttl", "Backfields"), el("p", "sub", "How each team split its running back work. Shares count only the games the lead back played, so an injury doesn't make a bell cow look like a committee."));
    const tools = el("div", "tools"), ss = el("select", "sel"); ss.setAttribute("aria-label", "Season");
    for (const s of [...SEASONS].reverse()) { const o = el("option", null, String(s)); o.value = s; if (s === y) o.selected = true; ss.append(o); }
    ss.addEventListener("change", () => { S.bfSeason = +ss.value; save(); route(); }); tools.append(ss); main.append(tools);
    const sortK = S.bfSort || "rb1car", dir = S.bfDir || -1;
    const val = (r, k) => k === "rbtgt" ? share(r.rbtgt, r.tmtgt) : k === "rb1fp" ? fpo(r.rbs[0]) : k === "rb2fp" ? (r.rbs[1] ? fpo(r.rbs[1]) : null) : k === "rb1snp" ? r.rbs[0].snp : r[k];
    const sorted = [...rows].sort((a, b) => { const va = val(a, sortK), vb = val(b, sortK); if (va == null) return 1; if (vb == null) return -1; return dir * (va - vb); });
    const sb = (k) => () => { if (S.bfSort === k) S.bfDir = -(S.bfDir || -1); else { S.bfSort = k; S.bfDir = -1; } save(); route(); };
    const t = table([{ cols: [{ h: "Tm", cls: "fz" }, { h: "Head coach", cls: "l" }, { h: "Off. coordinator", cls: "l" }], end: 1 },
                     { name: "Lead back, in his games", end: 1, cols: [{ h: "RB1", cls: "l" }, { h: "G" }, { h: "Car%", onSort: sb("rb1car"), lit: sortK === "rb1car", t: "His share of the team's RB carries in the games he played" }, { h: "Opp%", onSort: sb("rb1opp"), lit: sortK === "rb1opp", t: "Share of RB carries + targets" }, { h: "Snap%", onSort: sb("rb1snp"), lit: sortK === "rb1snp" }, { h: "GL%", onSort: sb("rb1gl"), lit: sortK === "rb1gl", t: "Share of RB carries inside the 5" }] },
                     { name: "The rest", end: 1, cols: [{ h: "RB2", cls: "l" }, { h: "Car%", onSort: sb("rb2car"), lit: sortK === "rb2car" }, { h: "Backs used", onSort: sb("eff"), lit: sortK === "eff", t: "Effective number of backs: 1 = one back took every carry, 2 = an even split" }] },
                     { name: "Passing game", end: 1, cols: [{ h: "RB Tgt%", onSort: sb("rbtgt"), lit: sortK === "rbtgt", t: "Share of all team targets that went to running backs" }] },
                     { name: "PPR pts per carry + target", end: 1, cols: [{ h: "RB1", onSort: sb("rb1fp"), lit: sortK === "rb1fp" }, { h: "RB2", onSort: sb("rb2fp"), lit: sortK === "rb2fp" }] }], { tall: true });
    const all = rows.map((r) => r.rb1car), pctIn = (arr, v, hib = 1) => { const s = arr.filter((x) => x != null).sort((a, b) => a - b); let lo = 0; for (const x of s) if (x < v) lo++; const p = 100 * lo / Math.max(s.length - 1, 1); return hib ? p : 100 - p; };
    for (const r of sorted) {
      const b1 = r.rbs[0], b2 = r.rbs[1], coach = (n) => { const c = td(null, "l"); if (n) n.split(" / ").forEach((nm, i) => { if (i) c.append(" / "); c.append(link(nm, "#coach/" + encodeURIComponent(nm))); }); else c.textContent = "–"; return c; };
      const car = td(pc(r.rb1car)); paint(car, pctIn(all, r.rb1car));
      const eff = td(num(r.eff, 2)); paint(eff, pctIn(rows.map((x) => x.eff), r.eff));
      const f1 = fpo(b1), f2 = b2 ? fpo(b2) : null, f2c = td(num(f2, 2)); if (f2 != null && f1 != null && f2 > f1 + 0.1) { f2c.style.color = "var(--stripe)"; f2c.style.fontWeight = "700"; f2c.title = "More points per opportunity than the lead back"; }
      t.addRow([cellLink(r.tm, `#team/${r.tm}/${y}`, "fz"), coach(r.hc), coach(r.oc || (r.pc ? r.pc + " (HC)" : null)), cellLink(b1.n, "#player/" + b1.id), td(String(r.rb1g)), car, td(pc(r.rb1opp)), td(b1.snp == null ? "–" : Math.round(b1.snp) + "%"), td(r.rb1gl == null ? "–" : pc(r.rb1gl, 0)),
                b2 ? cellLink(b2.n, "#player/" + b2.id) : td("–"), td(pc(r.rb2car)), eff, td(pc(share(r.rbtgt, r.tmtgt))), td(num(f1, 2)), f2c]);
    }
    main.append(t.box, el("p", "note", "Car% is coloured red for the most bell-cow backfields, blue for the most shared; Backs used the same way round. An RB2 in red outscored his lead back per opportunity, the case where more work tends to follow. Tap a team for its week-by-week split."));
  }
  const fpo = (b) => (b && b.car + b.tgt ? b.fp / (b.car + b.tgt) : null);

  // ---------- one team's backfield, week by week ----------
  const COLORS = ["#c8102e", "#3661ad", "#e0a526", "#2e8b57", "#8a5cc2"];
  async function teamPage(main, tm, y) {
    y = +y; const D = await ensure(y), rec = (TEAMS[y] || []).find((r) => r.tm === tm);
    main.textContent = "";
    const F = D.meta.wfields, ix = (k) => F.indexOf(k);
    const backs = D.players.filter((p) => posGroup(p.pos) === "RB" && p.w.some((r) => r[ix("tm")] === tm && (r[ix("car")] || r[ix("tgt")] || r[ix("snp")])));
    const tot = (p) => p.w.filter((r) => r[ix("tm")] === tm).reduce((s, r) => s + r[ix("car")] + r[ix("tgt")], 0);
    backs.sort((a, b) => tot(b) - tot(a)); const top = backs.slice(0, 5);
    main.append(el("h1", "ttl", `${tm} backfield, ${y}`));
    const sub = el("p", "sub"); if (rec) { sub.append("Head coach "); sub.append(link(rec.hc || "–", "#coach/" + encodeURIComponent(rec.hc || ""))); if (rec.oc) { sub.append(" · coordinator "); rec.oc.split(" / ").forEach((n, i) => { if (i) sub.append(" / "); sub.append(link(n, "#coach/" + encodeURIComponent(n))); }); } }
    main.append(sub);
    const tools = el("div", "tools"), ss = el("select", "sel"); for (const s of [...SEASONS].reverse()) if ((TEAMS[s] || []).some((r) => r.tm === tm)) { const o = el("option", null, String(s)); o.value = s; if (s === y) o.selected = true; ss.append(o); }
    ss.addEventListener("change", () => { location.hash = `#team/${tm}/${ss.value}`; }); tools.append(ss); main.append(tools);
    const lg = el("div", "legend"); top.forEach((p, i) => { const s = el("span"), sw = el("i"); sw.style.background = COLORS[i]; s.append(sw, p.n); lg.append(s); }); main.append(lg);
    const weeks = [...new Set(top.flatMap((p) => p.w.filter((r) => r[ix("tm")] === tm).map((r) => r[ix("wk")])))].sort((a, b) => a - b);
    const groups = [{ cols: [{ h: "Wk" }, { h: "Carry split", cls: "l" }], end: 1 }];
    for (const p of top) groups.push({ name: p.n, end: 1, cols: [{ h: "Snap%" }, { h: "Car" }, { h: "Tgt" }, { h: "FP" }] });
    const t = table(groups);
    for (const w of weeks) {
      const rowsW = top.map((p) => p.w.find((r) => r[ix("wk")] === w && r[ix("tm")] === tm)), cars = rowsW.map((r) => (r ? r[ix("car")] : 0)), sumC = cars.reduce((a, b) => a + b, 0);
      const bar = el("div", "wbar"); cars.forEach((c, i) => { if (!c) return; const s = el("span"); s.style.width = (100 * c / sumC) + "%"; s.style.background = COLORS[i]; s.title = `${top[i].n}: ${c} carries`; bar.append(s); });
      const bc = td(null, "l"); bc.append(bar);
      const cells = [td(String(w)), bc];
      rowsW.forEach((r) => { if (!r) { cells.push(td("–", "dim"), td("", "dim"), td("", "dim"), td("", "dim")); return; } cells.push(td(r[ix("snp")] == null ? "–" : r[ix("snp")] + "%"), td(String(r[ix("car")])), td(String(r[ix("tgt")])), td(num(r[ix("fp")]))); });
      t.addRow(cells);
    }
    const cells = [td("Season", "l"), td("")];
    top.forEach((p) => { const rs = p.w.filter((r) => r[ix("tm")] === tm), n = rs.length, s = (k) => rs.reduce((a, r) => a + (r[ix(k)] || 0), 0), sn = rs.filter((r) => r[ix("snp")] != null); cells.push(td(sn.length ? Math.round(sn.reduce((a, r) => a + r[ix("snp")], 0) / sn.length) + "%" : "–"), td(String(s("car"))), td(String(s("tgt"))), td(n ? num(s("fp") / n) + "/G" : "")); });
    t.addRow(cells, "tot first"); main.append(t.box);
    main.append(el("p", "note", "Each week's bar is that game's carry split. The season row averages his snap share over the games he played here and gives his points per game here."));
  }

  // ---------- Teams: expected and actual points by position ----------
  // every team's PPR points a game from its QBs, RBs, WRs and TEs, and what those players' targets and carries were worth (Sean, 13 Oct 2026:
  // "an xfp/g and points/g by team by position"), from the week rows so a traded player counts for the team he played for that week. A QB's
  // xFP is his rushing xFP plus his actual passing points, as on the Leaders page (passing isn't priced): his week's points less his rushing and
  // receiving points, plus his week's rushing xFP. Per game = over the team's games in the window.
  const TPOS = ["QB", "RB", "WR", "TE"];
  async function teamsPage(main) {
    const y = SEASONS.includes(+S.tmSeason) ? +S.tmSeason : CUR, D = await ensure(y), F = D.meta.wfields, ix = (k) => F.indexOf(k);
    const win = [0, 4, 8].includes(+S.tmWin) ? +S.tmWin : 0;
    main.textContent = "";
    main.append(el("h1", "ttl", "Teams"), el("p", "sub", "Each offense's PPR points a game by position, and the expected points (xFP) its targets and carries were worth. xFP says how good the opportunities were; FP − xFP is what the players did with them."));
    const tools = el("div", "tools"), ss = el("select", "sel"); ss.setAttribute("aria-label", "Season");
    for (const s of [...SEASONS].reverse()) { const o = el("option", null, String(s)); o.value = s; if (s === y) o.selected = true; ss.append(o); }
    ss.addEventListener("change", () => { S.tmSeason = +ss.value; save(); route(); });
    const seg = el("div", "seg");
    for (const [v, lab] of [[0, "Season"], [4, "Last 4"], [8, "Last 8"]]) { const b = el("button", null, lab); b.type = "button"; b.setAttribute("aria-pressed", v === win); b.addEventListener("click", () => { S.tmWin = v; save(); route(); }); seg.append(b); }
    tools.append(ss, seg); main.append(tools);
    // team → week → position → [fp, xfp]
    const acc = {};
    for (const p of D.players) {
      const g = posGroup(p.pos); if (!TPOS.includes(g)) continue;
      // a QB's passing points by week: his week's points less his rushing / receiving ones, scaled so the weeks add to his season's
      // passing points (the leftover is fumbles lost and two-point plays, which xFP leaves out)
      const own = (r) => (r[ix("ruyd")] || 0) / 10 + 6 * (r[ix("rutd")] || 0) + (r[ix("rec")] || 0) + (r[ix("ryd")] || 0) / 10 + 6 * (r[ix("rtd")] || 0);
      let k = 0; if (g === "QB") { const raw = p.w.reduce((a, r) => a + Math.max(0, (r[ix("fp")] || 0) - own(r)), 0); k = raw > 0 ? passFP(p) / raw : 0; }
      for (const r of p.w) {
        const tm = r[ix("tm")], wk = r[ix("wk")]; if (!tm) continue;
        const fp = r[ix("fp")] || 0, xr = r[ix("xfp")] || 0;
        const W = ((acc[tm] = acc[tm] || {})[wk] = acc[tm][wk] || {}), c = (W[g] = W[g] || [0, 0]);
        c[0] += fp; c[1] += g === "QB" ? xr + k * Math.max(0, fp - own(r)) : xr;
      }
    }
    const rows = Object.keys(acc).sort().map((tm) => {
      let wks = Object.keys(acc[tm]).map(Number).sort((a, b) => a - b); if (win) wks = wks.slice(-win);
      const n = wks.length, o = { tm, n };
      for (const g of TPOS.concat(["ALL"])) {
        let f = 0, x = 0; for (const w of wks) for (const [pg, c] of Object.entries(acc[tm][w])) if (g === "ALL" || pg === g) { f += c[0]; x += c[1]; }
        o[g] = { fp: n ? f / n : null, xfp: n ? x / n : null };
      }
      return o;
    });
    const sortK = S.tmSort || "ALL:xfp", dir = S.tmDir || -1, [sg, sk] = sortK.split(":"), val = (r) => r[sg] && r[sg][sk];
    const sb = (k) => () => { if (S.tmSort === k) S.tmDir = -(S.tmDir || -1); else { S.tmSort = k; S.tmDir = -1; } save(); route(); };
    const NAME = { QB: "Quarterbacks", RB: "Running backs", WR: "Receivers", TE: "Tight ends", ALL: "All four" };
    const groups = [{ cols: [{ h: "Rk", cls: "fz" }, { h: "Tm", cls: "l fz2" }, { h: "G" }], end: 1 }];
    for (const g of TPOS.concat(["ALL"])) groups.push({ name: NAME[g], end: 1, cols: [
      { h: "xFP/G", t: g === "QB" ? "Rushing xFP plus actual passing points, per team game" : "Expected PPR points per team game from their targets and carries", onSort: sb(g + ":xfp"), lit: sortK === g + ":xfp" },
      { h: "FP/G", t: "PPR points per team game", onSort: sb(g + ":fp"), lit: sortK === g + ":fp" },
      { h: "+/−", t: "FP/G − xFP/G", onSort: sb(g + ":d"), lit: sortK === g + ":d" }] });
    for (const r of rows) for (const g of TPOS.concat(["ALL"])) r[g].d = r[g].fp != null && r[g].xfp != null ? r[g].fp - r[g].xfp : null;
    rows.sort((a, b) => { const va = val(a), vb = val(b); if (va == null) return 1; if (vb == null) return -1; return dir * (va - vb); });
    const pct = (g, k, v) => { const s = rows.map((r) => r[g][k]).filter((x) => x != null).sort((a, b) => a - b); let lo = 0; for (const x of s) if (x < v) lo++; return 100 * lo / Math.max(s.length - 1, 1); };
    const t = table(groups, { tall: true });
    rows.forEach((r, i) => {
      const cells = [td(String(i + 1), "fz"), cellLink(r.tm, `#team/${r.tm}/${y}`, "l fz2"), td(String(r.n))];
      for (const g of TPOS.concat(["ALL"])) for (const k of ["xfp", "fp", "d"]) {
        const v = r[g][k], c = td(k === "d" ? sgn(v) : num(v)); if (v != null) paint(c, pct(g, k, v)); if (sortK === g + ":" + k) c.style.fontWeight = "700"; cells.push(c);
      }
      t.addRow(cells);
    });
    const avg = (g, k) => { const v = rows.map((r) => r[g][k]).filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
    const ac = [td(""), td("League avg", "l fz2"), td("")];
    for (const g of TPOS.concat(["ALL"])) for (const k of ["xfp", "fp", "d"]) ac.push(td(k === "d" ? sgn(avg(g, k)) : num(avg(g, k))));
    t.addRow(ac, "tot first");
    requestAnimationFrame(() => { const first = t.querySelector("tbody td.fz"); if (first) t.style.setProperty("--fzw", first.offsetWidth + "px"); });
    main.append(t.box, el("p", "note", "Every cell is coloured by where that team ranks among the 32 on it (red high). Tap a column name to sort, a team for its backfield week by week. A QB's xFP prices his rushing only and counts his passing points as they were (as on Leaders), so the QB +/− is rushing over expected less fumbles. Fumbles lost and two-point conversions are in FP but not xFP."));
  }

  // ---------- Role Watch ----------
  // who is getting more (or less) of his team's work than the drafts expected (Sean, 13 Oct 2026: "help identify cases like chuba and
  // bucky where ppl going in thought they would be in committees but the reality is they are not"). data/proj-<y>.js from
  // tools/build_proj.py: per player the market's preseason share (a fit on ADP alone), the model's preseason share, and week by week his
  // share to date, last three games, the projected rest-of-season share and points. Past seasons are held out, so a flag is what the
  // board would have said then. A back's share is of his team's RB carries + targets, a receiver's of his team's targets.
  const RW_FLAG = { RB: 10, WR: 4 };
  async function roleWatch(main) {
    const yrs = SEASONS.filter((y) => y >= 2017), y = yrs.includes(+S.rwSeason) ? +S.rwSeason : yrs[yrs.length - 1];
    await loadScript(`data/proj-${y}.js`).catch(() => {});
    const D = (window.FBP || {})[y]; main.textContent = "";
    if (!D) { main.append(el("p", "load", "No Role Watch for that season yet.")); return; }
    const meta = D.meta, last = meta.weeks, K = Math.min(Math.max(1, +S.rwWeek || last), last), pos = ["RB", "WR", "TE"].includes(S.rwPos) ? S.rwPos : "RB";
    const g = pos === "RB" ? "RB" : "WR", mkt = meta.market, past = y < CUR || K < last, thr = RW_FLAG[g];
    main.append(el("h1", "ttl", "Role Watch"), el("p", "sub", pos === "RB"
      ? "Each back's share of his team's running-back carries and targets, in the games he played, against the share the drafts expected. Red: more work than the market priced in."
      : "Each receiver's share of his team's targets, in the games he played, against the share the drafts expected. Red: more work than the market priced in."));
    const tools = el("div", "tools"), seg = el("div", "seg");
    for (const p of ["RB", "WR", "TE"]) { const b = el("button", null, p); b.type = "button"; b.setAttribute("aria-pressed", p === pos); b.addEventListener("click", () => { S.rwPos = p; save(); route(); }); seg.append(b); }
    const ss = el("select", "sel"); ss.setAttribute("aria-label", "Season");
    for (const s of [...yrs].reverse()) { const o = el("option", null, String(s)); o.value = s; if (s === y) o.selected = true; ss.append(o); }
    ss.addEventListener("change", () => { S.rwSeason = +ss.value; S.rwWeek = null; save(); route(); });
    const ws = el("select", "sel"); ws.setAttribute("aria-label", "As of week");
    for (let k = last; k >= 1; k--) { const o = el("option", null, `After week ${k}`); o.value = k; if (k === K) o.selected = true; ws.append(o); }
    ws.addEventListener("change", () => { S.rwWeek = +ws.value; save(); route(); });
    tools.append(seg, ss, ws); main.append(tools);
    // his line as of week K: the latest week he played up to K
    const F = meta.wfields, ix = (k) => F.indexOf(k);
    let rows = D.rows.filter((r) => (pos === "RB" ? r.g === "RB" : r.pos === pos)).map((r) => {
      let w = null; for (const x of r.w) if (x[0] <= K) w = x;
      if (!w) return null;
      const base = mkt ? r.mk : r.pre, d = w[ix("proj")] - base;
      return { r, w, base, d };
    }).filter((x) => x && x.w[ix("g")] >= 2 && (x.w[ix("proj")] >= (g === "RB" ? 12 : 6) || x.r.adp));
    const adpRank = new Map(); D.rows.filter((r) => r.adp && (pos === "RB" ? r.g === "RB" : r.pos === pos)).sort((a, b) => a.adp - b.adp).forEach((r, i) => adpRank.set(r.id, i + 1));
    const sortK = S.rwSort || "d", dir = S.rwDir || -1;
    const val = (x, k) => k === "d" ? x.d : k === "adp" ? (x.r.adp || 999) : k === "mk" ? x.base : k === "td" ? x.w[ix("td")] : k === "l3" ? x.w[ix("l3")] : k === "proj" ? x.w[ix("proj")] : k === "pts" ? x.w[ix("pts")] : k === "rest" ? x.w[ix("rest")] : null;
    rows.sort((a, b) => { const va = val(a, sortK), vb = val(b, sortK); if (va == null) return 1; if (vb == null) return -1; return dir * (va - vb); });
    const sb = (k) => () => { if (S.rwSort === k) S.rwDir = -(S.rwDir || -1); else { S.rwSort = k; S.rwDir = k === "adp" ? 1 : -1; } save(); route(); };
    const col = (h, k, t) => ({ h, t, onSort: sb(k), lit: sortK === k });
    const groups = [{ cols: [{ h: "Rk", cls: "fz" }, { h: "Player", cls: "l fz2" }, { h: "Tm" }, col("ADP", "adp", "Preseason PPR ADP, and his rank at the position")], end: 1 },
      { name: "Preseason", end: 1, cols: [col(mkt ? "Drafts" : "Model", "mk", mkt ? "The share his ADP implied: what the market expected" : "No preseason ADP was saved for this season, so this is the model's preseason share (last season and the draft, without ADP)")].concat(mkt ? [{ h: "Model", t: "The model's preseason share: ADP plus last season and the draft" }] : []) },
      { name: `Through week ${K}`, end: 1, cols: [{ h: "G" }, col("Share", "td", "His share in the games he played"), col("Last 3", "l3", "His share in his last three games")] },
      { name: "Rest of season", end: 1, cols: [col("Proj", "proj", "Projected share for the rest of the season: to date, last three and preseason, weighted by what held up in past seasons"), col(mkt ? "vs drafts" : "vs model", "d", "Projected share minus the preseason expectation"), col("Pts/G", "pts", "Projected PPR points a game for the rest of the season")]
        .concat(past ? [col("Actual", "rest", "His actual share over the rest of the season (3+ games)"), { h: "Act pts", t: "His actual PPR points a game over the rest of the season" }] : []) }];
    const t = table(groups, { tall: true });
    const projs = rows.map((x) => x.w[ix("proj")]).sort((a, b) => a - b), prc = (v) => { let lo = 0; for (const z of projs) if (z < v) lo++; return 100 * lo / Math.max(projs.length - 1, 1); };
    rows.forEach((x, i) => {
      const r = x.r, w = x.w, nm = cellLink(r.n, "#player/" + r.id, "l fz2");
      if (x.d >= thr) { const tg = el("span", "tag rwflag", "More work"); nm.append(" ", tg); }
      const dc = td(sgn(x.d)); paint(dc, 50 + 50 * Math.max(-1, Math.min(1, x.d / (thr * 2)))); dc.style.fontWeight = "700";
      const pj = td(pc(w[ix("proj")])); paint(pj, prc(w[ix("proj")]));
      const cells = [td(String(i + 1), "fz"), nm, td(r.tm), td(r.adp ? `${num(r.adp, 0)} · ${pos}${adpRank.get(r.id)}` : "–"), td(pc(x.base))];
      if (mkt) cells.push(td(pc(r.pre)));
      cells.push(td(String(w[ix("g")])), td(pc(w[ix("td")])), td(w[ix("l3")] == null ? "–" : pc(w[ix("l3")])), pj, dc, td(num(w[ix("pts")])));
      if (past) cells.push(td(w[ix("rest")] == null ? "–" : pc(w[ix("rest")])), td(w[ix("restpts")] == null ? "–" : num(w[ix("restpts")])));
      t.addRow(cells);
    });
    requestAnimationFrame(() => { const first = t.querySelector("tbody td.fz"); if (first) t.style.setProperty("--fzw", first.offsetWidth + "px"); });
    main.append(t.box);
    const bt = g === "RB" ? "Backtest 2017-25, every season held out of its own fit, after week 3: the projection's rest-of-season share r .87 against .79 for the drafts' expectation; backs flagged More work (10+ points over the drafts) turned into 15+ point misses by the market 43% of the time (15% for everyone) and beat it by 15 points of share on average."
      : "Backtest 2017-25, every season held out of its own fit, after week 3: the projection's rest-of-season share r .87 against .76 for the drafts' expectation; receivers flagged More work (4+ points of targets over the drafts) beat the market by 5+ points 57% of the time (20% for everyone), by 6 on average.";
    main.append(el("p", "note", `${rows.length} players with 2+ games. ${bt} Most backfield turns are an injury or a benching ahead of him, so check back each week. ${mkt ? "" : "This season has no saved preseason ADP (the snapshot service only keeps the last week), so the comparison is with the model's own preseason line; from 2027 the August ADP is saved before Week 1."}`));
  }

  // ---------- Dynasty: every season by his year in the league ----------
  // (18 Oct 2026; Sean: "for WRs I want like target share tprr yprr and I also want a dynasty view of that so I can look at rookies
  // across years second year guys across years etc"). A career year is the season less his first NFL season (the draft year, else
  // nflverse's rookie season: index.js rk) plus one. Every season's file loads, the rows are the position's player-seasons in that
  // year at the minimum, and the sorted column is coloured against that same year in every class — the season and draft filters
  // only narrow what's listed, so a 2026 rookie is still placed among every rookie since 2016.
  const DY_YRS = [[1, "Rookies"], [2, "Year 2"], [3, "Year 3"], [4, "Year 4"], [5, "Year 5+"], [0, "All"]];
  const DY_RDS = [["", "All picks"], ["1", "Round 1"], ["2", "Round 2"], ["3", "Round 3"], ["4", "Rounds 4-7"], ["0", "Undrafted"]];
  const DY_MIN = { WR: ["rts", 100, "routes"], TE: ["rts", 100, "routes"], RB: ["opp", 50, "carries + targets"], QB: ["db", 150, "dropbacks"] };
  const DY_COLS = {
    WR: [["Usage", ["g", "rts", "rte", "tgtsh", "tprr", "aysh", "adot", "wopr", "wos"]], ["Efficiency", ["yprr", "syprr", "ypr"]], ["Fantasy", ["xfpg", "fpg"]]],
    RB: [["Usage", ["g", "snp", "carsh", "tgtsh", "oppg", "wog", "wos"]], ["Rushing", ["ypc", "ryoe"]], ["Elusiveness", ["elus", "brka", "yaca", "expl", "bkwy"]], ["Receiving", ["tprr", "yprr", "syprr"]], ["Fantasy", ["xfpg", "fpg"]]],
    QB: [["Passing", ["g", "att", "cmpp", "epadb", "cpoe", "sackp"]], ["Rushing", ["carg", "ruxg"]], ["Fantasy", ["xfpg", "fpg"]]],
  };
  DY_COLS.TE = DY_COLS.WR;
  const DY_NEXT = { WR: ["g", "tprr", "fpg"], TE: ["g", "tprr", "fpg"], RB: ["g", "oppg", "fpg"], QB: ["g", "epadb", "fpg"] };
  const DY_SORT = { WR: "tprr", TE: "tprr", RB: "elus", QB: "epadb" };
  // what a season says about the next one, by career year (scratch study of 18 Oct 2026: every WR / TE season with 100+ routes and RB
  // season with 50+ carries + targets 2016-25 whose next season had 4+ games; partial r = what the stat adds once his own FP / G is known)
  const DY_FIND = {
    WR: [["His own FP / G", "is the best guide to next season at every stage: r .69 from a rookie year to year 2 (179 rookies), .72 from year 2, .75-.76 later. Target share (.62 for rookies), WOPR (.60) and yards per route (.58) come next; TPRR .52."],
         ["On top of his FP / G", "draft capital adds the most for a rookie (partial r −.25: earlier picks beat their rookie line the next year), then youth (−.14) and yards per route (+.12); TPRR (+.05) and target share (+.01) add almost nothing once his points are known."]],
    TE: [["His own FP / G", "r .63 from a rookie year to year 2 (70 rookie tight ends), .75 from year 2. Target share (.59) and WOPR (.59) next; TPRR .47."],
         ["On top of his FP / G", "draft round adds the most for a rookie (partial r −.34); the usage rates add little."]],
    RB: [["His own FP / G", "r .65 from a rookie year to year 2 (112 rookie backs), .75 from year 2. xFP / G (.57), target share (.54) and opportunities a game (.52) next; of the skills RYOE (.34) and breakaway % (.32), then explosive runs (.26), the elusive rating (.21) and broken tackles (.12)."],
         ["On top of his FP / G", "draft round adds the most for a rookie (partial r −.26), then RYOE (+.13); the elusive rating (.00), broken tackles and yards after contact add nothing. In year 2, youth (−.29) and draft round (−.33) still add, RYOE (+.17) and explosive runs (+.15) a little."]],
  };
  const rookieYr = (e) => (e ? e.rk || (e.dr && e.dr[0]) || null : null);
  async function dynasty(main) {
    main.textContent = ""; main.append(el("p", "load", "Loading every season…"));
    await Promise.all(SEASONS.map(ensure));
    const pos = ["WR", "TE", "RB", "QB"].includes(S.dyPos) ? S.dyPos : "WR", cy = DY_YRS.some((x) => x[0] === S.dyYr) ? S.dyYr : 1;
    const rd = DY_RDS.some((x) => x[0] === S.dyRd) ? S.dyRd : "", sy = SEASONS.includes(+S.dySeason) ? +S.dySeason : 0;
    const [mk, mdef, munit] = DY_MIN[pos], mn = S.dyMin && S.dyMin[pos] != null ? S.dyMin[pos] : mdef;
    const keys = DY_COLS[pos].flatMap((g) => g[1]), nk = DY_NEXT[pos];
    const sorts = S.dySort || {}, k = sorts[pos] && (keys.includes(sorts[pos]) || /^(y|age|pick|cy|n:\w+)$/.test(sorts[pos])) ? sorts[pos] : DY_SORT[pos];
    const dir = (S.dyDir || {})[pos] || (METRIC[k] && METRIC[k].hib === 0 ? 1 : -1);
    // every player-season at the position and minimum, with his career year and next season
    const byId = {}; for (const y of SEASONS) byId[y] = new Map(window.FB[y].players.map((p) => [p.id, p]));
    const all = [];
    for (const y of SEASONS) {
      const D = window.FB[y], need = mn * frac(D.meta);
      for (const p of D.players) {
        if (posGroup(p.pos) !== pos) continue;
        const e = IDX[p.id], r0 = rookieYr(e); if (!r0 || r0 > y) continue;
        const v = mk === "opp" ? (p.car || 0) + (p.tgt || 0) : p[mk] || 0; if (v < need) continue;
        const nx = byId[y + 1] ? byId[y + 1].get(p.id) : null;
        all.push({ p, y, e, cy: y - r0 + 1, m: M(p), nx, nm: nx ? M(nx) : null, pick: e.dr ? e.dr[2] : 999, rnd: e.dr ? e.dr[1] : 0 });
      }
    }
    const inYr = (r) => !cy || (cy === 5 ? r.cy >= 5 : r.cy === cy);
    const cohort = all.filter(inYr);
    const rows = cohort.filter((r) => (!sy || r.y === sy) && (rd === "" || (rd === "4" ? r.rnd >= 4 : +rd === r.rnd)));
    const val = (r, kk) => kk === "y" ? r.y : kk === "age" ? r.p.age : kk === "pick" ? r.pick : kk === "cy" ? r.cy : kk.startsWith("n:") ? (r.nm ? r.nm[kk.slice(2)] : null) : r.m[kk];
    rows.sort((a, b) => { const va = val(a, k), vb = val(b, k); if (va == null) return 1; if (vb == null) return -1; return dir * (va - vb) || b.y - a.y; });
    // the sorted column's colour: his place among the same career year in every class
    const mkey = k.startsWith("n:") ? k.slice(2) : k, hib = METRIC[mkey] ? METRIC[mkey].hib !== 0 : null;
    const ref = hib == null ? null : cohort.map((r) => val(r, k)).filter((x) => x != null && isFinite(x)).sort((a, b) => a - b);
    const pctIn = (v) => { if (v == null || !isFinite(v) || !ref || ref.length < 8) return null; let lo = 0, eq = 0; for (const x of ref) { if (x < v) lo++; else if (x === v) eq++; } const q = 100 * (lo + eq / 2) / ref.length; return hib ? q : 100 - q; };
    main.textContent = "";
    const yrLab = (DY_YRS.find((x) => x[0] === cy) || [0, "All"])[1];
    main.append(el("h1", "ttl", "Dynasty"), el("p", "sub", "Every season by the player's year in the league, " + SEASONS[0] + "–" + CUR + ": this year's rookies against every rookie class, second-year players against every second year. The sorted column is coloured against the same year in every class; Next season is what he did the year after."));
    const tools = el("div", "tools"), seg = el("div", "seg");
    for (const x of ["WR", "TE", "RB", "QB"]) { const b = el("button", null, x); b.type = "button"; b.setAttribute("aria-pressed", x === pos); b.addEventListener("click", () => { S.dyPos = x; save(); route(); }); seg.append(b); }
    const ys = el("div", "seg dyseg");
    for (const [v, lab] of DY_YRS) { const b = el("button", null, lab); b.type = "button"; b.setAttribute("aria-pressed", v === cy); b.addEventListener("click", () => { S.dyYr = v; save(); route(); }); ys.append(b); }
    const rs = el("select", "sel"); rs.setAttribute("aria-label", "Draft round");
    for (const [v, lab] of DY_RDS) { const o = el("option", null, lab); o.value = v; if (v === rd) o.selected = true; rs.append(o); }
    rs.addEventListener("change", () => { S.dyRd = rs.value; save(); route(); });
    const ss = el("select", "sel"); ss.setAttribute("aria-label", "Season");
    for (const v of [0, ...[...SEASONS].reverse()]) { const o = el("option", null, v ? String(v) : "All seasons"); o.value = v; if (v === sy) o.selected = true; ss.append(o); }
    ss.addEventListener("change", () => { S.dySeason = +ss.value; save(); route(); });
    const mb = el("label", "minbox"), mi = el("input"); mi.type = "number"; mi.min = 0; mi.step = 10; mi.value = mn; mi.inputMode = "numeric"; mi.setAttribute("aria-label", "Minimum " + munit);
    mi.addEventListener("change", () => { const v = Math.max(0, Math.round(+mi.value || 0)); S.dyMin = Object.assign({}, S.dyMin, { [pos]: v }); save(); route(); });
    mb.append("Min", mi, munit);
    const curM = window.FB[CUR].meta, partial = curM.through < 18;
    tools.append(seg, ys, rs, ss, mb, el("span", "count", `${rows.length} ${pos}s · ${yrLab.toLowerCase()}${sy ? " · " + sy : " · every class"} · ${mn}+ ${munit}${partial ? ` (pro-rated for ${CUR} through week ${curM.through})` : ""}`));
    main.append(tools);
    const sortBy = (kk) => () => { const sd = Object.assign({}, S.dySort), dd = Object.assign({}, S.dyDir); if (k === kk) dd[pos] = -dir; else { sd[pos] = kk; const mm = kk.startsWith("n:") ? kk.slice(2) : kk; dd[pos] = kk === "pick" || kk === "age" ? 1 : kk === "y" || kk === "cy" ? -1 : METRIC[mm] && METRIC[mm].hib === 0 ? 1 : -1; } S.dySort = sd; S.dyDir = dd; save(); route(); };
    const c0 = (h, kk, t, cls) => ({ h, t, cls, onSort: kk ? sortBy(kk) : null, lit: kk === k });
    const groups = [{ cols: [{ h: "Rk", cls: "fz" }, { h: "Player", cls: "l fz2" }, c0("Season", "y")].concat(cy ? [] : [c0("Yr", "cy", "His year in the league that season")]).concat([{ h: "Tm" }, c0("Age", "age", "Age on 1 September of that season"), c0("Draft", "pick", "Round · overall pick; UDFA = undrafted")]), end: 1 }];
    for (const [name, ks] of DY_COLS[pos]) groups.push({ name, end: 1, cols: ks.map((kk) => c0(METRIC[kk].h, kk, METRIC[kk].t)) });
    groups.push({ name: "Next season", end: 1, cls: "nxt", cols: nk.map((kk) => c0(METRIC[kk].h, "n:" + kk, "The season after: " + (METRIC[kk].t || METRIC[kk].h))) });
    const t = table(groups, { tall: true });
    rows.forEach((r, i) => {
      const nm = td(null, "l fz2"), a = link(r.p.n, "#player/" + r.p.id); a.addEventListener("click", () => { S.pseason = Object.assign({}, S.pseason, { [r.p.id]: r.y }); save(); }); nm.append(a);
      const cells = [td(String(i + 1), "fz"), nm, td(String(r.y))]; if (!cy) cells.push(td(String(r.cy)));
      cells.push(td(r.p.tms && r.p.tms.length > 1 ? r.p.tms.join("/") : r.p.tm), td(r.p.age != null ? String(Math.floor(r.p.age)) : "–"), td(r.e.dr ? `R${r.e.dr[1]} · ${r.e.dr[2]}` : "UDFA"));
      for (const kk of keys) { const c = td(fmtM(kk, r.m[kk])); if (kk === k) paint(c, pctIn(r.m[kk])); cells.push(c); }
      for (const kk of nk) { const v = r.nm ? r.nm[kk] : null, c = td(r.nx ? fmtM(kk, v) : r.y === CUR ? "" : "–", "nx"); if ("n:" + kk === k) paint(c, pctIn(v)); cells.push(c); }
      t.addRow(cells);
    });
    if (rows.length) {
      const avg = (f) => { const v = rows.map(f).filter((x) => x != null && isFinite(x)); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
      const ac = [td(""), td(`Average (${rows.length})`, "l fz2"), td("")]; if (!cy) ac.push(td("")); ac.push(td(""), td(num(avg((r) => r.p.age), 1)), td(""));
      for (const kk of keys) ac.push(td(fmtM(kk, avg((r) => r.m[kk]))));
      for (const kk of nk) ac.push(td(fmtM(kk, avg((r) => (r.nm ? r.nm[kk] : null)))));
      t.addRow(ac, "tot first");
    } else t.addRow([td("No players at that minimum.", "l")]);
    requestAnimationFrame(() => { const first = t.querySelector("tbody td.fz"); if (first) t.style.setProperty("--fzw", first.offsetWidth + "px"); });
    main.append(t.box);
    const lastFull = partial ? CUR - 1 : null;
    main.append(el("p", "note", `Tap a column name to sort, a name for his page on that season. Age is on 1 September; Draft is the round and overall pick. ${lastFull ? `Next season for a ${lastFull} row is ${CUR} so far (through week ${curM.through}). ` : ""}${pos === "RB" ? "PFR's charting (the elusive rating, broken tackles, yards after contact) starts in 2018. " : ""}Routes are dropbacks he was on the field for${curM.estRoutes ? `; ${CUR}'s are snap share × team dropbacks until nflverse publishes participation` : ""}.`));
    const F = DY_FIND[pos];
    if (F) { const box = el("div", "findings"); box.append(el("h3", null, "What carries into next season")); const ul = el("ul"); for (const [b, x] of F) { const li = el("li"); li.append(el("b", null, b + ": "), x); ul.append(li); } box.append(ul); main.append(box); }
  }

  // ---------- Coaches ----------
  // a coach's history is every team-season he was on the offensive staff, in any role (Sean, 13 Oct 2026: "do it based on who is on
  // the offense ... include every team he coached on"): teams.js carries each team-season's offensive staff as [role, name] (`st`,
  // Wikipedia's final staff that season), plus the head coach from the games list and the coordinator / play-caller
  const ROLE_CATS = [["HC", /^(interim )?head coach/i], ["OC", /offensive coordinator/i], ["PGC", /pass(ing)? game coordinator/i], ["RGC", /run(ning)? game coordinator/i],
                     ["QB", /quarterback/i], ["RB", /running back/i], ["WR", /wide receiver/i], ["TE", /tight end/i], ["OL", /offensive line/i]];
  const roleCat = (role) => { for (const [c, re] of ROLE_CATS) if (re.test(role)) return c; return "Asst"; };
  const CAT_WORD = { HC: "head coach", OC: "coordinator", PC: "play-caller", PGC: "pass game coord.", RGC: "run game coord.", QB: "QBs", RB: "RBs", WR: "WRs", TE: "TEs", OL: "O-line", Asst: "assistant" };
  let CS_MEMO = null;
  function coachSeasons() {
    if (CS_MEMO) return CS_MEMO;
    const out = new Map();
    for (const y of SEASONS) for (const r of TEAMS[y] || []) {
      const here = new Map();
      const put = (n, role) => { n = String(n || "").trim(); if (!n) return; let e = here.get(n); if (!e) here.set(n, (e = { roles: [], cats: new Set() })); if (!e.roles.includes(role)) e.roles.push(role); e.cats.add(roleCat(role)); };
      for (const [role, n] of r.st || []) put(n, role);
      for (const n of String(r.hc || "").split(" / ")) put(n, "Head coach");
      for (const n of String(r.oc || "").split(" / ")) put(n, "Offensive coordinator");
      if (r.pc) { put(r.pc, "Head coach"); here.get(r.pc).cats.add("PC"); }
      for (const [n, e] of here) {
        if (e.cats.has("OC") && !r.pc) e.cats.add("PC");
        if (!out.has(n)) out.set(n, []);
        out.get(n).push(Object.assign({}, r, { y, roles: e.roles, cats: e.cats }));
      }
    }
    return (CS_MEMO = out);
  }
  const catLine = (rs) => { const c = {}; for (const r of rs) for (const k of r.cats) if (k !== "PC" || !r.cats.has("HC")) c[k] = (c[k] || 0) + 1; return ROLE_CATS.map((x) => x[0]).concat(["PC", "Asst"]).filter((k) => c[k]).map((k) => `${k} ${c[k]}`).join(" · "); };
  // his stints: consecutive seasons with one club, with the jobs he held there
  function stints(rs) {
    const norm = (x) => x.toLowerCase().replace(/passing game/g, "pass game").replace(/running game/g, "run game");   // the pages write a title two ways
    const add = (L, x) => { if (!L.roles.some((z) => norm(z) === norm(x))) L.roles.push(x); };
    const out = []; for (const r of rs) { let L = out[out.length - 1]; if (!(L && L.tm === r.tm && r.y === L.y1 + 1)) out.push((L = { tm: r.tm, y0: r.y, y1: r.y, roles: [] })); L.y1 = r.y; for (const x of r.roles) add(L, x); }
    return out;
  }
  const yrs = (a, b) => (a === b ? String(a) : `${a}–${String(b).slice(2)}`);
  const agg = (rs) => { const n = rs.length, avg = (f) => { const v = rs.map(f).filter((x) => x != null && isFinite(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
    return { n, car: avg((r) => r.rb1car), opp: avg((r) => r.rb1opp), eff: avg((r) => r.eff), tgt: avg((r) => share(r.rbtgt, r.tmtgt)), snp: avg((r) => r.rbs[0].snp), gl: avg((r) => r.rb1gl),
             cow: rs.filter((r) => r.rb1car >= COW_YR).length, com: rs.filter((r) => r.rb1car < COM_YR).length }; };
  // cut at the league's own thirds (2016-25): a coach's average lead-back carry share 68%+ / under 60%, one season 72%+ / under 58%
  const COW = 68, COM = 60, COW_YR = 72, COM_YR = 58;
  function verdict(a) { return a.car == null ? ["–", 50] : a.car >= COW ? ["Bell cow", 85] : a.car >= COM ? ["Lead back + change of pace", 62] : ["Committee", 18]; }
  function leagueAvg() { const all = SEASONS.flatMap((y) => TEAMS[y] || []); return agg(all); }
  const ROLE_PICK = { hc: (r) => r.cats.has("HC"), oc: (r) => r.cats.has("OC") || r.cats.has("PC"), all: () => true };

  function coaches(main) {
    main.textContent = "";
    const pick = ROLE_PICK[S.coachRole] ? S.coachRole : "hc";
    main.append(el("h1", "ttl", "Coaches and their backfields"), el("p", "sub", "Every coach on an offensive staff since 2016, by how his teams split running back work in the seasons he was there. A coach's average counts each of those seasons once."));
    const tools = el("div", "tools"), seg = el("div", "seg");
    for (const [k, lab] of [["hc", "Head coaches"], ["oc", "Coordinators"], ["all", "All staff"]]) { const b = el("button", null, lab); b.type = "button"; b.setAttribute("aria-pressed", pick === k); b.addEventListener("click", () => { S.coachRole = k; save(); route(); }); seg.append(b); }
    const mb = el("label", "minbox"), mi = el("input"); mi.type = "number"; mi.min = 1; mi.max = 11; mi.value = S.coachMin; mi.id = "coachmin"; mb.append("Min seasons", mi);
    mi.addEventListener("change", () => { S.coachMin = Math.max(1, +mi.value || 1); save(); route(); });
    const q = el("input", "csearch"); q.type = "search"; q.placeholder = "Find a coach"; q.setAttribute("aria-label", "Find a coach");
    tools.append(seg, mb, q); main.append(tools);
    const CS = coachSeasons(), L = leagueAvg();
    // the averages are over the seasons in the role picked; Teams / Roles still say where else he's been
    let rows = [...CS.entries()].map(([n, all]) => ({ n, all, rs: all.filter(ROLE_PICK[pick]) })).filter((x) => x.rs.length >= S.coachMin).map((x) => Object.assign(x, { a: agg(x.rs) }));
    const sortK = S.cSort || "car", dir = S.cDir || -1;
    rows.sort((x, z) => { const a = x.a[sortK], b = z.a[sortK]; if (a == null) return 1; if (b == null) return -1; return dir * (a - b); });
    const sb = (k) => () => { if (S.cSort === k) S.cDir = -(S.cDir || -1); else { S.cSort = k; S.cDir = -1; } save(); route(); };
    const t = table([{ cols: [{ h: "Coach", cls: "l fz" }, { h: "Seasons", onSort: sb("n"), lit: sortK === "n" }, { h: "Teams", cls: "l" }, { h: "Every job", cls: "l", t: "Seasons in each job across his whole offensive-staff history: HC head coach, OC coordinator, PC play-caller, PGC / RGC pass / run game coordinator, QB / RB / WR / TE / OL position coach" }, { h: "Style", cls: "l" }], end: 1 },
                     { name: "Lead back (in his games)", end: 1, cols: [{ h: "Car%", onSort: sb("car"), lit: sortK === "car" }, { h: "Opp%", onSort: sb("opp"), lit: sortK === "opp" }, { h: "Snap%", onSort: sb("snp"), lit: sortK === "snp" }, { h: "GL%", onSort: sb("gl"), lit: sortK === "gl" }] },
                     { name: "Backfield", end: 1, cols: [{ h: "Backs used", onSort: sb("eff"), lit: sortK === "eff" }, { h: "Bell-cow yrs", onSort: sb("cow"), lit: sortK === "cow", t: "Seasons his lead back took 72%+ of RB carries in his games (the top third of team-seasons)" }, { h: "Committee yrs", onSort: sb("com"), lit: sortK === "com", t: "Seasons his lead back took under 58% (the bottom third)" }] },
                     { name: "Passing game", end: 1, cols: [{ h: "RB Tgt%", onSort: sb("tgt"), lit: sortK === "tgt" }] }], { tall: true });
    const carAll = rows.map((r) => r.a.car).filter((v) => v != null).sort((a, b) => a - b), pr = (v) => { let lo = 0; for (const x of carAll) if (x < v) lo++; return 100 * lo / Math.max(carAll.length - 1, 1); };
    for (const r of rows) {
      const teams = [...new Set(r.all.map((x) => x.tm))].join(", "), [vd, vp] = verdict(r.a), tag = el("span", "tag", vd), vc = td(null, "l"); paint(tag, vp); tag.classList.remove("heat"); vc.append(tag);
      const car = td(pc(r.a.car)); paint(car, pr(r.a.car));
      const tr = t.addRow([cellLink(r.n, "#coach/" + encodeURIComponent(r.n), "l fz"), td(String(r.a.n)), td(teams, "l"), td(catLine(r.all), "l"), vc, car, td(pc(r.a.opp)), td(pc(r.a.snp, 0)), td(pc(r.a.gl, 0)), td(num(r.a.eff, 2)), td(String(r.a.cow)), td(String(r.a.com)), td(pc(r.a.tgt))]);
      tr.dataset.k = r.n.toLowerCase();
    }
    t.addRow([td("League, 2016–" + String(CUR).slice(2), "l fz"), td(String(L.n)), td(""), td(""), td(""), td(pc(L.car)), td(pc(L.opp)), td(pc(L.snp, 0)), td(pc(L.gl, 0)), td(num(L.eff, 2)), td(String(L.cow)), td(String(L.com)), td(pc(L.tgt))], "tot first");
    q.addEventListener("input", () => { const s = q.value.trim().toLowerCase(); t.querySelectorAll("tbody tr[data-k]").forEach((tr) => { tr.hidden = !!s && !tr.dataset.k.includes(s); }); });
    requestAnimationFrame(() => { const first = t.querySelector("tbody td.fz"); if (first) t.style.setProperty("--fzw", first.offsetWidth + "px"); });
    main.append(findings());
    main.append(t.box, el("p", "note", `${rows.length} coaches. Head coaches and Coordinators average only the seasons in that job; All staff averages every season he was on the staff, position coach included. Style: Bell cow when his lead backs averaged 68%+ of RB carries in their games (the top third of coaches), Committee under 60% (the bottom third), and between them a lead back with a change of pace. A lead back takes 64% of the carries in his games in a typical season. Staffs are each season's final staff on Wikipedia, so a coach let go mid-season isn't listed that year (a head coach always is, from the games).`));
  }

  // what the staff history does and doesn't tell you (every team-season 2016-25, the backs' prior usage and draft capital held equal;
  // the play-callers are data/playcallers.json's head coaches, else the coordinator)
  function findings() {
    const box = el("div", "findings");
    box.append(el("h3", null, "What follows a coach"));
    const ul = el("ul");
    for (const [b, t] of [
      ["RB share of targets", "the one habit that travels: how much a play-caller threw to his backs at his old stops carries to a new team (correlation .2 to .4)."],
      ["Bell cow or committee", "doesn't follow him. Once you know the backs he had, the coach explains about 4% of how the carries were split, no better than chance; a play-caller's lead-back share at his old team says nothing about his next one. The split comes from the room: how far the best back is ahead of the next."],
      ["Position coaches and assistants", "their histories predict nothing, whatever the job."],
    ]) { const li = el("li"); li.append(el("b", null, b + ": "), t); ul.append(li); }
    box.append(ul);
    return box;
  }

  function coachPage(main, name) {
    name = decodeURIComponent(name); const rs = [...(coachSeasons().get(name) || [])].sort((a, b) => a.y - b.y);
    main.textContent = "";
    if (!rs.length) { main.append(el("p", "load", "No seasons for that coach.")); return; }
    const a = agg(rs), L = leagueAvg(), [vd, vp] = verdict(a);
    main.append(el("h1", "ttl", name));
    const v = el("div", "verdict"), tag = el("span", "tag", vd); paint(tag, vp); tag.classList.remove("heat");
    v.append(tag, `${rs.length} season${rs.length > 1 ? "s" : ""} on an offensive staff · ${catLine(rs)}`); main.append(v);
    // where he's been, stint by stint
    const st = el("ul", "stints");
    for (const s of stints(rs)) { const li = el("li"); li.append(link(`${s.tm} ${yrs(s.y0, s.y1)}`, `#team/${s.tm}/${s.y1}`), " — " + s.roles.join(", ")); st.append(li); }
    main.append(st);
    const k = el("div", "kpis"), kp = (lab, val, lg) => { const d = el("div"); d.append(el("b", null, val), el("small", null, `${lab} · league ${lg}`)); k.append(d); };
    kp("Lead back's carry share", pc(a.car), pc(L.car)); kp("Lead back's snap share", pc(a.snp, 0), pc(L.snp, 0)); kp("Backs used", num(a.eff, 2), num(L.eff, 2)); kp("RB share of targets", pc(a.tgt), pc(L.tgt)); kp("Lead back's goal-line share", pc(a.gl, 0), pc(L.gl, 0));
    main.append(k);
    main.append(el("h3", "secttl", "Season by season"));
    const t = table([{ cols: [{ h: "Season", cls: "fz" }, { h: "Tm" }, { h: "His job", cls: "l" }, { h: "Head coach", cls: "l" }], end: 1 }, { name: "Lead back, in his games", end: 1, cols: [{ h: "RB1", cls: "l" }, { h: "G" }, { h: "Car%" }, { h: "Opp%" }, { h: "Snap%" }, { h: "GL%" }, { h: "FP/Opp" }] },
                     { name: "Second back", end: 1, cols: [{ h: "RB2", cls: "l" }, { h: "Car%" }, { h: "FP/Opp" }, { h: "Next yr Car%", t: "The same back's carry share the following season, wherever he played" }] }, { name: "Backfield", end: 1, cols: [{ h: "Backs used" }, { h: "RB Tgt%" }] }]);
    const allCar = SEASONS.flatMap((y) => (TEAMS[y] || []).map((r) => r.rb1car)).sort((x, z) => x - z), pr = (val) => { let lo = 0; for (const x of allCar) if (x < val) lo++; return 100 * lo / Math.max(allCar.length - 1, 1); };
    for (const r of rs) {
      const b1 = r.rbs[0], b2 = r.rbs[1], car = td(pc(r.rb1car)); paint(car, pr(r.rb1car));
      const f1 = fpo(b1), f2 = b2 ? fpo(b2) : null, f2c = td(num(f2, 2)); if (f2 != null && f1 != null && f2 > f1 + 0.1) { f2c.style.color = "var(--stripe)"; f2c.style.fontWeight = "700"; }
      let nxt = "–"; if (b2) { const nx = (TEAMS[r.y + 1] || []).find((x) => x.rbs.some((b) => b.id === b2.id)); if (nx) { const i = nx.rbs.findIndex((b) => b.id === b2.id), all = nx.rbcar || 1; nxt = pc(100 * nx.rbs[i].car / all) + (nx.tm !== r.tm ? ` (${nx.tm})` : ""); } }
      const job = td(r.roles.join(", ") + (r.cats.has("PC") && !r.cats.has("OC") ? " (called plays)" : ""), "l");
      const hcc = td(null, "l"); if (r.hc && r.hc !== name) hcc.append(link(r.hc, "#coach/" + encodeURIComponent(r.hc))); else hcc.textContent = r.hc === name ? "himself" : "–";
      t.addRow([cellLink(String(r.y), `#team/${r.tm}/${r.y}`, "fz"), td(r.tm), job, hcc, cellLink(b1.n, "#player/" + b1.id), td(String(r.rb1g)), car, td(pc(r.rb1opp)), td(b1.snp == null ? "–" : Math.round(b1.snp) + "%"), td(r.rb1gl == null ? "–" : pc(r.rb1gl, 0)), td(num(f1, 2)),
                b2 ? cellLink(b2.n, "#player/" + b2.id) : td("–"), td(pc(r.rb2car)), f2c, td(nxt), td(num(r.eff, 2)), td(pc(share(r.rbtgt, r.tmtgt)))]);
    }
    main.append(t.box, findings(), el("p", "note", "Every season he was on an offensive staff, in whatever job. Car% is coloured against every team-season since 2016. An RB2's FP/Opp in red beat the lead back's; Next yr Car% shows whether he got more of the work the following season (his share of that team's RB carries over the whole season)."));
  }

  // ---------- Settings ----------
  // (23 Oct 2026, the football site in the baseball site's dress): one white card with three tabs across the top in the Filters-button
  // dress — a tab is a link to #settings/<tab>, so Back works — the Appearance rows the baseball page has (colour scheme, light or dark,
  // layout, tables, font, site default; no wOBA scale or sync here, they're baseball's), the stat glossary from METRIC by position, and a
  // paragraph per page under How this page works. themes.js (window.FB_THEMES / FB_TABLES) holds the schemes and the device's picks.
  const SET_TABS = [["glossary", "Stat glossary"], ["appearance", "Appearance"], ["how", "How this page works"]];
  // a line for the counting stats METRIC leaves without a tooltip
  const GLOSS_X = { g: "Games played", tgt: "Targets", rec: "Receptions", ryd: "Receiving yards", rtd: "Receiving touchdowns", car: "Carries", ruyd: "Rushing yards", rutd: "Rushing touchdowns",
    att: "Pass attempts", cmpp: "Completion percentage", pyd: "Passing yards", ptd: "Passing touchdowns", int: "Interceptions thrown", rzc: "Carries inside the 20", ypr: "Yards per reception", ypc: "Yards per carry",
    sackp: "Sacks per dropback", ruxg: "Expected PPR points per game from his carries alone", carg: "Carries per game" };
  function settingsPage(main, tab0) {
    const tab = SET_TABS.some(([k]) => k === tab0) ? tab0 : "glossary";
    main.textContent = "";
    const box = el("section"); box.id = "pboard";
    const head = el("div", "ahd shd"); head.append(el("h2", "ahead", "Settings")); box.append(head);
    const tabs = el("div", "btabs stabs");
    for (const [k, label] of SET_TABS) { const a = el("a", "btab", label); a.href = "#settings/" + k; if (k === tab) { a.classList.add("on"); a.setAttribute("aria-current", "page"); } tabs.append(a); }
    const body = el("div", "sbody"); box.append(tabs, body);
    const lead = (title, note) => { const h = el("div", "ahd"); h.append(el("h2", "ahead", title)); if (note) h.append(el("p", "hublead", note)); body.append(h); };
    if (tab === "appearance") appearance(body);
    else if (tab === "glossary") {
      lead("Stat glossary", "Every stat the lists and the player page carry, in the lists' order — receivers and tight ends first, then backs, then quarterbacks.");
      for (const [pos, word] of [["WR", "Receivers and tight ends"], ["RB", "Running backs"], ["QB", "Quarterbacks"]]) body.append(el("h3", "sgh", word), glossary(pos));
      const f = el("div", "gcredit"); f.append(el("p", "note", `nflverse play-by-play, participation, snap counts and Next Gen Stats ${SEASONS[0]}–${CUR}; PFR's charting; FTN Data's charting via nflverse (CC BY-SA 4.0). PPR scoring throughout; every percentile is against the position's qualifiers that season.`)); body.append(f);
    } else { lead("How this page works", "What each page shows and where the numbers come from."); body.append(howTo()); }
    const stamp = el("p", "sstamp", `${CUR} season`); box.append(stamp);
    ensure(CUR).then((D) => { const w = D.meta && D.meta.through; stamp.textContent = w && w < 18 ? `Through week ${w} · ${CUR}` : `${CUR} season`; }).catch(() => {});
    main.append(box);
  }
  function glossary(pos) {
    const box = el("div", "glossary"), seen = new Set();
    for (const [, keys] of COLS[pos]) for (const k of keys) {
      const m = METRIC[k], txt = m && (m.t || GLOSS_X[k]); if (!m || seen.has(k) || !txt) continue;
      seen.add(k);
      const d = el("div", "gitem"), b = el("b", null, LABEL[k] || m.h);
      if (LABEL[k] && LABEL[k] !== m.h) b.append(el("small", null, " · " + m.h));
      d.append(b, el("p", null, txt)); box.append(d);
    }
    return box;
  }
  function appearance(box) {
    const T = window.FB_THEMES;
    if (!T) { box.append(el("p", "note", "themes.js didn't load, so there is nothing to pick here.")); return; }
    const cur = T.current();
    const head = el("div", "ahd"); head.append(el("h2", "ahead", "Appearance"), el("p", "hublead", "Colours, type and layout. Each device follows the site default until you pick something on it; the phone app and Safari count as separate devices."));
    box.append(head);
    const row = (title, note, ...ctl) => { const r = el("section", "aset"), l = el("div", "alab"), c = el("div", "actl"); l.append(el("h3", null, title)); if (note) l.append(el("p", null, note)); c.append(...ctl); r.append(l, c); box.append(r); return c; };
    const segOf = (label, opts, on, pick) => {
      const seg = el("div", "seg"); seg.setAttribute("role", "group"); seg.setAttribute("aria-label", label);
      for (const [v, l] of opts) { const b = el("button", "segbtn", l); b.type = "button"; b.setAttribute("aria-pressed", String(v === on)); b.addEventListener("click", () => pick(v)); seg.append(b); }
      return seg;
    };
    // colour schemes: a swatch each (the banner with the site's name, then its colours), the blurb on hover; the name in the scheme's ink on
    // its band unless the two are the same colour (Warm's are), then white or near-black, whichever reads
    const lumOf = (hex) => { const m = /^#?([0-9a-f]{6})$/i.exec(hex || ""); if (!m) return null; const v = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4))); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
    const contrastOf = (a, b) => { const x = lumOf(a), y = lumOf(b); return x == null || y == null ? 21 : (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    const inkOn = (bg, ink) => (contrastOf(bg, ink) >= 1.5 ? ink : contrastOf(bg, "#ffffff") >= contrastOf(bg, "#141414") ? "#ffffff" : "#141414");
    const sg = el("div", "schemes");
    for (const [id, sc] of Object.entries(T.schemes)) {
      const L = sc.light, b = el("button", "scheme"); b.type = "button"; b.title = sc.blurb || ""; b.setAttribute("aria-pressed", String(id === cur.scheme));
      const bar = el("div", "spv-bar"); bar.style.background = L["accent-2"]; bar.style.borderBottom = `3px solid ${L.rule}`;
      const word = el("span", "spv-word", "Sean's Football"); word.style.color = inkOn(L["accent-2"], L["accent-2-ink"]); bar.append(word);
      const dots = el("div", "spv-dots");
      for (const c of [L.rule, L["accent-2"], L.btn || L["accent-2"], L.pop || L["accent-2-text"]]) { const i = el("i"); i.style.background = c; dots.append(i); }
      b.append(bar, dots, el("span", "sname", sc.name));
      b.addEventListener("click", () => { T.set({ scheme: id }); route(); });
      sg.append(b);
    }
    row("Colour scheme", "The site's colours. The percentile colours (blue cold, red hot) are the same in every scheme.", sg);
    row("Light or dark", null, segOf("Light or dark", [["system", "Match device"], ["light", "Light"], ["dark", "Dark"]], cur.theme, (v) => { T.set({ theme: v }); route(); }));
    row("Layout", "Auto gives a phone the compact layout; Desktop on a phone shows the full layout zoomed out.",
      segOf("Layout", [["auto", "Auto"], ["mobile", "Mobile"], ["desktop", "Desktop"]], T.viewPref(), (v) => { T.setView(v); route(); }));
    if (window.FB_TABLES) row("Tables", "Baseball-Reference: 12px type, compact 23px rows. Classic: the larger type with column names the size of the numbers, roomier rows.",
      segOf("Tables", [["bref", "Baseball-Reference"], ["classic", "Classic"]], window.FB_TABLES.get(), (v) => { window.FB_TABLES.set(v); route(); }));
    // type: one card per font, set in that font
    T.preloadFonts();
    const fg = el("div", "fonts");
    for (const [id, f] of Object.entries(T.fonts)) {
      const b = el("button", "fontcard"); b.type = "button"; b.title = f.blurb || ""; b.setAttribute("aria-pressed", String(id === cur.font));
      const h = el("span", "ffname", f.name); h.style.fontFamily = f.display;
      const bd = el("span", "fbody", "Ja'Marr Chase · 2.84 YPRR · 22.1 FP/G"); bd.style.fontFamily = f.body;
      b.append(h, bd);
      b.addEventListener("click", () => { T.set({ font: id }); route(); });
      fg.append(b);
    }
    row("Font", null, fg);
    // the site default: what every device shows until it picks its own (inline in themes.js — this site has no defaults.js)
    const d = T.defaults, own = T.hasOwn(), def = el("div", "sitedef");
    def.append(el("span", null, `${T.schemes[d.scheme] ? T.schemes[d.scheme].name : d.scheme} · ${T.fonts[d.font] ? T.fonts[d.font].name : d.font} · ${d.theme === "system" ? "match device" : d.theme} · ${d.view === "auto" ? "auto layout" : d.view}`));
    def.append(el("span", "note", own ? "This device has its own choices." : "This device is following it."));
    if (own) { const b = el("button", "btn btn-quiet", "Follow the site default"); b.type = "button"; b.addEventListener("click", () => { T.useDefaults(); route(); }); def.append(b); }
    row("Site default", "What a device shows before you pick anything on it.", def);
  }
  function howTo() {
    const b = el("div", "prose");
    const key = el("div"), scale = el("span", "scale"); [5, 25, 50, 75, 95].forEach((p) => { const i = el("i"); paint(i, p); scale.append(i); });
    key.append("Percentiles run 0–100 within the position's qualifiers that season", scale, "blue is cold, red is hot. Stats where lower is better (drops, contested targets, stuffed carries, interceptions) are flipped so 100 is always the best. Click a column name to sort by it; click a name for his page.");
    b.append(key);
    for (const html of [
      `<b>Leaders</b> — WR / TE / RB / QB for any season since ${SEASONS[0]}: Basic, Usage, Weighted opportunity, Efficiency, Separation, Skills and Fantasy groups, the sorted column coloured by its percentile among the position's qualifiers (receivers and tight ends with 200 routes or 40 targets, backs with 90 carries + targets, quarterbacks with 200 dropbacks — scaled by weeks played in a season in progress), a Qualified avg row at the foot. Qualified only lists just them.`,
      `<b>A player's page</b> — the band with his bio and FP / G · xFP / G · FPOE / G, percentile bars by section against his position's qualifiers, the <b>xFP build-up</b> (the league's per-game expected points with his routes, targets per route, points per target and rushing swapped in one at a time, then touchdown luck and the rest to his real points), a game log, a Backfield tab for a back, and his season table with each year's head coach and coordinator.`,
      `<b>xFP</b> — expected PPR points: every target priced by its air yards, field position, down and distance, location and formation, every carry by field position, down, distance and gap, by what a play like it scores; fitted on every other season and anchored so each season's xFP sums to its real points. FPOE is points over expected, TDOE touchdowns over expected. Skills like separation, broken tackles and yards after contact are shown with how well they repeat and what they're worth, but stay out of xFP, which prices the opportunity.`,
      `<b>Teams</b> — each offense's xFP / G, FP / G and +/− by position (QB, RB, WR, TE, and all four) for a season or its last 4 or 8 games, each cell coloured by its rank among the 32. A traded player counts for the team he played for that week; a QB's xFP is his rushing xFP plus his actual passing points.`,
      `<b>Role Watch</b> — every back, receiver and tight end's share of his team's work in the games he played (a back's carries + targets, a receiver's targets) against what the drafts expected, after any week since 2017. <b>More work</b> marks a projected rest-of-season share 10+ points over the drafts' for a back, 4+ for a receiver — a weekly read, since most backfield turns are an injury or a benching ahead of him.`,
      `<b>Backfields</b> — every team's lead back's share of the carries, opportunities, snaps and goal-line carries in the games he played (so an injury doesn't read as a committee), the RB2, backs used, the backs' share of targets, and FP per opportunity for both — the RB2 in red when he out-produced the lead back per touch. A team opens its week-by-week split.`,
      `<b>Coaches</b> — every coach on an offensive staff since 2016, by how his teams split running back work in the seasons he was there: <b>Bell cow</b> when his lead backs averaged 68%+ of the RB carries in their games, <b>Committee</b> under 60%. Head coaches, coordinators or the whole staff; a coach's page lists every stint and season. Tested before building on it: what follows a coach to a new team is the RB share of targets — the lead back's share is the room, not the staff.`,
      `<b>Dynasty</b> — every season laid out by the player's year in the league (rookies, year 2 …), by position, draft round and class; the sorted column is coloured against the same career year in every class since ${SEASONS[0]}, with what he did the next season beside it.`,
      `<b>Settings ▸ Appearance</b> — the colour scheme, light or dark, the layout, the tables' dress and the font, each kept on this device until you change it. The baseball site's settings are its own.`,
    ]) b.append(Object.assign(el("div"), { innerHTML: html }));
    return b;
  }

  // ---------- routing ----------
  const PAGE_TITLE = { leaders: "Leaders", teams: "Teams", roles: "Role Watch", backfields: "Backfields", team: "Backfield", coaches: "Coaches", coach: "Coach", dynasty: "Dynasty", player: "Player", settings: "Settings" };
  function route() {
    const h = location.hash.replace(/^#/, "") || "leaders", [page, a, b] = h.split("/");
    document.querySelectorAll(".nav a[data-page]").forEach((x) => { const on = x.dataset.page === page || (page === "team" && x.dataset.page === "backfields") || (page === "coach" && x.dataset.page === "coaches"); x.classList.toggle("on", on); if (on) x.setAttribute("aria-current", "page"); else x.removeAttribute("aria-current"); });
    document.body.dataset.page = page;
    document.title = PAGE_TITLE[page] ? "Sean's Football · " + PAGE_TITLE[page] : "Sean's Football Site";
    const main = $("main"); main.innerHTML = '<p class="load">Loading…</p>';
    const go = page === "player" ? player(main, a) : page === "settings" ? settingsPage(main, a) : page === "backfields" ? backfields(main) : page === "team" ? teamPage(main, a, b) : page === "coaches" ? coaches(main) : page === "coach" ? coachPage(main, a) : page === "roles" ? roleWatch(main) : page === "teams" ? teamsPage(main) : page === "dynasty" ? dynasty(main) : leaders(main);
    Promise.resolve(go).catch((err) => { main.textContent = ""; main.append(el("p", "load", "Couldn't load that season's data. Check the connection and reload.")); console.error(err); });
    if (S.lastPage !== h) { window.scrollTo(0, 0); S.lastPage = h; save(); }
  }
  document.body.prepend(header());
  { const top = $(".top"), set = () => { for (const k of ["--toph", "--header-h"]) document.documentElement.style.setProperty(k, top.offsetHeight + "px"); }; new ResizeObserver(set).observe(top); set(); }   // where a table's pinned column names sit (--header-h is the baseball stylesheet's name for it)
  window.addEventListener("hashchange", route);
  route();
})();

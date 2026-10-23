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
  // the colour scale is the baseball site's, verbatim (23 Oct 2026): Savant's blue → pale teal → red blended in CIE Lab (d3's interpolateLab,
  // D50 white), clamped at the 5th / 95th and held flat from the 45th to the 55th; white digits on any fill darker than a mid tone (the reds
  // from about the 74th percentile, the blues from about the 29th), near-black on the pale ends and the teal. A straight sRGB blend of the
  // same stops had sat off it at every percentile but 0 / 50 / 100 and flipped its ink in a different place, so the two sites' cells now
  // read the same (tables.md §3)
  const LAB = (() => {
    const Xn = 0.96422, Zn = 0.82521, t0 = 4 / 29, t1 = 6 / 29, t2 = 3 * t1 * t1, t3 = t1 * t1 * t1;
    const to = (hex) => {
      const [r, g, b] = [1, 3, 5].map((i) => { const x = parseInt(hex.slice(i, i + 2), 16) / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; });
      const f = (t) => (t > t3 ? Math.cbrt(t) : t / t2 + t0), grey = r === g && g === b;
      const y = f(0.2225045 * r + 0.7168786 * g + 0.0606169 * b);
      const x = grey ? y : f((0.4360747 * r + 0.3850649 * g + 0.1430804 * b) / Xn), z = grey ? y : f((0.0139322 * r + 0.0971045 * g + 0.7141733 * b) / Zn);
      return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
    };
    const from = ([l, a, bb]) => {
      const g = (t) => (t > t1 ? t * t * t : t2 * (t - t0)), o = (x) => Math.max(0, Math.min(255, Math.round(255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055))));
      let y = (l + 16) / 116, x = y + a / 500, z = y - bb / 200; x = Xn * g(x); y = g(y); z = Zn * g(z);
      return [o(3.1338561 * x - 1.6168667 * y - 0.4906146 * z), o(-0.9787684 * x + 1.9161415 * y + 0.0334540 * z), o(0.0719453 * x - 0.2289914 * y + 1.4052427 * z)];
    };
    return { to, from };
  })();
  const SAVANT = [[5, LAB.to("#3661ad")], [45, LAB.to("#b4cfd1")], [55, LAB.to("#b4cfd1")], [95, LAB.to("#d82129")]];
  const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  const heatCache = new Map();
  function heat(p) {
    if (p == null || !isFinite(p)) return null;
    if (heatCache.has(p)) return heatCache.get(p);
    const q = Math.max(5, Math.min(95, p)); let i = 1; while (i < SAVANT.length - 1 && SAVANT[i][0] < q) i++;
    const [p0, c0] = SAVANT[i - 1], [p1, c1] = SAVANT[i], u = (q - p0) / (p1 - p0), c = LAB.from(c0.map((v, j) => v + (c1[j] - v) * u));
    const s = { bg: `rgb(${c.join(",")})`, fg: lum(c) < 0.35 ? "rgb(255,255,255)" : "rgb(21,24,26)" };
    heatCache.set(p, s); return s;
  }
  // a heat-mapped cell: the fill and its ink inline, --heat / --heatfg for a rule that wants them, class heat (bold in the stylesheet)
  const paint = (node, p) => { const h = heat(p); if (!h) return node; node.style.background = h.bg; node.style.color = h.fg; node.style.setProperty("--heat", h.bg); node.style.setProperty("--heatfg", h.fg); node.classList.add("heat"); return node; };
  const num = (v, d = 1) => v == null || !isFinite(v) ? "–" : v.toFixed(d);
  const sgn = (v, d = 1) => v == null || !isFinite(v) ? "–" : (Math.abs(v) < Math.pow(10, -d) / 2 ? (0).toFixed(d) : (v > 0 ? "+" : "−") + Math.abs(v).toFixed(d));
  const pc = (v, d = 1) => v == null || !isFinite(v) ? "–" : v.toFixed(d) + "%";
  const ord = (n) => { const s = ["th", "st", "nd", "rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
  const posGroup = (p) => (p === "FB" ? "RB" : p);
  const htFmt = (h) => (h ? `${Math.floor(h / 12)}-${h % 12}` : null);
  const norm = (t) => String(t).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();   // accents folded for a name search

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
  // adjusted WOPR (Sean, 23 Oct 2026: "are you able to come up with an improved version of wopr and include it?"). WOPR is 1.5 × target share +
  // 0.7 × air-yard share for everyone; fitted on every 40+ target season 2016-25 against next season's FP / G (held out by season), a receiver's
  // air-yard share adds almost nothing once his target share is known (weight 0.04 of target share's) and a tight end's about 0.4, and how
  // much his team throws matters at its square root. So aWOPR = (a × target share + b × air-yard share) × √(his team's targets per game in his
  // games / the league's), a + b = 2.2 as WOPR's: WR 2.11 / 0.09, TE 1.58 / 0.62. WR: this season's FP / G r .90 (WOPR .84), next season's .66
  // (.64; xFP/G .66), year to year .73 (.72); TE .89 / .64 / .71 against .86 / .63 / .71. The league's targets per game is the season's
  // position players' with 40+ targets (pro-rated, as lgYpt) — 31-36 a game across seasons.
  const AW = { WR: [2.11, 0.09], TE: [1.58, 0.62] }, lgTvMemo = {};
  function lgTv(y, pos) {
    const key = y + ":" + pos; if (key in lgTvMemo) return lgTvMemo[key];
    const D = window.FB[y]; let s = 0, n = 0;
    if (D) for (const q of D.players) if (posGroup(q.pos) === pos && (q.tgt || 0) >= 40 * frac(D.meta) && q.g > 0 && q.tmt) { s += q.tmt / q.g; n++; }
    return (lgTvMemo[key] = n ? s / n : null);
  }
  function adjWopr(p) {
    const y = SEASON_OF.get(p), w = AW[posGroup(p.pos)]; if (!y || !w || !p.tmt || !(p.tmay > 0) || !(p.g > 0)) return null;
    const lg = lgTv(y, posGroup(p.pos)); if (!lg) return null;
    return (w[0] * p.tgt / p.tmt + w[1] * p.ay / p.tmay) * Math.sqrt((p.tmt / p.g) / lg);
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
      awopr: adjWopr(p),
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
    awopr: { h: "aWOPR", d: 2, hib: 1, t: "Adjusted WOPR: target share and air-yard share weighted for his position (WR 2.11 / 0.09, TE 1.58 / 0.62 — a receiver's air yards add almost nothing once his targets are known), times the square root of his team's targets per game against the league's. Tracks this season's FP / G at r .90 for WRs (WOPR .84) and next season's at .66 (WOPR .64, the same as xFP/G); repeats year to year at .73" },
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
    WR: [["Basic", ["g", "tgt", "rec", "ryd", "rtd"]], ["Usage", ["rte", "tprr", "tgtsh", "aysh", "adot", "wopr", "awopr", "rzt"]], ["Weighted opportunity", ["wos", "rzs", "ezs"]], ["Efficiency", ["yprr", "syprr", "ypr", "croe", "yacoe", "nyoe"]], ["Fantasy", ["xfpg", "fpg", "fpoeg", "tdoe"]]],
    RB: [["Basic", ["g", "car", "ruyd", "rutd", "tgt", "rec", "ryd"]], ["Usage", ["snp", "carsh", "tgtsh", "oppg", "glc", "rzc"]], ["Weighted opportunity", ["wog", "wos", "hvtg", "hvtp", "rzs", "gls"]], ["Efficiency", ["ypc", "ryoe", "yprr", "syprr", "fppo", "expl", "ybca"]], ["Fantasy", ["xfpg", "fpg", "fpoeg", "tdoe"]]],
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
    const p = Math.round(100 * (lo + 1 + eq / 2) / (s.length + 1));   // the baseball's insertPct: ties at half, 1-based over n + 1, so a cell reads the same on both sites
    return (METRIC[k] && METRIC[k].hib === 0) ? 100 - p : p;
  }

  // ---------- B-Ref table helper ----------
  // groups: [{ name, end, cls, cols: [{ h, cls, t, onSort, lit }] }]; end draws the 2px red rule after the group's last column. On a phone the
  // sorted column (lit) moves to sit right after the frozen columns, so the coloured column is on screen beside the name — the baseball's
  // Leaderboard orders a phone's columns that way (Rk · Player · headline · the rest); the over-header's spans, the rules and every row follow
  // the new order (addRow takes the cells in the groups' own order and re-sorts them). opts.front = false leaves the order alone.
  function table(groups, opts = {}) {
    let order = null;
    if (isMobile() && opts.front !== false && groups.length) {
      const flat = groups.flatMap((g) => g.cols.map((c) => ({ g, c }))), li = flat.findIndex((x) => x.c.lit);
      let nf = 0; while (nf < groups[0].cols.length && /(^|\s)fz2?(\s|$)/.test(groups[0].cols[nf].cls || "")) nf++;   // the frozen columns lead the first group
      if (li > nf) {
        const x = flat[li], g0 = groups[0], out = [{ cols: g0.cols.slice(0, nf), name: g0.name }, { cols: [x.c], end: 1, name: x.g === g0 ? "" : x.g.name }];
        const rest = g0.cols.slice(nf).filter((c) => c !== x.c); if (rest.length) out.push({ cols: rest, end: g0.end, name: "" });
        for (const g of groups.slice(1)) { const cols = g.cols.filter((c) => c !== x.c); if (cols.length) out.push({ cols, end: g.end, name: g.name, cls: g.cls }); }
        order = out.flatMap((g) => g.cols).map((c) => flat.findIndex((f) => f.c === c)); groups = out;
      }
    }
    const t = el("table", "br"), th = el("thead"), tb = el("tbody");
    if (groups.some((g) => g.name)) { const o = el("tr", "over"); for (const g of groups) { const c = el("th", g.end ? "ge" : "", g.name || ""); c.colSpan = g.cols.length; if (g.cls) c.className += " " + g.cls; o.append(c); } th.append(o); }
    const h = el("tr");
    for (const g of groups) g.cols.forEach((c, i) => { const cell = el("th", [c.cls || "", i === g.cols.length - 1 && g.end ? "ge" : ""].join(" ").trim(), c.h); if (c.t) cell.title = c.t; if (c.onSort) { cell.classList.add("sort"); cell.addEventListener("click", c.onSort); } if (c.lit) cell.classList.add("lit"); h.append(cell); });
    th.append(h); t.append(th, tb);
    const ends = []; let i = 0; for (const g of groups) { i += g.cols.length; if (g.end) ends.push(i - 1); }
    t.addRow = (cells, cls) => { if (order && cells.length === order.length) cells = order.map((j) => cells[j]); const tr = el("tr", cls || ""); cells.forEach((c, j) => { const td = c instanceof Node ? c : el("td", null, c == null ? "" : String(c)); if (ends.includes(j)) td.classList.add("ge"); tr.append(td); }); tb.append(tr); return tr; };
    const box = el("div", "tbox"); box.append(t); t.box = box;   // the framed box; a list page's is the one scroller on the page, a detail page's slides sideways
    return t;
  }
  const td = (txt, cls) => el("td", cls || null, txt);
  const link = (txt, href) => { const a = el("a", "lnk", txt); a.href = href; return a; };
  const cellLink = (txt, href, cls) => { const c = td(null, cls || "l"); c.append(link(txt, href)); return c; };
  // a player's name on a list: a link to his page that opens it as a popup over a list page (openPlayer); a whole row can open it too
  const playerLink = (name, id) => { const a = link(name, "#player/" + id); a.addEventListener("click", (ev) => openPlayer(id, ev)); return a; };
  const playerCell = (name, id, cls) => { const c = td(null, cls || "l"); c.append(playerLink(name, id)); return c; };
  const rowPop = (tr, id) => { tr.classList.add("clk"); tr.addEventListener("click", (ev) => { if (ev.target.closest("a, button, input, select, label")) return; openPlayer(id, ev); }); return tr; };

  // ---------- header and search ----------
  // the baseball site's header (23 Oct 2026): the band with the red rule, every page a white boxy button in the condensed face — the
  // current one filled navy — and the search at the right; on a phone the search and a "☰ Menu" button share the one line and the
  // pages open under it as a grid of the same buttons (body.navopen), closing on a pick, a page change or a tap elsewhere
  const PAGES = [["#leaders", "Leaders"], ["#teams", "Teams"], ["#roles", "Role Watch"], ["#backfields", "Backfields"], ["#coaches", "Coaches"], ["#dynasty", "Dynasty"], ["#settings", "Settings"]];
  const PO = { QB: 0, RB: 1, FB: 1, WR: 2, TE: 3 };
  function header() {
    const top = el("header", "top"), inn = el("div", "in"), nav = el("nav", "nav");
    nav.setAttribute("aria-label", "Pages");
    for (const [h, lab] of PAGES) { const a = el("a", null, lab); a.href = h; a.dataset.page = h.slice(1); if (h === "#settings") a.title = "Stat glossary, appearance and how the pages work"; nav.append(a); }
    const sr = el("div", "srch"), inp = el("input"); inp.type = "search"; inp.placeholder = "Find a player…"; inp.setAttribute("aria-label", "Find a player");
    const hits = el("div", "hits"); hits.hidden = true; sr.append(inp, hits);
    const ALL = Object.entries(IDX).map(([id, e]) => ({ id, e, k: norm(e.n), last: Math.max(...e.s) }));
    let cur = -1;
    // the box tapped empty lists the last five players opened (the baseball's Recent); a team code or name ("KC", "Chiefs") lists this season's
    // roster first, quarterbacks then backs, receivers and tight ends; then the names that match
    const recentHits = () => store.get("recent", []).map((id) => ALL.find((x) => x.id === id)).filter(Boolean);
    const teamOf = (q) => { const Q = q.toUpperCase(), nq = norm(q); return Object.keys(TEAM_FULL).find((t) => t === Q || (nq.length >= 4 && norm(TEAM_FULL[t]).includes(nq))) || null; };
    const draw = () => {
      const q = inp.value.trim(); hits.textContent = ""; cur = -1;
      let r = [], hd = null;
      if (q.length < 2) { if (document.activeElement === inp && !q) { r = recentHits(); hd = r.length ? "Recent" : null; } }
      else {
        const nq = norm(q), tm = teamOf(q);
        const roster = tm ? ALL.filter((x) => x.e.tm === tm && x.last === CUR).sort((a, b) => ((PO[a.e.pos] ?? 9) - (PO[b.e.pos] ?? 9)) || a.k.localeCompare(b.k)) : [];
        const named = ALL.filter((x) => x.k.includes(nq) && !roster.includes(x)).sort((a, b) => (b.k.startsWith(nq) - a.k.startsWith(nq)) || (b.last - a.last)).slice(0, 12);
        r = roster.length ? [...roster, ...named].slice(0, 60) : named; if (roster.length) hd = TEAM_FULL[tm];
      }
      if (hd) hits.append(el("div", "recenthd", hd));
      for (const x of r) { const b = el("button"); b.type = "button"; b.append(el("span", null, x.e.n), el("small", null, `${x.e.pos} · ${x.e.tm || ""} · ${Math.min(...x.e.s)}–${String(x.last).slice(2)}`)); b.addEventListener("click", () => { inp.value = ""; hits.hidden = true; inp.blur(); location.hash = "#player/" + x.id; }); hits.append(b); }
      hits.hidden = !r.length;
    };
    inp.addEventListener("input", draw); inp.addEventListener("focus", draw);
    inp.addEventListener("keydown", (e) => { if (e.key === "Escape") { inp.value = ""; hits.hidden = true; return; }
      const bs = [...hits.querySelectorAll("button")]; if (!bs.length) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); cur = (cur + (e.key === "ArrowDown" ? 1 : -1) + bs.length) % bs.length; bs.forEach((b, i) => b.classList.toggle("cur", i === cur)); }
      if (e.key === "Enter") (bs[cur] || bs[0]).click(); });
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
  // the last five players opened, newest first (the header search lists them when tapped empty); per device
  const noteRecent = (id) => { const a = store.get("recent", []).filter((x) => x !== id); a.unshift(id); store.set("recent", a.slice(0, 5)); };

  // ---------- pills and the list that opens under one (the baseball's pillSelect / ddOpenOn) ----------
  // a pill is a white boxy button with a chevron; its list is appended to body (fixed, so no box clips it), left-aligned 1px under the
  // pill, above it when there's no room below; any click elsewhere or Escape closes it, a scroll or resize re-places it
  let DD = null;
  const svgEl = (tag, attrs) => { const s = document.createElementNS("http://www.w3.org/2000/svg", tag); for (const k in attrs) s.setAttribute(k, attrs[k]); return s; };
  const chev = () => { const s = svgEl("svg", { class: "chev", viewBox: "0 0 10 6", width: "10", height: "6", "aria-hidden": "true" }); s.append(svgEl("path", { d: "M1 1l4 4 4-4", fill: "none", stroke: "currentColor", "stroke-width": "1.6", "stroke-linecap": "round", "stroke-linejoin": "round" })); return s; };
  function pillSelect(text, opts, cur, onPick, aria) {
    const b = el("button", "pill"); b.type = "button"; b.setAttribute("aria-haspopup", "listbox"); b.setAttribute("aria-expanded", "false"); if (aria) b.setAttribute("aria-label", aria);
    b.append(el("span", "pill-text", text), chev());
    if (opts.length < 2) { b.classList.add("solo"); return b; }   // one choice: no list
    b.addEventListener("click", (e) => { e.stopPropagation(); ddOpenOn(b, opts, cur, onPick); });
    return b;
  }
  function ddOpenOn(trig, opts, cur, onPick) {
    const was = DD && DD.trig === trig; ddClose(); if (was) return;   // a second click on the same pill just closes
    const menu = el("div", "ddmenu"); menu.setAttribute("role", "listbox");
    for (const [v, lab] of opts) {
      if (v == null) { menu.append(el("div", "ddh", lab)); continue; }
      const b = el("button", "ddi" + (v === cur ? " on" : ""), lab); b.type = "button"; b.setAttribute("role", "option"); b.setAttribute("aria-selected", String(v === cur));
      b.addEventListener("click", () => { ddClose(); if (v !== cur) onPick(v); }); menu.append(b);
    }
    menu.addEventListener("click", (e) => e.stopPropagation());
    document.body.append(menu); DD = { trig, menu }; trig.classList.add("ddon"); trig.setAttribute("aria-expanded", "true"); ddPlace();
    const on = menu.querySelector(".ddi.on"); if (on) on.scrollIntoView({ block: "nearest" });
  }
  function ddPlace() {
    if (!DD) return; const { trig, menu } = DD, r = trig.getBoundingClientRect();
    if (!trig.isConnected || (!r.width && !r.height)) { ddClose(); return; }   // the opener was redrawn away
    menu.style.minWidth = Math.round(r.width) + "px";
    const w = menu.offsetWidth, h = menu.offsetHeight;
    const left = Math.max(6, Math.min(r.left, innerWidth - w - 6)), top = r.bottom + h + 6 > innerHeight && r.top - h - 1 > 6 ? r.top - h - 1 : r.bottom + 1;
    menu.style.left = Math.round(left) + "px"; menu.style.top = Math.round(top) + "px";
  }
  function ddClose() { if (!DD) return; DD.menu.remove(); DD.trig.classList.remove("ddon"); DD.trig.setAttribute("aria-expanded", "false"); DD = null; }
  document.addEventListener("click", ddClose);
  window.addEventListener("scroll", (e) => { if (DD && !DD.menu.contains(e.target)) ddPlace(); }, { passive: true, capture: true });
  window.addEventListener("resize", ddPlace);

  // ---------- the Filters dropdown (the baseball's #pop) ----------
  // Sean, 23 Oct 2026 ("make the site look and function exactly like the baseball one"): a list page's filters live in one dropdown hung 6px
  // under its Filters button — the tabs across its top, the Clear foot pinned, only the middle scrolling, one size whatever tab is open.
  // Changes apply as they're made (every control redraws the list and the dropdown stays up); ×, a tap outside or a page change close it,
  // Escape puts back what was there when it opened. POP.open is the tab showing, S.popTab[page] the last one used on that page, so its button reopens there.
  // Every list page hands the dropdown its own spec before it draws its Filters button — { page, tabs: [[key, label]], keys: the S keys
  // Escape puts back, draw(tab, h) } — so one dropdown serves Leaders, Teams, Role Watch, Coaches and Dynasty; the Table format tab is
  // the same on every page (tableTab). S.popTab remembers the tab last used on each page.
  const POP = { open: null, snap: null, el: null, spec: null };
  function popEl() {
    if (POP.el) return POP.el;
    const p = el("div", "pop grppop"); p.id = "pop"; p.hidden = true;
    const x = el("button", "pop-close", "×"); x.type = "button"; x.setAttribute("aria-label", "Close"); x.addEventListener("click", () => closePanel(false));
    const b = el("div", "pop-body"); b.id = "pop-body"; p.append(x, b); document.body.append(p);
    return (POP.el = p);
  }
  // what Escape puts back: the page's own filter keys (a missing one is kept as null so the snapshot round-trips through JSON) and the tables' dress
  const filterSnap = () => ({ s: Object.fromEntries((POP.spec ? POP.spec.keys : []).map((k) => [k, S[k] === undefined ? null : S[k]])), tables: window.FB_TABLES ? window.FB_TABLES.get() : null });
  const popTab = (spec) => { const t = (S.popTab || {})[spec.page]; return spec.tabs.some(([k]) => k === t) ? t : spec.tabs[0][0]; };
  function openPanel(tab) { POP.snap = JSON.stringify(filterSnap()); POP.open = tab; S.popTab = Object.assign({}, S.popTab, { [POP.spec.page]: tab }); save(); route(); }
  function closePanel(cancel) {
    popEl().hidden = true; ddClose();
    if (cancel && POP.snap) { const s = JSON.parse(POP.snap); for (const k in s.s) { if (s.s[k] == null) delete S[k]; else S[k] = s.s[k]; } if (window.FB_TABLES && s.tables !== window.FB_TABLES.get()) window.FB_TABLES.set(s.tables); }
    POP.open = null; POP.snap = null; save(); route();
  }
  // a tap outside applies and closes (one inside the dropdown or on the button row doesn't count, nor one whose target a redraw just removed)
  document.addEventListener("click", (e) => { if (!POP.open) return; if (e.composedPath().some((n) => n.id === "pop" || (n.classList && n.classList.contains("tbtns"))) || !e.target.isConnected) return; closePanel(false); });
  document.addEventListener("keydown", (e) => { if (e.key !== "Escape") return; if (DD) { ddClose(); return; } if (XP) { closeXPop(); return; } if (POP.open) closePanel(true); });
  window.addEventListener("hashchange", () => { if (POP.open) { POP.open = null; POP.snap = null; popEl().hidden = true; } });
  window.addEventListener("resize", placePop); window.addEventListener("scroll", placePop, true);   // capture: any scroller moving re-places the dropdown under its button
  function placePop() {
    const pop = POP.el; if (!pop || pop.hidden) return;
    const btn = $(".tbtns [data-panel]"); if (!btn) return;
    const r = btn.getBoundingClientRect(), mob = isMobile();
    pop.style.maxHeight = Math.max(220, innerHeight - r.bottom - 16) + "px";   // never taller than the room under the button
    pop.style.top = Math.round(r.bottom + 6) + "px"; pop.style.setProperty("--pop-top", Math.round(r.bottom + 6) + "px");
    if (mob) { pop.style.left = "8px"; pop.style.right = "8px"; pop.style.width = "auto"; return; }   // a phone: spans the screen 8px in
    pop.style.right = "auto"; pop.style.width = ""; pop.style.left = "0px";
    const w = pop.offsetWidth; pop.style.left = Math.round(Math.max(8, Math.min(r.left, innerWidth - w - 8))) + "px";   // left-aligned with the button, clamped 8px inside the window
  }
  const isMobile = () => document.documentElement.dataset.view === "mobile";

  // the page bar's numbers: ‹, five fixed slots, › — the arrows never move (Sean, 18 Oct 2026, on the baseball site). ‹ 1 2 3 … N › near the
  // start, ‹ 1 … c … N › in the middle, ‹ 1 … N−2 N−1 N › at the end; five pages or fewer all shown, centred in the slots
  function pageNav(page, n, go) {
    const nav = el("div", "pnav pslots"), btn = (lab, p, cur) => { const b = el("button", "pbtn", lab); b.type = "button"; if (cur) b.setAttribute("aria-current", "page"); if (p == null) b.disabled = true; else b.addEventListener("click", () => go(p)); return b; };
    let slots;
    if (n <= 5) { slots = Array(Math.floor((5 - n) / 2)).fill(null); for (let p = 1; p <= n; p++) slots.push(p); while (slots.length < 5) slots.push(null); }
    else if (page <= 2) slots = [1, 2, 3, "…", n]; else if (page >= n - 1) slots = [1, "…", n - 2, n - 1, n]; else slots = [1, "…", page, "…", n];
    nav.append(btn("‹", page > 1 ? page - 1 : null));
    for (const s of slots) nav.append(s == null ? el("span", "pslot") : s === "…" ? el("span", "pgap", "…") : btn(String(s), s, s === page));
    nav.append(btn("›", page < n ? page + 1 : null));
    return nav;
  }

  // ---------- a standing list page (the baseball Leaderboard's shape, shared by every list page) ----------
  // Sean, 23 Oct 2026: "make the site look and function exactly like the baseball one ... formatting and table formatting". Each list page is
  // section#board — fit-content and centred on a desktop, so the control row, the title and the box share a left edge — holding the control
  // row (a Filters button labelled by who's listed, with " (n)" for the filters set beyond the defaults, or a pill where there is one choice;
  // the count beside it), the title over the red rule with the sort beside it and a "More about these numbers" link that folds the page's
  // notes under the title (the baseball Movers' pattern; the table keeps the room), and the framed box, the one thing on the page that
  // scrolls (body.lst sizes main to the screen). Nothing sits under the table.
  const LIST_PAGES = new Set(["leaders", "teams", "roles", "backfields", "coaches", "dynasty"]);
  const ABOUT = {};   // the pages whose folded note is open this visit
  function filtersBtn(label, extra) {
    const tb = el("div", "tbtns");
    const fb = el("button", "btn btn-quiet tbtn" + (POP.open ? " open" : "") + (extra ? " on" : ""), `${label}${extra ? ` (${extra})` : ""}`);
    fb.type = "button"; fb.dataset.panel = "grp"; fb.setAttribute("aria-haspopup", "true"); fb.setAttribute("aria-expanded", String(!!POP.open));
    fb.addEventListener("click", (e) => { e.stopPropagation(); if (POP.open) closePanel(false); else openPanel(popTab(POP.spec)); });
    tb.append(fb); return tb;
  }
  const count = (long, short) => el("span", "count pcount", isMobile() ? short : long);
  // the frame: the control row (ctl: nodes), the title row and, when there is one, the folded note (a string, or nodes — a note and a findings box)
  function listFrame(main, { page, ctl, title, sub, about }) {
    const board = el("section"); board.id = "board";
    const row = el("div", "ctlrow"); row.id = "pagertop"; row.append(...ctl);
    const tt = el("div", "lbtitle"); tt.id = "lbtitle"; tt.append(el("h2", null, title), el("span", null, sub));
    board.append(row, tt);
    if (about) {
      const more = el("button", "linkbtn fxmore", isMobile() ? "About" : "More about these numbers"), note = el("div", "fxnote");
      note.append(...(Array.isArray(about) ? about : [el("p", "note", about)])); note.hidden = !ABOUT[page];
      more.type = "button"; more.setAttribute("aria-expanded", String(!!ABOUT[page]));
      more.addEventListener("click", () => { ABOUT[page] = note.hidden; note.hidden = !note.hidden; more.setAttribute("aria-expanded", String(!note.hidden)); });
      tt.append(more); board.append(note);
    }
    main.append(board); return board;
  }
  // the box: id bscroll (route() notes its scroll under its key, so a redraw of the same page — a tick in the dropdown — keeps the place)
  const boxOf = (t, key) => { const box = t.box; box.id = "bscroll"; box.classList.add("lbbox"); box.dataset.key = key; return box; };
  const keepBox = (box) => { const k = LB.keep[box.dataset.key]; if (k) { box.scrollTop = k.top; box.scrollLeft = k.left; } };
  // a phone's long name steps down to 13 then 11.5px before it ellipsises, as the baseball Leaderboard's does (measured on a canvas, the
  // room read once per cell after one reset, so it costs a single layout)
  const CV = document.createElement("canvas").getContext("2d");
  const textW = (t, f) => { if (CV.font !== f) CV.font = f; return CV.measureText(t).width; };
  function fitNames(t) {
    if (document.documentElement.dataset.view !== "mobile") return;
    const box = t.closest(".lbbox"); if (!box) return;
    const names = [...t.querySelectorAll(box.classList.contains("namefz") ? "tbody td.fz .lnk" : "tbody td.fz2 .lnk")]; if (!names.length) return;
    for (const a of names) { a.style.fontSize = ""; a.style.letterSpacing = ""; }
    const cs = getComputedStyle(names[0]), base = parseFloat(cs.fontSize) || 12, fam = cs.fontFamily, wt = cs.fontWeight;
    const rooms = names.map((a) => { const c = a.closest("td"), p = getComputedStyle(c), b = c.querySelector(".rwflag"); return c.clientWidth - parseFloat(p.paddingLeft) - parseFloat(p.paddingRight) - (b ? b.offsetWidth + 5 : 0) - 1; });
    const fits = (s, px, ls, room) => textW(s, `${wt} ${px}px ${fam}`) + ls * px * s.length <= room;
    names.forEach((a, i) => { const s = a.textContent; if (fits(s, base, 0, rooms[i])) return; a.style.fontSize = "13px"; a.style.letterSpacing = "-0.02em"; if (!fits(s, 13, -0.02, rooms[i])) a.style.fontSize = "11.5px"; });
  }
  const freeze = (t) => requestAnimationFrame(() => { fitNames(t); const first = t.querySelector("tbody td.fz"); if (first) t.style.setProperty("--fzw", first.offsetWidth + "px"); });   // the second frozen column sits after the first's measured width
  // a percentile among a list (ties at half; the baseball's insertPct), for a page that colours a column by its own rows
  const ranker = (arr, hib = true) => { const s = arr.filter((x) => x != null && isFinite(x)).sort((a, b) => a - b); return (v) => { if (v == null || !isFinite(v) || s.length < 2) return null; let lo = 0, eq = 0; for (const x of s) { if (x < v) lo++; else if (x === v) eq++; } const p = 100 * (lo + 1 + eq / 2) / (s.length + 1); return hib ? p : 100 - p; }; };
  // the dropdown's body: the page's tabs across the top, the tab the page draws (h = the helpers every tab uses), the Table format tab shared
  function popBody() {
    const spec = POP.spec, pop = popEl(), body = $("#pop-body", pop); body.textContent = ""; pop.hidden = false;
    const tabs = el("div", "ptabs grptabs"); tabs.setAttribute("role", "tablist");
    for (const [tk, lab] of spec.tabs) { const b = el("button", "ptab" + (tk === POP.open ? " on" : ""), lab); b.type = "button"; b.setAttribute("role", "tab"); b.setAttribute("aria-selected", String(tk === POP.open)); b.addEventListener("click", (e) => { e.stopPropagation(); ddClose(); POP.open = tk; S.popTab = Object.assign({}, S.popTab, { [spec.page]: tk }); save(); popBody(); placePop(); }); tabs.append(b); }
    const w = el("div", "textmodal"), foot = el("div", "popfoot");
    const h = {
      sec: (name) => { const s = el("div", "popsec"); s.append(el("h4", null, name)); w.append(s); return s; },
      note: (s, txt) => s.append(el("p", "note", txt)),
      seg: (opts, cur, pick) => { const g = el("div", "seg"); g.setAttribute("role", "group"); for (const [v, lab] of opts) { const b = el("button", "segbtn", lab); b.type = "button"; b.setAttribute("aria-pressed", String(v === cur)); b.addEventListener("click", () => pick(v)); g.append(b); } return g; },
      row: (...kids) => { const r = el("div", "poprow"); r.append(...kids); return r; },
      lbl: (txt) => el("span", "splbl", txt),
      num: (word, val, attrs, pick) => { const f = el("label", "field"), i = el("input"); i.type = "number"; i.inputMode = "numeric"; Object.assign(i, attrs); i.value = val; i.addEventListener("change", () => pick(i.value)); f.append(word, i); return f; },
      toggle: (label, hint, on, pick) => { const l = el("label", "toggle trow"), c = el("input"); c.type = "checkbox"; c.checked = !!on; c.addEventListener("change", () => pick(c.checked)); const t = el("span"); t.append(el("b", null, label)); if (hint) t.append(el("small", null, hint)); l.append(c, t); return l; },
      btn: (label, fn, quiet) => { const b = el("button", "btn" + (quiet ? " btn-quiet" : ""), label); b.type = "button"; b.addEventListener("click", fn); return b; },
      clear: (fn) => { const b = el("button", "linkbtn popclear", "Clear"); b.type = "button"; b.addEventListener("click", fn); foot.append(b); },
      footRow: (...btns) => { const r = el("div", "row"); r.append(...btns); foot.append(r); },
    };
    if (POP.open === "table" && !spec.ownTable) {   // the Tables tab every list page shares: the tables' dress (Leaders has its own Table format tab)
      const s = h.sec("Tables"), T = window.FB_TABLES;
      if (T) s.append(h.seg([["bref", "Baseball-Reference"], ["classic", "Classic"]], T.get(), (v) => { T.set(v); route(); }));
      h.note(s, "Baseball-Reference: 12px type in 23px rows. Classic: 13px type in roomier rows, the column names the size of the numbers. The same switch as Settings ▸ Appearance ▸ Tables; kept on this device.");
      if (T && T.own()) h.clear(() => { T.clear(); route(); });
    } else spec.draw(POP.open, h);
    body.append(tabs, w); if (foot.children.length) body.append(foot);
    if (POP.focus) { const f = body.querySelector(POP.focus); POP.focus = null; if (f) { f.focus(); try { f.setSelectionRange(f.value.length, f.value.length); } catch (e) { /* not a text box */ } } }   // a search box keeps the cursor through the redraw its typing causes
  }
  const TABLE_TAB = ["table", "Tables"];
  const seasonPill = (y, pick, opts) => pillSelect(String(y), (opts || [...SEASONS].reverse()).map((v) => [v, String(v)]), y, pick, "Season");

  // ---------- Leaders ----------
  // the baseball Leaderboard's dress (23 Oct 2026): one Filters button with the count beside it, the title over the red rule, the table in the
  // framed box with the column names pinned at its top and the page bar at its foot — only the box scrolls — and the note under it. The
  // headline column (xFP/G, a quarterback's FP/G: the default sort, the baseball's xwOBA) sits right after Tm — right after the name on a
  // phone, where Tm goes last — coloured by its percentile; the other columns are whatever Filters ▸ Stats ticks (S.lbCols[pos]: an ordered
  // list of keys, or nothing for every group in its own order), in the order Table format gives them (S.lbBrk[pos] = the keys with a dividing
  // line after). A name, or its row, opens his page as a popup over the list.
  const POS_WORD = { WR: "Receiver", TE: "Tight end", RB: "Running back", QB: "Quarterback" };
  const LB_TABS = [["position", "Position"], ["season", "Season"], ["stats", "Stats"], ["table", "Table format"]];
  const LB = { keep: {} };   // each box's scroll under its key, noted by route() before a redraw and put back when the same list draws again (a tick in the dropdown, a trip to a page and back)
  const lbSize = () => ([25, 50, 100, 0].includes(S.lbSize) ? S.lbSize : isMobile() ? 25 : 50);   // 0 = everyone on one page
  const headKey = (pos) => (pos === "QB" ? "fpg" : "xfpg");
  const lbAllKeys = (pos) => COLS[pos].flatMap((g) => g[1]).filter((k) => k !== headKey(pos));
  // the columns Leaders opens on: the ones that carry fantasy points (Sean, 23 Oct 2026: "limit the leaderboard stats to really just the stats
  // that matter most for fantasy scoring"). For receivers: playing time (Route%), how often he's thrown to (TPRR, target share, WOPR, red-zone
  // targets) and what he does per route (YPRR, stable YPRR) — the stats that repeat and track next season's FP / G (TPRR .68 / .63, YPRR .60 / .65,
  // WO% .72 / .68). Backs: snaps, carry and target share, weighted opportunities (WO/G is the best volume read of a back's next season, .63),
  // high-value touches and goal-line work. Quarterbacks: passing volume and touchdowns, efficiency, and rushing (Rush xFP/G). Every other
  // column is still in Filters ▸ Stats (the All set, or each group).
  const CORE = {
    WR: ["fpg", "g", "rte", "tprr", "tgtsh", "wopr", "awopr", "rzt", "wos", "yprr", "syprr"],
    RB: ["fpg", "g", "snp", "carsh", "tgtsh", "oppg", "wog", "wos", "hvtg", "gls", "rzs"],
    QB: ["g", "att", "pyd", "ptd", "int", "epadb", "car", "ruxg", "xfpg"],
  };
  CORE.TE = CORE.WR;
  if (!S.coreCols) { S.lbCols = {}; S.coreCols = 1; }   // once: a list saved before the core set moves to it
  const groupOf = (pos, k) => (COLS[pos].find((g) => g[1].includes(k)) || [""])[0];
  const lbKeys = (pos) => { const all = lbAllKeys(pos), own = S.lbCols && S.lbCols[pos]; return Array.isArray(own) ? own.filter((k) => all.includes(k)) : CORE[pos].filter((k) => all.includes(k)); };   // the columns showing, in order (the core set unless he's picked his own)
  const setLbKeys = (pos, keys) => { S.lbCols = Object.assign({}, S.lbCols, { [pos]: keys }); S.lbPage = 1; save(); };
  const lbBrk = (pos) => (S.lbBrk && S.lbBrk[pos]) || [];
  // the groups the table draws from the ordered keys: a run of one group's columns keeps its name; a user's dividing line or a change of group ends a run
  const lbGroups = (pos, keys) => { const out = [], brk = lbBrk(pos); let run = null; for (const k of keys) { const gn = groupOf(pos, k); if (!run || run.name !== gn) { run = { name: gn, end: 1, cols: [] }; out.push(run); } run.cols.push(k); if (brk.includes(k)) run = null; } return out; };
  const tblPref = () => Object.assign({ heat: false, sortHl: true, numbers: "values" }, S.tbl || {});   // Table format ▸ Look
  const minText = (pos, meta) => { const f = frac(meta); return pos === "QB" ? `${Math.round(200 * f)}+ dropbacks` : pos === "RB" ? `${Math.round(90 * f)}+ carries + targets` : `${Math.round(200 * f)}+ routes or ${Math.round(40 * f)}+ targets`; };
  const lbCount = (D, p) => D.players.filter((x) => posGroup(x.pos) === p && (S.qualOnly === false ? (x.tgt || x.car || x.db) : qualifies(x, D.meta))).length;
  async function leaders(main) {
    const y = SEASONS.includes(+S.season) ? +S.season : CUR, pos = ["WR", "TE", "RB", "QB"].includes(S.pos) ? S.pos : "WR";
    const D = await ensure(y), meta = D.meta, mob = isMobile(), T = tblPref();
    const head = headKey(pos), keys = lbKeys(pos), shown = [head, ...keys];
    if (!S.sort || !shown.includes(S.sort)) { S.sort = head; S.dir = METRIC[head].hib === 0 ? 1 : -1; }
    const k = S.sort, dir = S.dir, q = norm(S.lbQ || "").trim();
    let rows = D.players.filter((p) => posGroup(p.pos) === pos && (S.qualOnly === false ? (p.tgt || p.car || p.db) : qualifies(p, meta)));
    if (q) rows = rows.filter((p) => norm(p.n).includes(q));   // the Position tab's name search narrows the list in place
    rows.sort((a, b) => { const va = M(a)[k], vb = M(b)[k]; if (va == null) return 1; if (vb == null) return -1; return dir * (va - vb); });
    const size = lbSize(), n = rows.length, pages = size ? Math.max(1, Math.ceil(n / size)) : 1, page = Math.min(Math.max(1, +S.lbPage || 1), pages);
    const from = size ? (page - 1) * size : 0, to = size ? Math.min(n, from + size) : n;
    main.textContent = "";
    POP.spec = { page: "leaders", ownTable: true, tabs: LB_TABS, keys: ["pos", "season", "qualOnly", "lbCols", "lbBrk", "lbQ", "tbl", "sort", "dir"], draw: (tab, h) => lbDraw(tab, h, y, pos, meta) };
    // the control row: the Filters button, labelled by who's listed and how many filters beyond the defaults are on, and the count
    const extra = (y !== CUR) + (S.qualOnly === false) + (keys.join() !== CORE[pos].filter((x) => lbAllKeys(pos).includes(x)).join()) + (q ? 1 : 0), range = `${n ? from + 1 : 0}–${to} of ${n}`;
    const board = listFrame(main, { page: "leaders", title: `${POS_WORD[pos]} Leaderboard`, sub: `by ${METRIC[k].h}`,
      ctl: [filtersBtn(`${POS_WORD[pos]} filters`, extra), count(`${range} ${pos}s · ${y}${meta.through < 18 ? " · through week " + meta.through : ""} · PPR${S.qualOnly === false ? "" : " · " + minText(pos, meta)}${q ? ` · "${S.lbQ.trim()}"` : ""}`, range)] });
    // the columns, each with its cell for a player's row and for the Qualified avg foot: Rk · Player · Tm · the headline · the groups
    // (a phone: Rk · Player · the headline · the groups · Tm, and the sorted column moves up beside the name — table())
    const sortBy = (key) => () => { if (S.sort === key) S.dir = -S.dir; else { S.sort = key; S.dir = METRIC[key].hib === 0 ? 1 : -1; } S.lbPage = 1; save(); route(); };
    const pl = pool(y, pos), best = {};   // a value equal to the best among the qualifiers reads bold italic (B-Ref's league leader)
    for (const kk of shown) { const sl = pl.sorted[kk]; if (!sl || !sl.length || kk === "g") continue; const b = METRIC[kk].hib === 0 ? sl[0] : sl[sl.length - 1]; if (sl.filter((v) => v === b).length <= 3) best[kk] = b; }   // a best that a dozen share (a 0.0% drop rate) isn't a lead
    const avg = (kk) => { const v = pl.ref.map((p) => M(p)[kk]).filter((x) => x != null && isFinite(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
    const rk = { h: "Rk", cls: "fz", cell: (p, m, i) => td(String(from + i + 1), "fz rk"), foot: () => td("", "fz") };
    const nm = { h: "Player", cls: "l fz2", cell: (p) => playerCell(p.n, p.id, "l fz2"), foot: () => td(`${mob ? "Qual." : "Qualified"} avg (${pl.ref.length})`, "l fz2") };
    const tm = { h: "Tm", cell: (p) => td(p.tms && p.tms.length > 1 ? p.tms.join("/") : p.tm, "c"), foot: () => td("") };
    const stat = (kk) => ({ h: METRIC[kk].h, cls: "stat", t: (METRIC[kk].t || METRIC[kk].h) + (METRIC[kk].hib === 0 ? " — lower is better" : ""), onSort: sortBy(kk), lit: kk === k, key: kk,
      cell: (p, m) => { const v = m[kk], pv = pctOf(y, pos, kk, v), c = td(T.numbers === "pct" && pv != null ? String(Math.round(pv)) : fmtM(kk, v), "stat");
        if (kk === k ? T.sortHl : T.heat) paint(c, pv);   // Look: the sorted column coloured (Highlight the sorted stat), or every column (Heat map)
        if (best[kk] != null && v === best[kk] && qualifies(p, meta)) { c.classList.add("mlblead"); c.title = `Best among the qualified ${pos}s`; }
        return c; },
      foot: () => td(T.numbers === "pct" ? "50" : fmtM(kk, avg(kk)), "stat") });
    const groups = [mob ? { cols: [rk, nm] } : { cols: [rk, nm, tm], end: 1 }, { cols: [stat(head)], end: 1 }, ...lbGroups(pos, keys).map((g) => ({ name: g.name, end: 1, cols: g.cols.map(stat) }))];
    if (mob) groups.push({ cols: [tm] });
    const order = groups.flatMap((g) => g.cols);   // the row cells in the header's own order (table() re-sorts them on a phone)
    const t = table(groups), box = boxOf(t, [y, pos, page, size, k, dir, q, keys.join(","), T.heat, T.sortHl, T.numbers].join(":")); box.classList.add("noover", "lbfit");   // a phone drops the group names here, as the baseball Leaderboard does
    rows.slice(from, to).forEach((p, i) => { const m = M(p); rowPop(t.addRow(order.map((c) => c.cell(p, m, i))), p.id); });
    if (page === pages) {   // the last page closes with the strip and the Qualified avg row
      t.addRow(order.map(() => td("")), "lbgap");
      t.addRow(order.map((c) => c.foot()), "tot first");
    }
    // the page bar as the table's last row
    const bar = el("div", "pagebar phbot"); bar.id = "pagerbot";
    bar.append(pageNav(page, pages, (p) => { S.lbPage = p; save(); route(); }));
    const ps = el("label", "field psize phsize"), sel = el("select"); sel.setAttribute("aria-label", "Per page");
    for (const [v, lab] of [[25, "25"], [50, "50"], [100, "100"], [0, "All"]]) { const o = el("option", null, lab); o.value = v; if (v === size) o.selected = true; sel.append(o); }
    sel.addEventListener("change", () => { S.lbSize = +sel.value; S.lbPage = 1; save(); route(); });
    ps.append(el("span", null, "Per page"), sel); bar.append(ps); box.append(bar);
    board.append(box);
    main.append(el("p", "note lbnote", `Everyone over the minimum, a page at a time (the page numbers and Per page are under the table). ${METRIC[head].h} leads the columns and the sorted column is coloured by its percentile among the season's qualified ${pos}s (${minText(pos, meta)}); tap a column name to sort, a name for his page. xFP prices each target and carry by what a play like it scores on average in PPR, fitted on the other seasons. ` + (meta.estRoutes ? "Routes this season are estimated from snap share × team dropbacks until nflverse publishes participation." : "Routes are dropbacks he was on the field for.")));
    keepBox(box); freeze(t);
    if (POP.open) { popBody(); placePop(); }
  }
  // the dropdown's tabs: Position (a name search, then the four positions as tick labels with each one's count), Season (the year pill and who's
  // listed), Stats (the column sets as buttons, Sort by, a tick per column, Done · Cancel · Reset), Table format (the column order with ↑ ↓,
  // Gap after and ×, then Look: the heat map, the sorted column's colour, values or percentiles, the tables' dress)
  function lbDraw(tab, h, y, pos, meta) {
    const D = window.FB[y], head = headKey(pos), all = lbAllKeys(pos), cur = lbKeys(pos), k = S.sort;
    if (tab === "position") {
      const s = h.sec("Player"), lab = el("label", "search"), qi = el("input"); qi.type = "search"; qi.placeholder = "Search name"; qi.value = S.lbQ || ""; qi.setAttribute("aria-label", "Search name"); lab.append(qi); s.append(h.row(lab));
      qi.addEventListener("input", () => { S.lbQ = qi.value; S.lbPage = 1; save(); POP.focus = ".search input"; route(); });   // the list narrows as he types; the box keeps its cursor through the redraw
      const ps = h.sec("Position"), grid = el("div", "posgrid");
      for (const p of ["WR", "TE", "RB", "QB"]) {
        const l = el("label", "poschk" + (p === pos ? " on" : "")), c = el("input"); c.type = "radio"; c.name = "lbpos"; c.checked = p === pos;
        c.addEventListener("change", () => { S.pos = p; S.sort = null; S.lbPage = 1; save(); route(); });
        l.append(c, el("span", "pname", POS_WORD[p] + "s"), el("span", "pcount", String(lbCount(D, p)))); grid.append(l);
      }
      ps.append(grid);
      h.note(ps, `One position at a time, each ranked among its own qualifiers: ${minText(pos, meta)} for ${pos}s this season${meta.through < 18 ? " (the minimums are scaled by the weeks played)" : ""}. Tight ends carry the receivers' columns; fullbacks count as running backs.`);
      if (S.lbQ) h.clear(() => { S.lbQ = ""; S.lbPage = 1; save(); route(); });
    } else if (tab === "season") {
      const s = h.sec("Which season");
      s.append(h.row(h.lbl("Season"), seasonPill(y, (v) => { S.season = v; S.lbPage = 1; save(); route(); })));
      h.note(s, meta.through < 18 ? `${y} is through week ${meta.through}; the qualifying minimums are scaled by the weeks played.` : `${y}, the full season.`);
      const qs = h.sec("Who's listed");
      qs.append(h.seg([[true, "Qualified only"], [false, "Everyone"]], S.qualOnly !== false, (v) => { S.qualOnly = v; S.lbPage = 1; save(); route(); }));
      h.note(qs, `Qualified ${pos}s have ${minText(pos, meta)}. Everyone lists anyone with a target, carry or dropback; the percentiles are always against the qualifiers.`);
      if (y !== CUR || S.qualOnly === false) h.clear(() => { S.season = CUR; S.qualOnly = true; S.lbPage = 1; save(); route(); });
    } else if (tab === "stats") {
      const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
      const s = h.sec("Column sets"), sb = el("div", "lbpills lbsetbtns"), sg = el("div", "seg"); sg.setAttribute("role", "group"); sg.setAttribute("aria-label", "Column sets");
      const sets = [["Fantasy core", CORE[pos].filter((x) => all.includes(x))], ["All", all], ...COLS[pos].map(([name, ks]) => [name, ks.filter((x) => x !== head)])], curName = (sets.find(([, ks]) => same(ks, cur)) || ["Custom"])[0];
      for (const [name, ks] of sets) { const b = el("button", "segbtn", name); b.type = "button"; b.setAttribute("aria-pressed", String(name === curName)); b.addEventListener("click", () => { setLbKeys(pos, ks.slice()); route(); }); sg.append(b); }
      if (curName === "Custom") { const b = el("button", "segbtn", "Custom"); b.type = "button"; b.disabled = true; b.setAttribute("aria-pressed", "true"); b.title = "Your own ticks below"; sg.append(b); }
      sb.append(sg); s.append(sb);
      s.append(h.row(h.lbl("Sort by"), pillSelect(METRIC[k].h, [head, ...cur].map((kk) => [kk, METRIC[kk].h]), k, (v) => { S.sort = v; S.dir = METRIC[v].hib === 0 ? 1 : -1; S.lbPage = 1; save(); route(); }, "Sort by")));
      h.note(s, `A set shows that group's columns alone (${METRIC[head].h} always leads). Tick any column below to add or drop it; the table redraws as you go, and Table format orders them.`);
      const grid = el("div", "colgrid");
      for (const [name, ks] of COLS[pos]) {
        const g = el("div", "colgroup"); g.append(el("h4", null, name));
        for (const kk of ks) {
          if (kk === head) continue;
          const lab = el("label", "toggle"), cb = el("input"); cb.type = "checkbox"; cb.checked = cur.includes(kk); if (METRIC[kk].t) lab.title = METRIC[kk].t;
          cb.addEventListener("change", () => {
            const ks2 = cur.filter((x) => x !== kk);
            if (cb.checked) { let at = ks2.length; for (let i = all.indexOf(kk) + 1; i < all.length; i++) { const j = ks2.indexOf(all[i]); if (j >= 0) { at = j; break; } } ks2.splice(at, 0, kk); }   // back in its own place among the columns showing
            setLbKeys(pos, ks2); route();
          });
          lab.append(cb, " ", METRIC[kk].h); g.append(lab);
        }
        grid.append(g);
      }
      s.append(grid);
      h.footRow(h.btn("Done", () => closePanel(false)), h.btn("Cancel", () => closePanel(true), true), h.btn("Reset to defaults", () => { const c = Object.assign({}, S.lbCols); delete c[pos]; S.lbCols = c; const b = Object.assign({}, S.lbBrk); delete b[pos]; S.lbBrk = b; S.sort = null; S.lbPage = 1; save(); route(); }, true));
    } else if (tab === "table") {
      const T = tblPref(), apply = () => { S.tbl = T; save(); route(); };
      const s = h.sec("Column order"); h.note(s, "Top to bottom is left to right on the table. Use the arrows; Gap after draws a dividing line after a stat; × takes it off. Tick more stats on the Stats tab.");
      const list = el("ol", "olist"), brk = lbBrk(pos);
      const btn = (cls, txt, title, dis, fn) => { const b = el("button", cls, txt); b.type = "button"; b.title = title; b.setAttribute("aria-label", title); b.disabled = dis; b.addEventListener("click", (e) => { e.stopPropagation(); fn(); }); return b; };
      cur.forEach((kk, i) => {
        const li = el("li", "orow" + (brk.includes(kk) ? " brk" : "")), lab = METRIC[kk].h, on = brk.includes(kk);
        const move = (d) => { const a = cur.slice(), [x] = a.splice(i, 1); a.splice(i + d, 0, x); setLbKeys(pos, a); route(); };
        const gap = btn("obrk" + (on ? " on" : ""), "Gap after", on ? "Remove the dividing line after this stat" : "A dividing line after this stat", false, () => { S.lbBrk = Object.assign({}, S.lbBrk, { [pos]: on ? brk.filter((x) => x !== kk) : brk.concat(kk) }); save(); route(); });
        gap.setAttribute("aria-pressed", String(on));
        li.append(el("span", "onum", String(i + 1)), el("span", "olbl", lab), btn("omove", "↑", `Move ${lab} left`, i === 0, () => move(-1)), btn("omove", "↓", `Move ${lab} right`, i === cur.length - 1, () => move(1)), gap,
                  btn("orm", "×", `Take ${lab} off the table`, cur.length < 2, () => { setLbKeys(pos, cur.filter((x) => x !== kk)); route(); }));
        list.append(li);
      });
      s.append(list);
      const lk = h.sec("Look");
      lk.append(h.toggle("Heat map", "colour every number by its percentile among the qualifiers (off = only the sorted column, like Savant)", T.heat, (v) => { T.heat = v; apply(); }),
                h.toggle("Highlight the sorted stat", "colour the column the table is sorted by", T.sortHl, (v) => { T.sortHl = v; apply(); }));
      lk.append(h.row(h.lbl("Numbers"), h.seg([["values", "Values"], ["pct", "Percentiles"]], T.numbers, (v) => { T.numbers = v; apply(); })));
      const TB = window.FB_TABLES; if (TB) { lk.append(h.row(h.lbl("Tables"), h.seg([["bref", "Baseball-Reference"], ["classic", "Classic"]], TB.get(), (v) => { TB.set(v); route(); }))); h.note(lk, "Baseball-Reference: 12px type in 23px rows. Classic: 13px type in roomier rows. The same switch as Settings ▸ Appearance ▸ Tables; kept on this device."); }
      h.footRow(h.btn("Done", () => closePanel(false)), h.btn("Reset to defaults", () => { S.tbl = null; const b = Object.assign({}, S.lbBrk); delete b[pos]; S.lbBrk = b; const c = Object.assign({}, S.lbCols); delete c[pos]; S.lbCols = c; if (TB) TB.clear(); save(); route(); }, true));
    }
  }

  // ---------- Player page ----------
  const BARS = {
    WR: [[["Opportunity", ["rte", "tgtsh", "tprr", "aysh", "rzt"]], ["Fantasy", ["xfpg", "fpg", "fpoeg", "tdoe"]], ["Profile", ["adot", "wopr", "awopr", "snp"]]], [["Weighted opportunity", ["wos", "rzs", "ezs"]], ["Efficiency", ["yprr", "syprr", "croe", "yacoe", "nyoe", "ypr"]]]],
    RB: [[["Opportunity", ["snp", "carsh", "tgtsh", "oppg", "glc"]], ["Weighted opportunity", ["wog", "wos", "hvtg", "hvtp", "rzs", "gls"]], ["Fantasy", ["xfpg", "fpg", "fpoeg", "tdoe"]]], [["Efficiency", ["ypc", "ryoe", "expl", "ybca", "fppo"]], ["Receiving", ["tprr", "yprr", "syprr"]]]],
    QB: [[["Passing", ["epadb", "cpoe", "cmpp", "sackp"]], ["Fantasy", ["xfpg", "fpg", "fpoeg"]]], [["Rushing", ["carg", "ruxg", "ypc", "rutd"]], ["Volume", ["att", "pyd", "ptd"]]]],
  };
  BARS.TE = BARS.WR;
  const LABEL = { rte: "Route %", tgtsh: "Target share", tprr: "Targets / route", aysh: "Air-yard share", rzt: "Red-zone targets", xfpg: "xFP / game", fpg: "FP / game", fpoeg: "Points over exp. / G",
                  tdoe: "TD over expected", yprr: "Yards / route", syprr: "Stable YPRR", croe: "Catch rate over exp.", yacoe: "YAC over exp.", ypr: "Yards / catch", adot: "aDOT", wopr: "WOPR", awopr: "Adjusted WOPR", snp: "Snap %",
                  carsh: "Carry share", oppg: "Opportunities / G", glc: "Goal-line carries", ypc: "Yards / carry", ryoe: "Rush yds over exp.", fppo: "FP / opportunity",
                  epadb: "EPA / dropback", cpoe: "CPOE", cmpp: "Completion %", sackp: "Sack %", carg: "Carries / game", ruxg: "Rush xFP / game", rutd: "Rush TD", att: "Attempts", pyd: "Pass yards", ptd: "Pass TD",
                  sep: "Separation", sepoe: "Separation over exp.", cont: "Contested target %", contoe: "Contested over exp.", cush: "Cushion", nyoe: "YAC over exp. (NGS)", brkr: "Broken tackles / catch", dropp: "Drop %", brka: "Broken tackles / carry", ybca: "Yds before contact", yaca: "Yds after contact", eff: "Efficiency (NGS)", tlos: "Time to the line",
                  elus: "Elusive rating", expl: "Explosive run %", bkwy: "Breakaway %", stuff: "Stuffed %",
                  wog: "Weighted opp. / G", wos: "Weighted opp. share", hvtg: "High-value touches / G", hvtp: "High-value touch %", rzs: "Red-zone opp. share", gls: "Goal-line carry share", ezs: "End-zone target share" };
  // what the skill stats are worth, under the bars (the study of 16 Oct 2026: every qualified season 2018-25 against this season's points
  // per target / opportunity, points over expected and next season's; year-to-year r in brackets)
  const SKILL_NOTE = {
    WR: "Efficiency is what he does with the targets the Opportunity bars say he gets. Catch rate over expected and YAC over expected explain this season's points per target (r .73 / .40) but move from year to year (r .23 / .32); yards per route repeats (.57) and follows next season's points (.60). Stable YPRR is his targets per route × his yards per target pulled toward his position's league by targets / (targets + 180) — the YPRR that travels: it repeats across a change of club at r .51 against raw YPRR's .42 (an offense or QB adjustment doesn't; the shrinkage does). Separation, cushion, contested targets, broken tackles and drops came off the site on 23 Oct 2026: they either don't repeat or don't touch fantasy points.",
    RB: "Efficiency is what he does with the work the Opportunity bars say he gets. Yards per carry, rush yards over expected, explosive runs (10+ yards) and yards before contact explain this season's points per opportunity (r .45 / .31 / .38 / .38) but barely repeat (r .20-.28) — next season's points follow this season's opportunities, not these. The elusive rating, broken tackles, yards after contact, breakaway %, NGS efficiency, time to the line, 8+ box % and stuffed runs came off the site on 23 Oct 2026: they either don't repeat or don't touch fantasy points.",
  };
  // weighted opportunity (20 Oct 2026): what the bars of that name are, and which of them carry into next season
  SKILL_NOTE.RB += " Weighted opportunity counts a target as 2.5 carries — what a back's target is worth over his carry by expected points — and per game it is the best volume measure of next season's points (r .63 with next season's FP/G, xFP/G .62, plain carries + targets .59). High-value touches are catches plus carries inside the 10; the high-value share says what kind of back he is (it repeats at r .73) more than how much he scores. The red-zone and goal-line shares are his slice of his team's chances there and move more from year to year (r .59 / .47).";
  SKILL_NOTE.WR += " Weighted opportunity share is his carries + 2.5 × targets over his team's, in his games: his slice of the offense, as good as xFP/G at next season's points (r .68 for receivers, .71 for tight ends) and a touch steadier year to year than his targets per game. For receivers, weighting targets by depth doesn't beat plain targets — a target is a target. The red-zone and end-zone shares are his part of his team's scoring chances; they move more from year to year (r .52 / .50 for receivers, .53 / .44 for tight ends).";
  SKILL_NOTE.TE = SKILL_NOTE.WR;

  // ---------- the player page (Sean, 23 Oct 2026: "make the site look and function exactly like the baseball one") ----------
  // The baseball page, piece for piece, from the top: a bar that sticks under the site header (the round headshot, his name, the bio line
  // in words with a dot before each item, the season as a boxy white "2026 ▾" button at the right — the football page has no filters,
  // so no Filters ▾), the band holding only the Summary (the season shown and his career, FP/G and xFP/G as pills in their percentile
  // colour), the Bio box, the season-by-season table with its view switch, the centred "2026 WR Percentiles" title (the year a picker),
  // Savant's charts drawn by the baseball's own pctSvg, the skills note, and the tab strip over a white box. bleedBar() runs the bar out
  // to the screen's edges, stickSync() shows its red rule once the band has scrolled under it, and footSync() paints a phone's html canvas
  // the colour of the end it is bouncing at.
  const TEAM_FULL = { ARI: "Arizona Cardinals", ATL: "Atlanta Falcons", BAL: "Baltimore Ravens", BUF: "Buffalo Bills", CAR: "Carolina Panthers", CHI: "Chicago Bears", CIN: "Cincinnati Bengals",
    CLE: "Cleveland Browns", DAL: "Dallas Cowboys", DEN: "Denver Broncos", DET: "Detroit Lions", GB: "Green Bay Packers", HOU: "Houston Texans", IND: "Indianapolis Colts", JAX: "Jacksonville Jaguars",
    KC: "Kansas City Chiefs", LA: "Los Angeles Rams", LAC: "Los Angeles Chargers", LV: "Las Vegas Raiders", MIA: "Miami Dolphins", MIN: "Minnesota Vikings", NE: "New England Patriots",
    NO: "New Orleans Saints", NYG: "New York Giants", NYJ: "New York Jets", PHI: "Philadelphia Eagles", PIT: "Pittsburgh Steelers", SEA: "Seattle Seahawks", SF: "San Francisco 49ers",
    TB: "Tampa Bay Buccaneers", TEN: "Tennessee Titans", WAS: "Washington Commanders" };
  const POS_FULL = { WR: "Wide Receiver", TE: "Tight End", RB: "Running Back", FB: "Fullback", QB: "Quarterback" };
  const draftLine = (e) => (e.dr ? `${e.dr[0]} R${e.dr[1]} #${e.dr[2]}` : "UDFA");

  // ---------- his page as a popup over a list (the baseball's #xboard.xpop) ----------
  // on Leaders, Role Watch, Dynasty and Backfields a name (or its row) opens his whole page in a fixed window over the list — its own
  // scroller, the sticky bar at its top with a × in a strip above the name — so the list is exactly where it was when the popup closes:
  // nothing redraws it. ×, the backdrop, Escape or any hash change close it (a team link or the header search go to a page). A season or a
  // tab picked inside redraws the popup in place (repaint). Every other page goes to his page as before.
  const XPOP_PAGES = new Set(["leaders", "roles", "dynasty", "backfields"]);
  let XP = null;   // { id } while a popup is up
  const pageHost = () => (XP ? $("#xboard") : $("main"));   // where the player page was last drawn
  function openPlayer(id, ev) {
    noteRecent(id);
    if (!XPOP_PAGES.has(document.body.dataset.page) || (ev && (ev.metaKey || ev.ctrlKey || ev.shiftKey))) { if (!(ev && ev.target.closest("a"))) location.hash = "#player/" + id; return; }   // a page without the popup: the link itself navigates (a row sets the hash); a modifier key opens a tab
    if (ev) ev.preventDefault();
    ddClose(); XP = { id }; drawPop(true);
  }
  function drawPop(fresh) {
    let bg = $(".xpopbg"), xb = $("#xboard");
    if (!bg) { bg = el("div", "xpopbg"); bg.addEventListener("click", closeXPop); document.body.append(bg); }
    if (!xb) { xb = el("section", "xpop"); xb.id = "xboard"; xb.setAttribute("role", "dialog"); xb.setAttribute("aria-modal", "true"); xb.setAttribute("aria-label", "Player"); document.body.append(xb); }
    document.body.classList.add("xpopon");
    const top = fresh ? 0 : xb.scrollTop, id = XP.id;
    xb.innerHTML = '<p class="load">Loading…</p>';
    player(xb, id).then(() => { if (XP && XP.id === id) xb.scrollTop = top; }).catch((err) => { xb.textContent = ""; xb.append(el("p", "load", "Couldn't load that season's data. Check the connection and reload.")); console.error(err); });
  }
  function closeXPop() { if (!XP) return; XP = null; ddClose(); const xb = $("#xboard"), bg = $(".xpopbg"); if (xb) xb.remove(); if (bg) bg.remove(); document.body.classList.remove("xpopon"); }
  window.addEventListener("hashchange", closeXPop);
  const repaint = () => (XP ? drawPop(false) : route());   // a season or a tab picked on his page: the popup in place, else the page

  async function player(main, id) {
    const e = IDX[id]; if (!e) { main.textContent = ""; main.append(el("p", "load", "No player with that id.")); return; }
    const seasons = [...e.s].sort((a, b) => a - b);
    const y = S.pseason && S.pseason[id] && seasons.includes(S.pseason[id]) ? S.pseason[id] : seasons[seasons.length - 1];
    const [D, , Dp] = await Promise.all([ensure(y), loadScript("data/career.js").catch(() => null), seasons.includes(y - 1) ? ensure(y - 1).catch(() => null) : null]), p = D.players.find((q) => q.id === id);
    if (!p) { main.textContent = ""; main.style.minHeight = ""; main.append(el("p", "load", "No line for that season.")); return; }
    const pos = posGroup(p.pos), m = M(p), meta = D.meta, p1 = Dp && Dp.players.find((q) => q.id === id), m1 = p1 ? M(p1) : null;   // last season's line, for the bars' tap note
    const yearOpts = [...seasons].reverse().map((s) => [s, String(s)]);
    const pickYear = (v) => { S.pseason = Object.assign({}, S.pseason, { [id]: +v }); save(); repaint(); };   // the page keeps its place (the same hash); the popup redraws in place
    main.textContent = "";
    const bar = playerBar(e, p, y, yearOpts, pickYear);
    if (main.id === "xboard") { bar.classList.add("xbar"); const x = el("button", "xpopx", "×"); x.type = "button"; x.setAttribute("aria-label", "Close"); x.addEventListener("click", closeXPop); bar.append(x); }   // the popup's ×, in the strip over the name
    main.append(bar);
    // the band under the bar: the blue plate with the Summary alone (the bio rides in the bar), the 3px stripe and its 2px shadow under it
    const top = el("div", "cardtop phead pagehead"), plate = el("div", "mplate pbio pbone"); plate.append(summaryBlock(id, p, y, pos)); top.append(plate);
    main.append(top, bioBox(e, p, y), seasonBlock(id, y, pos));
    // "2026 ▾ WR Percentiles", centred: the year is where the season is picked, over four light-blue dots (a plain word with one season)
    const pt = el("h3", "pcthd"), yw = el("span", "dd tsel"), yb = el("button", "tsl", String(y)); yb.type = "button"; yb.setAttribute("aria-label", "Season: " + y); yw.append(yb);
    if (yearOpts.length < 2) { yw.classList.add("solo"); yb.disabled = true; }
    else { yb.setAttribute("aria-haspopup", "listbox"); yb.setAttribute("aria-expanded", "false"); yb.addEventListener("click", (ev) => { ev.stopPropagation(); ddOpenOn(yb, yearOpts, y, pickYear); }); }
    pt.append(yw, " ", el("span", "pclv", pos), " Percentiles"); main.append(pt);
    if (!qualifies(p, meta)) main.append(el("p", "note pctnote", `Under the ${pos} minimum this season, so he's placed among the qualified ${pos}s rather than counted in them.`));
    // the charts: two columns of sections on a desktop, one on a phone, each an SVG drawn at its column's real width
    const pg = el("div", "ppage pageflow"), cols = el("div", "pctcols"), n = pool(y, pos).ref.length;
    pctROs.forEach((ro) => ro.disconnect()); pctROs = [];
    BARS[pos].forEach((col, ci) => {
      const groups = [];
      for (const [name, keys] of col) {
        const rows = [];
        for (const k of keys) {
          const v = m[k]; if (v == null || !isFinite(v)) continue;   // a row with no value is skipped, as the baseball's are
          const pv = pctOf(y, pos, k, v), label = LABEL[k] || METRIC[k].h, value = fmtM(k, v), hib = !(METRIC[k] && METRIC[k].hib === 0), s = pool(y, pos).sorted[k];
          const v1 = m1 ? m1[k] : null, prev = v1 != null && isFinite(v1) ? { value: fmtM(k, v1), pct: pctOf(y - 1, pos, k, v1) } : null;
          rows.push({ k, label, value, hib, pct: pv == null ? null : Math.round(pv), gloss: METRIC[k] && METRIC[k].t, lg: s && s.length ? fmtM(k, s[Math.floor(s.length / 2)]) : null, prev, prevYear: y - 1,
                      tip: `${label}: ${value}${pv != null ? ` · ${ord(Math.round(pv))} pctl among ${n} qualified ${pos}s` : ""}${hib ? "" : " (lower is better)"}` });
        }
        if (rows.length) groups.push({ title: name, rows });
      }
      if (groups.length) cols.append(pctChart(groups, ci));
    });
    pg.append(cols); main.append(pg);
    if (SKILL_NOTE[pos]) main.append(el("p", "note", SKILL_NOTE[pos] + (m.nyoe == null && (pos === "WR" || pos === "TE") ? " Next Gen Stats carries no season row for him (under its target minimum)." : "")));
    main.append(renderBelow(p, y, pos, meta));
    main.style.minHeight = "";   // route() held the page's height through the redraw
    requestAnimationFrame(() => { bleedBar(); stickSync(); footSync(); });
  }

  // the sticky bar: the headshot at the far left, the name over the bio line, the season button at the right (the baseball's .pgbar.pgbar3)
  function playerBar(e, p, y, yearOpts, pickYear) {
    const bar = el("div", "pgbar pgbar3"), mug = el("div", "pgbmug");
    if (e.img) { const img = el("img", "mug"); img.alt = ""; img.loading = "lazy"; img.src = e.img; img.addEventListener("error", () => img.replaceWith(el("div", "mug initials"))); mug.append(img); }
    else mug.append(el("div", "mug initials"));   // no photo: the empty circle
    const txt = el("div", "pgbtxt"), nrow = el("div", "pgbnrow"), nm = el("h2", "pgbname", e.n); nm.id = "modal-title"; nrow.append(nm);
    const row1 = el("div", "pbrow1"); row1.append(bioStrip(e, p, y)); txt.append(nrow, row1);
    const fx = el("div", "pgfix"), seg = el("div", "seg phfiltseg"), yb = el("button", "segbtn small phfilt", yearOpts.length > 1 ? `${y} ▾` : String(y)); yb.type = "button"; yb.setAttribute("aria-label", "Season: " + y);
    if (yearOpts.length > 1) { yb.setAttribute("aria-haspopup", "listbox"); yb.setAttribute("aria-expanded", "false"); yb.addEventListener("click", (ev) => { ev.stopPropagation(); ddOpenOn(yb, yearOpts, y, pickYear); }); }
    else yb.disabled = true;
    seg.append(yb); fx.append(seg); bar.append(mug, txt, fx);
    return bar;
  }
  // the one-line bio under his name: position, team (a link to its backfield that season), age, height and weight, college, the draft; a phone
  // reads the codes. Each item carries its own dot and the line is pulled left by a dot's width under the column's clip, so whichever item
  // starts a line loses its dot — a bio that wraps never shows a dot at either end of a line (the baseball's way)
  function bioStrip(e, p, y) {
    const d = el("div", "pbline"), mob = isMobile();
    const add = (t) => { const w = el("span", "pbit"); w.append(el("span", "pbdot", "·"), typeof t === "string" ? el("span", null, t) : t); d.append(w); };
    add(mob ? p.pos : (POS_FULL[p.pos] || p.pos));
    const tms = p.tms && p.tms.length > 1 ? p.tms : p.tm ? [p.tm] : [];
    if (tms.length) {
      const t = el("span", "pbteam", tms.map((c) => (mob ? c : TEAM_FULL[c] || c)).join(" / ")), tm = tms[tms.length - 1];
      t.title = `${TEAM_FULL[tm] || tm}: the backfield that season`; t.setAttribute("role", "link"); t.tabIndex = 0;
      t.addEventListener("click", () => { location.hash = `#team/${tm}/${y}`; }); t.addEventListener("keydown", (ev) => { if (ev.key === "Enter") t.click(); });
      add(t);
    }
    if (p.age != null) add("Age " + Math.floor(p.age));
    if (e.ht) add(htFmt(e.ht) + (e.wt ? `, ${Math.round(e.wt)}` : ""));
    if (e.col) add(e.col);
    add(draftLine(e));
    return d;
  }
  // the bar out to both edges of the screen: negative margins as wide as the page's side gaps, the same as padding (plus a phone's 13px),
  // so its contents stay in line with the page and nothing scrolls sideways (the screen's width without the scrollbar)
  function bleedBar() {
    const host = pageHost(), bar = host && host.querySelector(".pgbar"); if (!bar) return;
    bar.style.marginLeft = bar.style.marginRight = bar.style.paddingLeft = bar.style.paddingRight = "";
    const r = bar.getBoundingClientRect(), pad = isMobile() && !XP ? 13 : 0;
    let x0 = 0, x1 = document.documentElement.clientWidth;
    if (XP) { const hr = host.getBoundingClientRect(); x0 = hr.left + host.clientLeft; x1 = x0 + host.clientWidth; }   // the popup's own box (its padding is the bar's inset there)
    const L = Math.max(0, Math.round(r.left - x0)), Rt = Math.max(0, Math.round(x1 - r.right));
    bar.style.marginLeft = -L + "px"; bar.style.marginRight = -Rt + "px"; bar.style.paddingLeft = L + pad + "px"; bar.style.paddingRight = Rt + pad + "px";
    const x = bar.querySelector(".xpopx"); if (x) x.style.right = Rt + pad + "px";   // the popup's × sits over the season button at the right
  }
  // the bar and the band read as one header: the bar's red rule shows only once the band has scrolled up under it (class stuck)
  function stickSync() {
    const host = pageHost(), bar = host && host.querySelector(".pgbar"), band = host && host.querySelector(".pagehead"); if (!bar || !band) return;
    bar.classList.toggle("stuck", band.getBoundingClientRect().bottom <= bar.getBoundingClientRect().bottom + 2);
  }
  // what a phone shows past the page's ends as it bounces (the html canvas) follows the end you're at: the band's colour at the top, where it
  // meets the header, and the page's white past the foot — the lower half of a player page sets pgfoot
  function footSync() {
    const r = document.documentElement, max = r.scrollHeight - innerHeight;
    r.classList.toggle("pgfoot", document.body.dataset.page === "player" && max > 0 && window.scrollY > max / 2);
  }
  window.addEventListener("scroll", () => requestAnimationFrame(() => { stickSync(); footSync(); }), { passive: true, capture: true });   // capture: the popup's own scroll too
  window.addEventListener("resize", () => requestAnimationFrame(bleedBar));
  if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener("loadingdone", () => requestAnimationFrame(bleedBar));   // the name's width once its face has loaded

  // the Summary at the band's foot (the baseball's .pbsum): the season shown and his career — G, the receiving and rushing counts (a QB's
  // passing line), FP/G and xFP/G as pills painted by their percentile among the season's qualified players (the career placed in the same
  // pool), FPOE/G; the columns a phone can't fit are hidden there (.pbx)
  function summaryBlock(id, p, y, pos) {
    const box = el("div", "pbsum"), QB = pos === "QB";
    const groups = QB ? [["FP/G", "xFP/G"], ["G", "Att", "Cmp%", "Pass Yds", "TD", "INT"], ["Rush Yds", "Rush TD"], ["FPOE/G"]]
                      : [["FP/G", "xFP/G"], ["G", "Tgt", "Rec", "Yds", "TD"], ["Car", "Rush Yds", "Rush TD"], ["FPOE/G"]];
    const narrow = new Set(QB ? ["Att", "Cmp%", "Rush TD"] : pos === "RB" ? ["Tgt", "Rec", "Rush TD"] : ["Tgt", "Car", "Rush TD"]);
    const keys = groups.flat(); box.style.setProperty("--n", keys.length);
    const sep = (k) => groups.some((g) => g[0] === k && g !== groups[0]);
    const head = el("div", "pbsrow pbshead"); head.append(el("span", "pbsl", "Summary"));
    for (const k of keys) { const c = el("span", "pbsh" + (narrow.has(k) ? " pbx" : "") + (sep(k) ? " sep" : ""), k); head.append(c); }
    box.append(head);
    const lineOf = (r) => {
      const g = Math.max(r.g || 0, 1), xfp = (r.xr || 0) + (r.xu || 0) + (QB ? passFP(r) : 0), fpg = (r.fp || 0) / g, xfpg = xfp / g;
      const v = { "FP/G": num(fpg), "xFP/G": num(xfpg), G: String(r.g || 0), "FPOE/G": sgn(fpg - xfpg), "Rush Yds": String(r.ruyd || 0), "Rush TD": String(r.rutd || 0) };
      if (QB) Object.assign(v, { Att: String(r.att || 0), "Cmp%": r.att ? pc(100 * (r.cmp || 0) / r.att) : "–", "Pass Yds": String(r.pyd || 0), TD: String(r.ptd || 0), INT: String(r.int_ || 0) });
      else Object.assign(v, { Tgt: String(r.tgt || 0), Rec: String(r.rec || 0), Yds: String(r.ryd || 0), TD: String(r.rtd || 0), Car: String(r.car || 0) });
      return { v, fpg, xfpg };
    };
    const rowOf = (label, L, cls) => {
      const row = el("div", "pbsrow" + (cls ? " " + cls : "")); row.append(el("span", "pbsl", label));
      for (const k of keys) {
        const c = el("span", "pbsv" + (narrow.has(k) ? " pbx" : "") + (sep(k) ? " sep" : "")), text = L ? L.v[k] : "–";
        const pv = L && (k === "FP/G" || k === "xFP/G") ? pctOf(y, pos, k === "FP/G" ? "fpg" : "xfpg", k === "FP/G" ? L.fpg : L.xfpg) : null;
        if (pv != null) { const chip = el("span", "uchip pbchip", text), h = heat(Math.round(pv)); chip.style.background = h.bg; chip.title = ord(Math.round(pv)) + " percentile"; c.append(chip); }
        else c.textContent = text;
        row.append(c);
      }
      return row;
    };
    box.append(rowOf(String(y), lineOf(p), "cur"));
    const C = (window.FB_CAREER || {})[id];
    if (C) {   // his career: every season's counts summed
      const T = {}; for (const yr in C) for (const k of ["g", "fp", "xr", "xu", "tgt", "rec", "ryd", "rtd", "car", "ruyd", "rutd", "att", "cmp", "pyd", "ptd", "int_"]) T[k] = (T[k] || 0) + (C[yr][k] || 0);
      box.append(rowOf("Career", lineOf(T)));
    } else if (window.FB_CAREER) box.append(rowOf("Career", null));
    return box;
  }
  // B-Ref's bio box in the white space between the band and the season table: the full name, position, size, college, draft, born, team
  function bioBox(e, p, y) {
    const box = el("section", "pbinfo"); box.append(el("div", "pbinfohd", "Bio"));
    const body = el("div", "pbinfobd"); box.append(body);
    const line = (k, v) => { const d = el("div", "pbil"); d.append(el("b", null, k + ":"), " " + v); body.append(d); };
    body.append(el("div", "pbil pbfull", e.n));
    line("Position", POS_FULL[p.pos] || p.pos);
    if (e.ht) line("Height / weight", `${htFmt(e.ht)}${e.wt ? `, ${Math.round(e.wt)} lb` : ""} (${Math.round(e.ht * 2.54)} cm${e.wt ? `, ${Math.round(e.wt * 0.4536)} kg` : ""})`);
    if (e.col) line("College", e.col);
    line("Draft", e.dr ? `${ord(e.dr[1])} round, #${e.dr[2]} overall, ${e.dr[0]} NFL Draft` : "Undrafted free agent");
    if (e.bd) { const bd = new Date(e.bd + "T12:00:00Z"); if (!isNaN(bd)) { const now = new Date(); let age = now.getUTCFullYear() - bd.getUTCFullYear(); if (now.getUTCMonth() < bd.getUTCMonth() || (now.getUTCMonth() === bd.getUTCMonth() && now.getUTCDate() < bd.getUTCDate())) age--;
      line("Born", `${bd.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })} (Age ${age})`); } }
    const tms = p.tms && p.tms.length > 1 ? p.tms : p.tm ? [p.tm] : [];
    if (tms.length) line("Team", tms.map((c) => TEAM_FULL[c] || c).join(" / ") + (y === CUR ? "" : ` (${y})`));
    return box;
  }

  // ---------- the percentile charts: the baseball's pctSvg, verbatim but for its inputs (23 Oct 2026) ----------
  // Savant's percentile chart, drawn the way its own code draws it (one SVG, D3's numbers). The drawing is as wide as its box and 20 in
  // from each side. Each section is a bold name on a 2px rule 34 down; a row every 23, the bar 85 in from the labels and as wide as what's
  // left after the labels (40 + 85) and the values, running from 10 (0th) to its full width (100th) over a 5-tall line; a 10-radius circle
  // with a 2.5px ring centred on the bar's end; the ticks, dashed rules and the Poor / Average / Great row are drawn but hidden by the
  // stylesheet (the warm pass's look). The colours are heat()'s — Savant's scale in Lab — the bubble a fifth darker than the fill
  const SVG_NS = "http://www.w3.org/2000/svg";
  let pctROs = [];                                   // one per chart on the page; let go of at each redraw
  // a chart isn't on the page yet when it's first drawn, so it starts at the size its column had last time: drawn at a guess and resized a
  // moment later, everything under it would shift — and near the foot of the page the browser would pull the window up to fit
  const pctLast = [];
  const bubOf = (bg) => "rgb(" + bg.match(/\d+/g).map((c) => Math.round(c * 0.9311)).join(",") + ")";   // each channel × 0.7^0.2
  function pctChart(groups, slot = 0, scale = false) {
    const host = el("div", "svchart");
    const draw = () => {
      const bw = host.getBoundingClientRect().width;
      const W = Math.max(300, Math.round(bw) || 400);   // drawn at its real size (Savant shrinks under 400)
      if (host.dataset.w === String(W) && host.firstChild) return;
      host.dataset.w = String(W); pctLast[slot] = W;
      host.replaceChildren(pctSvg(groups, W, scale));
    };
    const W0 = pctLast[slot] || (isMobile() ? 364 : 406);
    host.dataset.w = String(W0);
    host.append(pctSvg(groups, W0, scale));
    if (window.ResizeObserver) { const ro = new ResizeObserver(draw); ro.observe(host); pctROs.push(ro); }
    return host;
  }
  // tap a percentile row: what the stat is, his value and percentile, the league's middle (the baseball's tap note)
  function statPop(row, r) {
    const host = row.closest(".svchart"); if (!host) return;
    const old = host.querySelector(".statpop"), same = old && old.dataset.k === r.k; if (old) old.remove(); if (same) return;
    const d = el("div", "statpop"); d.dataset.k = r.k;
    const top = el("div", "sphd"); top.append(el("b", null, r.label), el("span", null, `${r.value}${r.pct != null ? " · " + ord(r.pct) + " percentile" : ""}`)); d.append(top);
    if (r.gloss) d.append(el("p", null, r.gloss));
    const facts = [r.lg != null ? `League middle: ${r.lg}` : "", r.hib === false ? "Lower is better" : "", r.prev ? `${r.prevYear}: ${r.prev.value}${r.prev.pct != null ? " (" + ord(Math.round(r.prev.pct)) + ")" : ""}` : ""].filter(Boolean);
    if (facts.length) d.append(el("p", "spfacts", facts.join(" · ")));
    const hr = host.getBoundingClientRect(), rr = row.getBoundingClientRect();
    d.style.top = Math.round(rr.bottom - hr.top + 4) + "px";
    host.append(d);
    const away = (ev) => { if (!d.contains(ev.target)) { d.remove(); document.removeEventListener("click", away, true); } };
    setTimeout(() => document.addEventListener("click", away, true), 0);
  }
  let lblCtx = null;
  function pctLabelW(groups) {                         // the widest row label at the chart's 12px type
    if (!lblCtx) { try { lblCtx = document.createElement("canvas").getContext("2d"); } catch (e) { lblCtx = null; } }
    if (!lblCtx) return 80;
    lblCtx.font = `12px ${getComputedStyle(document.body).fontFamily}`;
    let w = 0; for (const g of groups) for (const r of g.rows) w = Math.max(w, lblCtx.measureText(r.label).width);
    return Math.min(120, Math.ceil(w));
  }
  function pctSvg(groups, W, scale = true) {
    const mk = (t, at, txt) => { const n = document.createElementNS(SVG_NS, t); for (const k in at) n.setAttribute(k, at[k]); if (txt != null) n.textContent = txt; return n; };
    const r6 = W - 40, VW = W < 420 ? 41 : 45, bar = r6 - 40 - 85 - VW;
    // the rows' block (the label column through the value) sits 40 in from each side of the section rule; a label wider than its 80 column
    // keeps the room it needs. Section names and rules stay put
    const IND = Math.max(20, pctLabelW(groups) - 80 + 4);
    const x = (p) => 10 + (bar - 10) * Math.max(0, Math.min(100, p)) / 100;
    const top = -2;                                            // the first heading starts right under what's above it
    const root = mk("g", { transform: `translate(20,${top})` });
    let y = 0;
    groups.forEach((g, gi) => {
      const first = gi === 0 && scale, G = mk("g", { class: "svgrp", transform: `translate(0,${y})` });
      G.append(mk("rect", { class: "svsecrule", x: 0, y: 34, width: r6, height: 2 }));
      G.append(mk("text", { class: "svsecname", x: 0, y: 28 }, g.title));
      if (first) {                                               // Poor / Average / Great, each arrow over its tick (the page passes scale = false)
        const Sg = mk("g", { transform: `translate(${IND + 85},54)` });
        const tri = (cx) => `M${cx},2L${cx - 3},8L${cx + 3},8Z`;
        const c0 = heat(0).bg, c50 = heat(50).bg, c100 = heat(100).bg;
        Sg.append(mk("path", { d: tri(12), fill: c0 }), mk("path", { d: tri(x(50)), fill: c50 }), mk("path", { d: tri(bar - 12), fill: c100 }));
        Sg.append(mk("text", { class: "svscale", fill: c0 }, "Poor"), mk("text", { class: "svscale", x: x(50), "text-anchor": "middle", fill: c50 }, "Average"), mk("text", { class: "svscale", x: x(100), "text-anchor": "end", fill: c100 }, "Great"));
        G.append(Sg);
      }
      const R = mk("g", { transform: `translate(${IND},${44 + (first ? 20 : 0)})` });
      let ry = 0, i = 0;
      g.rows.forEach((r) => {
        if (r.gap) { ry += 12; return; }   // a line break between rows
        const Mg = mk("g", { class: "svrow", transform: `translate(0,${ry})` }); ry += 23; const first_ = i === 0; i++;
        Mg.append(mk("title", {}, r.tip));
        const on = r.pct != null, s = on ? heat(r.pct) : null;
        const B = mk("g", { transform: "translate(85,0)", opacity: on ? 1 : 0.35 });
        B.append(mk("rect", { class: "svline", width: bar, height: 5, y: 7.5 }));
        if (on) B.append(mk("rect", { width: x(r.pct), height: 20, y: 0, fill: s.bg }));
        for (const tx of [x(50) - 1, 11, bar - 13]) B.append(mk("rect", { class: "svtick", width: 2, height: 20, x: tx }));
        Mg.append(B);
        Mg.append(mk("text", { class: "svlbl" + (r.sub ? " svsub" : ""), x: 80, y: 10, "text-anchor": "end" }, r.label));
        Mg.append(mk("text", { class: "svlbl svvl", x: 85 + bar + VW, y: 10, "text-anchor": "end" }, r.value));   // svvl: the value, so a look can weight it apart from the label
        Mg.addEventListener("click", (ev) => { ev.stopPropagation(); statPop(Mg, r); });
        if (!first_) Mg.append(mk("path", { class: "svdash", d: "M80,-1.5L0,-1.5" }), mk("path", { class: "svdash", d: `M${85 + bar + 5},-1.5L${85 + bar + VW},-1.5` }));
        if (on) {
          const Cg = mk("g", { transform: `translate(${85 + x(r.pct)},10)` });
          Cg.append(mk("circle", { class: "svbulb", r: 10, fill: bubOf(s.bg) }));
          Cg.append(mk("text", { class: "svnum" + (r.pct >= 100 ? " c3" : ""), y: 1 }, r.pct));   // Savant's bubble
          Mg.append(Cg);
        }
        R.append(Mg);
      });
      G.append(R);
      root.append(G);
      y += g.rows.reduce((a, r) => a + (r.gap ? 12 : 23), 0) + 34 + 10 + (first ? 20 : 0);
    });
    const H = y + 20 + top - 10;
    const svg = mk("svg", { class: "svpct", viewBox: `0 0 ${W} ${H}`, width: "100%", role: "img", "aria-label": "Percentile rankings" });
    svg.append(root);
    return svg;
  }

  // ---------- the strip under the bars and the open tab's box (the baseball's .pbelow2) ----------
  // the tabs are band-filled buttons 14px apart, the picked one filled the deep ink (white in dark mode); tapping the picked one closes it;
  // the open tab's content sits in the white 860px box under the strip. The strip keeps its place on the screen across the redraw (anchorTabs)
  let tabY0 = null;
  function renderBelow(p, y, pos, meta) {
    const sec = el("section", "pbelow2"), bar = el("div", "btabs"); bar.setAttribute("role", "tablist");
    const TABS = [["build", "xFP build-up"], ["log", "Game log"]]; if (pos === "RB" && p.tm) TABS.push(["bf", "Backfield"]);
    const pick = TABS.some((t) => t[0] === S.ptab) ? S.ptab : null;   // the strip opens closed (the baseball's); a tab stays picked across pages until it's tapped again
    for (const [k, lab] of TABS) {
      const b = el("button", "btab" + (k === pick ? " on" : ""), lab); b.type = "button"; b.setAttribute("role", "tab"); b.setAttribute("aria-selected", String(k === pick));
      b.addEventListener("click", () => { if (k === "bf") { location.hash = `#team/${p.tm}/${y}`; return; } tabY0 = bar.getBoundingClientRect().top; S.ptab = k === pick ? "none" : k; save(); repaint(); });
      bar.append(b);
    }
    sec.append(bar);
    if (pick) { const body = el("div", "btabbody"); if (pick === "log") gameLog(body, p, meta); else buildUp(body, p, y, pos); sec.append(body); }
    requestAnimationFrame(() => {
      // a phone's strip slides sideways with a fade at its right edge unless every tab fits, when it is centred like a desktop's
      const fits = [...bar.children].reduce((w, b) => w + b.offsetWidth, 0) + 14 * (bar.children.length - 1) + 24 <= bar.clientWidth;
      bar.classList.toggle("fits", fits); const on = bar.querySelector(".btab.on"); if (!fits && on) bar.scrollLeft = Math.max(0, on.offsetLeft - 12);
      if (tabY0 == null) return;
      const d = bar.getBoundingClientRect().top - tabY0; tabY0 = null; if (Math.abs(d) < 1) return;
      const sc = XP ? $("#xboard") : null;   // the scroller the strip lives in: the popup, else the page
      const max = sc ? sc.scrollHeight - sc.clientHeight : document.documentElement.scrollHeight - innerHeight, want = (sc ? sc.scrollTop : window.scrollY) + d;
      if (pick && want > max) sec.style.minHeight = Math.ceil(sec.offsetHeight + want - max) + "px";   // room under the strip so it holds still; closing a tab keeps none
      const v = Math.max(0, pick ? want : Math.min(want, max)); if (sc) sc.scrollTop = v; else window.scrollTo(0, v);
    });
    return sec;
  }

  // a card in the box (the baseball's .brbox): the name in the title type with a grey subline over a hairline, the table under it
  const card = (name, sub, cls) => { const c = el("div", "brbox" + (cls ? " " + cls : "")), hd = el("div", "rollhd"); hd.append(el("span", "rollname", name)); if (sub) hd.append(el("span", "rollsub", sub)); c.append(hd); return c; };
  function buildUp(host, p, y, pos) {
    const P = pool(y, pos), L = P.L, ref = P.ref, g = Math.max(p.g, 1), m = M(p), G = (q) => Math.max(q.g || 0, 1);
    const rk = (f) => ranker(ref.map(f))(f(p));   // his place among the qualifiers on a step's own number (His is coloured by it)
    const rows = []; let run;
    const step = (lab, his, lg, next, t, f) => { rows.push({ lab, his, lg, d: next - run, run: next, t, pct: f ? rk(f) : null }); run = next; };
    if (pos === "WR" || pos === "TE") {
      const Lr = L.rts / L.g, Lt = L.tgt / L.rts, Lx = L.xr / L.tgt, Lu = L.xu / L.g, r = p.rts / g, t = p.rts ? p.tgt / p.rts : 0, x = p.tgt ? p.xr / p.tgt : 0, u = p.xu / g;
      run = Lr * Lt * Lx + Lu; rows.push({ lab: `League ${pos}`, his: "", lg: "", d: null, run });
      step("Routes / game", num(r), num(Lr), r * Lt * Lx + Lu, "How often he's out running routes", (q) => (q.rts || 0) / G(q));
      step("Targets / route", pc(100 * t), pc(100 * Lt), r * t * Lx + Lu, "How often he gets the ball thrown his way when he's out there", (q) => (q.rts ? (q.tgt || 0) / q.rts : null));
      step("xFP / target", num(x, 2), num(Lx, 2), r * t * x + Lu, "What his targets are worth: deep, end-zone and red-zone looks price higher", (q) => (q.tgt ? (q.xr || 0) / q.tgt : null));
      step("Rushing xFP / game", num(u, 2), num(Lu, 2), r * t * x + u, "Carries, priced the same way", (q) => (q.xu || 0) / G(q));
    } else if (pos === "RB") {
      const Lc = L.car / L.g, Lxc = L.xu / L.car, Lt = L.tgt / L.g, Lx = L.xr / L.tgt, c = p.car / g, xc = p.car ? p.xu / p.car : 0, t = p.tgt / g, x = p.tgt ? p.xr / p.tgt : 0;
      run = Lc * Lxc + Lt * Lx; rows.push({ lab: "League RB", his: "", lg: "", d: null, run });
      step("Carries / game", num(c), num(Lc), c * Lxc + Lt * Lx, "His share of the work on the ground", (q) => (q.car || 0) / G(q));
      step("xFP / carry", num(xc, 2), num(Lxc, 2), c * xc + Lt * Lx, "Where his carries come: goal-line work prices highest", (q) => (q.car ? (q.xu || 0) / q.car : null));
      step("Targets / game", num(t), num(Lt), c * xc + t * Lx, "His role in the passing game", (q) => (q.tgt || 0) / G(q));
      step("xFP / target", num(x, 2), num(Lx, 2), c * xc + t * x, "What his targets are worth", (q) => (q.tgt ? (q.xr || 0) / q.tgt : null));
    } else {
      const Lp = L.pfp / L.g, Lc = L.car / L.g, Lxc = L.xu / L.car, pf = passFP(p) / g, c = p.car / g, xc = p.car ? p.xu / p.car : 0;
      run = Lp + Lc * Lxc; rows.push({ lab: "League QB", his: "", lg: "", d: null, run });
      step("Passing points / game", num(pf), num(Lp), pf + Lc * Lxc, "Passing yards, touchdowns and interceptions as scored", (q) => passFP(q) / G(q));
      step("Carries / game", num(c), num(Lc), pf + c * Lxc, "Designed runs and scrambles", (q) => (q.car || 0) / G(q));
      step("xFP / carry", num(xc, 2), num(Lxc, 2), pf + c * xc, "Where his carries come", (q) => (q.car ? (q.xu || 0) / q.car : null));
    }
    const xfpg = run; rows[rows.length - 1].mark = true;
    const tdoOf = (q) => ((q.rtd || 0) + (q.rutd || 0)) - ((q.xtr || 0) + (q.xtu || 0)), playOf = (q) => ((q.frt || 0) + (q.fru || 0) - (q.xr || 0) - (q.xu || 0) - 6 * tdoOf(q)) / G(q);
    const tdo = tdoOf(p), tdPts = 6 * tdo / g, playPts = playOf(p);
    step("Touchdowns over expected", sgn(tdo), "0.0", run + tdPts, `${(p.rtd || 0) + (p.rutd || 0)} touchdowns against ${num((p.xtr || 0) + (p.xtu || 0))} expected: the least repeatable part`, (q) => tdoOf(q) / G(q));
    step("Catches and yards over expected", sgn(playPts), "0.0", run + playPts, "Catching more than expected and gaining more after the catch or per carry, in points a game: partly skill", playOf);
    step("Other", "", "", m.fpg, "Fumbles lost, two-point conversions, and for non-QBs any passing");
    const split = el("div", "stack"), left = card("Fantasy points build-up", "his usage priced play by play, then what he did with it", "kcard");
    const t = table([{ cols: [{ h: "Step", cls: "l fz" }], end: 1 }, { cols: [{ h: "His" }, { h: "Lg" }], end: 1 }, { cols: [{ h: "± FP/G" }, { h: "FP/G" }] }], { front: false });
    for (const r of rows) {
      const lab = td(r.lab, "l fz"); if (r.t) lab.title = r.t;
      const his = td(r.his); if (r.pct != null) paint(his, r.pct);                       // His: his place among the qualifiers on that number
      const dc = td(r.d != null ? sgn(r.d) : ""); if (r.d != null) paint(dc, 50 + 14 * r.d);   // ±: red lifts his points, blue costs them
      const rc = td(num(r.run), r.mark ? "kexp" : ""); if (r.mark) { rc.dataset.exp = "Expected FP/G"; rc.title = "Expected FP / game: what his usage says he should score"; }
      t.addRow([lab, his, td(r.lg), dc, rc]);
    }
    t.addRow([td("FP / game", "l fz"), td(""), td(""), td(sgn(m.fpg - rows[0].run)), td(num(m.fpg))], "tot first");
    t.box.classList.add("kbox");   // the word hangs past the box; the card slides when the two don't fit
    left.append(t.box, el("p", "note", `Each step swaps the qualified ${pos}s' average for his; His is coloured by where he stands among them. The yellow cell is his expected points per game (${num(xfpg)}): his usage priced play by play. Below it, touchdown luck and the rest of the gap to what he scored.`));
    // where the gap comes from
    const right = card("Where the gap comes from", "each piece's part of FP − xFP");
    const t2 = table([{ cols: [{ h: "Piece", cls: "l fz" }], end: 1 }, { cols: [{ h: "Exp" }, { h: "Act" }], end: 1 }, { cols: [{ h: "± FP/G" }, { h: "Share" }] }], { front: false });
    const parts = [];
    if (p.tgt) parts.push(["Receiving TD", num(p.xtr), String(p.rtd), 6 * ((p.rtd || 0) - (p.xtr || 0)) / g]);
    if (p.car) parts.push(["Rushing TD", num(p.xtu), String(p.rutd), 6 * ((p.rutd || 0) - (p.xtu || 0)) / g]);
    if (p.tgt) parts.push(["Catches + rec. yards", num((p.xr - 6 * (p.xtr || 0)) / g, 1) + "/G", num((p.frt - 6 * (p.rtd || 0)) / g, 1) + "/G", ((p.frt - 6 * (p.rtd || 0)) - (p.xr - 6 * (p.xtr || 0))) / g]);
    if (p.car) parts.push(["Rushing yards", num((p.xu - 6 * (p.xtu || 0)) / g, 1) + "/G", num((p.fru - 6 * (p.rutd || 0)) / g, 1) + "/G", ((p.fru - 6 * (p.rutd || 0)) - (p.xu - 6 * (p.xtu || 0))) / g]);
    const other = m.fpg - (p.frt + p.fru) / g - (pos === "QB" ? passFP(p) / g : 0); if (Math.abs(other) >= 0.05) parts.push(["Fumbles, 2-pt, other", "", "", other]);
    const tot = parts.reduce((s, x) => s + Math.abs(x[3]), 0);
    for (const [lab, ex, ac, d] of parts.sort((a, b) => Math.abs(b[3]) - Math.abs(a[3]))) { const dc = paint(td(sgn(d)), 50 + 14 * d); t2.addRow([td(lab, "l fz"), td(ex), td(ac), dc, td(tot >= 0.1 ? Math.round(100 * Math.abs(d) / tot) + "%" : "–")]); }
    t2.addRow([td("FP / game", "l fz"), td(num(m.xfpg)), td(num(m.fpg)), td(sgn(m.fpoeg)), td(tot >= 0.1 ? "100%" : "")], "tot first");
    right.append(t2.box, el("p", "note", "Each piece's part of the gap between his expected and actual points; the shares add to 100%. Touchdown luck is the part least likely to carry into next season."));
    split.append(left, right); host.append(split);
  }

  function gameLog(host, p, meta) {
    const c = card("Game log", "every week, xFP coloured within his own season"); host.append(c);
    const F = meta.wfields, ix = (k) => F.indexOf(k);
    const t = table([{ cols: [{ h: "Wk", cls: "fz" }], end: 1 }, { cols: [{ h: "Opp" }, { h: "Snap%" }, { h: "Rts" }], end: 1 }, { name: "Receiving", end: 1, cols: [{ h: "Tgt" }, { h: "Rec" }, { h: "Yds" }, { h: "TD" }] },
                     { name: "Rushing", end: 1, cols: [{ h: "Car" }, { h: "Yds" }, { h: "TD" }] }, { name: "Fantasy", end: 1, cols: [{ h: "xFP" }, { h: "FP" }, { h: "Diff" }] }], { front: false });
    const xs = p.w.map((r) => r[ix("xfp")]), lo = Math.min(...xs), hi = Math.max(...xs);
    for (const r of p.w) {
      const x = r[ix("xfp")], f = r[ix("fp")], xc = td(num(x)); if (hi > lo) paint(xc, 100 * (x - lo) / (hi - lo));
      const dc = td(sgn(f - x)); dc.style.color = f - x > 0.5 ? "var(--red)" : f - x < -0.5 ? "#3661ad" : "";   /* --red: the old --stripe token is the page ground now */
      t.addRow([td(String(r[ix("wk")]), "fz"), td((r[ix("tm")] && p.tms && p.tms.length > 1 ? r[ix("tm")] + " v " : "") + (r[ix("opp")] || "")), td(r[ix("snp")] == null ? "–" : r[ix("snp")] + "%"), td(num(r[ix("rts")], 0)),
                td(String(r[ix("tgt")])), td(String(r[ix("rec")])), td(String(r[ix("ryd")])), td(String(r[ix("rtd")])), td(String(r[ix("car")])), td(String(r[ix("ruyd")])), td(String(r[ix("rutd")])), xc, td(num(f)), dc]);
    }
    const sum = (k) => p.w.reduce((s, r) => s + (r[ix(k)] || 0), 0);
    t.addRow([td("Season", "l fz"), td(""), td(p.snpct == null ? "" : Math.round(p.snpct) + "%"), td(String(Math.round(sum("rts")))), td(String(sum("tgt"))), td(String(sum("rec"))), td(String(sum("ryd"))), td(String(sum("rtd"))),
              td(String(sum("car"))), td(String(sum("ruyd"))), td(String(sum("rutd"))), td(num(sum("xfp"))), td(num(sum("fp"))), td(sgn(sum("fp") - sum("xfp")))], "tot first");
    c.append(t.box, el("p", "note", "xFP is coloured within his own season, darkest red his biggest-opportunity game. Passing stats aren't in the weekly rows yet; a QB's FP includes them."));
  }

  function staffOf(y, tm) { const r = (TEAMS[y] || []).find((x) => x.tm === tm); return r || {}; }
  // the season-by-season table in the baseball's season block (23 Oct 2026): a view switch over it (Standard · Usage · Efficiency · Fantasy —
  // a desktop's row of buttons, a phone's one "Standard ▾" dropdown), the title, the table in the B-Ref dress with Season and Tm frozen (Age
  // slides under them and fades, as B-Ref's does), the N Yrs totals on the band, the note under it. Standard is the whole table as it was
  // (the coaches, the counts, the fantasy line); the other views are what career.js carries, per game and per chance
  const SB_VIEWS = [["std", "Standard"], ["use", "Usage"], ["eff", "Efficiency"], ["fan", "Fantasy"]];
  function seasonBlock(id, cy, pos) {
    const sec = el("section", "sblock"), C = (window.FB_CAREER || {})[id] || {}, ys = Object.keys(C).map(Number).sort((a, b) => a - b);
    if (!ys.length) { sec.append(el("p", "note", window.FB_CAREER ? "No season lines for him yet." : "Couldn't load his seasons. Reload to try again.")); return sec; }
    const QB = pos === "QB", recv = !QB, mob = isMobile();
    const view = SB_VIEWS.some(([k]) => k === S.sbview) ? S.sbview : "std", vlab = SB_VIEWS.find(([k]) => k === view)[1];
    const setView = (k) => { S.sbview = k; save(); sec.replaceWith(seasonBlock(id, cy, pos)); };   // redrawn in place, so the page keeps its scroll
    if (mob) { const dd = el("div", "sbviews sbviewsdd"), b = el("button", "btn btn-quiet tbtn sbviewdd", vlab + " ▾"); b.type = "button"; b.setAttribute("aria-haspopup", "listbox"); b.setAttribute("aria-expanded", "false");
      b.addEventListener("click", (ev) => { ev.stopPropagation(); ddOpenOn(b, SB_VIEWS, view, setView); }); dd.append(b); sec.append(dd); }
    else { const vs = el("div", "sbviews"); for (const [k, lab] of SB_VIEWS) { const b = el("button", "sbview" + (k === view ? " on" : ""), lab); b.type = "button"; b.addEventListener("click", () => { if (k !== view) setView(k); }); vs.append(b); } sec.append(vs); }
    const hd = el("div", "sbhead"); hd.append(el("h3", "sbtitle", "Season by season")); sec.append(hd);
    // a column is a header and a cell function of the line (a season's, or the summed totals with _tot set); the totals' cells read the sums
    const S0 = (v) => String(Math.round(v || 0)), P = (a, b, d = 1) => (b ? pc(100 * (a || 0) / b, d) : "–"), R = (a, b, d = 1) => (b ? num((a || 0) / b, d) : "–"), G1 = (r) => Math.max(r.g || 0, 1);
    const xfpOf = (r) => (r.xr || 0) + (r.xu || 0) + (QB ? passFP(r) : 0), rkHeat = (rk) => Math.min(99, Math.max(1, 100 - 100 * ((rk || 60) - 1) / 60));
    const heatRk = (txt, rk, r) => { const c = td(txt); if (!r._tot) paint(c, rkHeat(rk)); return c; };
    const wo = (r) => (r.car || 0) + WO_K * (r.tgt || 0), tmwo = (r) => (r.tmc || 0) + WO_K * (r.tmt || 0), opp = (r) => (r.car || 0) + (r.tgt || 0);
    const base = { end: 1, cols: [{ h: "Season", cls: "fz", f: (r) => (r._tot ? `${ys.length} Yrs` : String(r.y)) }, { h: "Age", cls: "age", f: (r) => (r._tot || r.age == null ? "" : String(Math.floor(r.age))) },
                               { h: "Tm", cls: "fz2 c", f: (r) => (r._tot ? "" : r.tms && r.tms.length > 1 ? r.tms.join("/") : r.tm || "") }] };
    const G = { end: 1, cols: [{ h: "G", f: (r) => S0(r.g) }] };
    const fant = { name: "Fantasy", end: 1, cols: [...(recv ? [{ h: "WO%", t: METRIC.wos.t, f: (r) => P(wo(r), tmwo(r)) }] : []),
      { h: "xFP/G", f: (r) => heatRk(num(xfpOf(r) / G1(r)), r.xrk, r) }, { h: "FP/G", f: (r) => heatRk(num((r.fp || 0) / G1(r)), r.rk, r) }, { h: "FPOE/G", f: (r) => sgn(((r.fp || 0) - xfpOf(r)) / G1(r)) }, { h: "Rank", f: (r) => (r._tot || !r.rk ? (r._tot ? "" : "–") : pos + r.rk) }] };
    let groups;
    if (view === "std") {
      base.cols.push({ h: "Head coach", cls: "l", f: (r) => (r._tot ? "" : coachCell(staffOf(r.y, r.tm).hc)) }, { h: "Off. coordinator", cls: "l", f: (r) => { if (r._tot) return ""; const st = staffOf(r.y, r.tm); return coachCell(st.oc || (st.pc ? st.pc + " (HC)" : null)); } });
      groups = [base, G, ...(QB ? [{ name: "Passing", end: 1, cols: [{ h: "Cmp", f: (r) => S0(r.cmp) }, { h: "Att", f: (r) => S0(r.att) }, { h: "Pass Yds", f: (r) => S0(r.pyd) }, { h: "Pass TD", f: (r) => S0(r.ptd) }, { h: "INT", f: (r) => S0(r.int_) }, { h: "EPA/db", f: (r) => (r.db ? sgn(r.epa / r.db, 2) : "–") }] }] : []),
        { name: "Receiving", end: 1, cols: [{ h: "Tgt", f: (r) => S0(r.tgt) }, { h: "Rec", f: (r) => S0(r.rec) }, { h: "Rec Yds", f: (r) => S0(r.ryd) }, { h: "Rec TD", f: (r) => S0(r.rtd) }, { h: "Tgt%", f: (r) => P(r.tgt, r.tmt) }] },
        { name: "Rushing", end: 1, cols: [{ h: "Car", f: (r) => S0(r.car) }, { h: "Rush Yds", f: (r) => S0(r.ruyd) }, { h: "Rush TD", f: (r) => S0(r.rutd) }, { h: "Car%", f: (r) => P(r.car, r.tmc) }] }, fant];
    } else if (view === "use") {
      groups = QB ? [base, G, { name: "Passing", end: 1, cols: [{ h: "Att", f: (r) => S0(r.att) }, { h: "Att/G", f: (r) => R(r.att, G1(r)) }, { h: "Dropbacks", f: (r) => S0(r.db) }, { h: "Db/G", f: (r) => R(r.db, G1(r)) }] },
                         { name: "Rushing", end: 1, cols: [{ h: "Car", f: (r) => S0(r.car) }, { h: "Car/G", f: (r) => R(r.car, G1(r)) }] }]
                  : [base, G, { name: "Snaps and routes", end: 1, cols: [{ h: "Snap%", f: (r) => (r.snpct == null ? "–" : pc(r.snpct)) }, { h: "Rts", f: (r) => S0(r.rts) }, { h: "Route%", f: (r) => P(r.rts, r.tmdb) }] },
                         { name: "Targets", end: 1, cols: [{ h: "Tgt", f: (r) => S0(r.tgt) }, { h: "Tgt/G", f: (r) => R(r.tgt, G1(r)) }, { h: "Tgt%", f: (r) => P(r.tgt, r.tmt) }, { h: "aDOT", f: (r) => R(r.ay, r.tgt) }] },
                         { name: "Carries", end: 1, cols: [{ h: "Car", f: (r) => S0(r.car) }, { h: "Car/G", f: (r) => R(r.car, G1(r)) }, { h: "Car%", f: (r) => P(r.car, r.tmc) }] },
                         { name: "Opportunity", end: 1, cols: [{ h: "Opp/G", f: (r) => R(opp(r), G1(r)) }, { h: "WO/G", t: METRIC.wog.t, f: (r) => R(wo(r), G1(r)) }, { h: "WO%", t: METRIC.wos.t, f: (r) => P(wo(r), tmwo(r)) }] }];
    } else if (view === "eff") {
      groups = QB ? [base, G, { name: "Passing", end: 1, cols: [{ h: "Cmp%", f: (r) => P(r.cmp, r.att) }, { h: "Y/A", f: (r) => R(r.pyd, r.att) }, { h: "TD%", f: (r) => P(r.ptd, r.att) }, { h: "INT%", f: (r) => P(r.int_, r.att) }, { h: "EPA/db", f: (r) => (r.db ? sgn(r.epa / r.db, 2) : "–") }, { h: "CPOE", f: (r) => (r.db && r.cpoe != null ? sgn(r.cpoe) : "–") }] },
                         { name: "Rushing", end: 1, cols: [{ h: "YPC", f: (r) => R(r.ruyd, r.car) }] }]
                  : [base, G, { name: "Receiving", end: 1, cols: [{ h: "TPRR", f: (r) => P(r.tgt, r.rts) }, { h: "YPRR", f: (r) => R(r.ryd, r.rts, 2) }, { h: "Y/R", f: (r) => R(r.ryd, r.rec) }, { h: "Catch%", f: (r) => P(r.rec, r.tgt) }, { h: "CROE", t: METRIC.croe.t, f: (r) => (r.xcn ? sgn(100 * ((r.cc || 0) - (r.xc || 0)) / r.xcn) : "–") }] },
                         { name: "Rushing", end: 1, cols: [{ h: "YPC", f: (r) => R(r.ruyd, r.car) }] },
                         { name: "Per opportunity", end: 1, cols: [{ h: "FP/Opp", f: (r) => R(r.fp, opp(r), 2) }, { h: "xFP/Opp", f: (r) => R(xfpOf(r), opp(r), 2) }, { h: "FPOE/Opp", f: (r) => (opp(r) ? sgn(((r.fp || 0) - xfpOf(r)) / opp(r), 2) : "–") }] }];
    } else {
      groups = [base, G, { name: "Points", end: 1, cols: [{ h: "FP", f: (r) => num(r.fp) }, { h: "FP/G", f: (r) => heatRk(num((r.fp || 0) / G1(r)), r.rk, r) }, { h: "xFP", f: (r) => num(xfpOf(r)) }, { h: "xFP/G", f: (r) => heatRk(num(xfpOf(r) / G1(r)), r.xrk, r) }, { h: "FPOE/G", f: (r) => sgn(((r.fp || 0) - xfpOf(r)) / G1(r)) }] },
        { name: "Touchdowns", end: 1, cols: [...(QB ? [{ h: "Pass TD", f: (r) => S0(r.ptd) }] : []), { h: QB ? "Rush TD" : "TD", f: (r) => S0((r.rtd || 0) + (r.rutd || 0)) }, { h: "xTD", f: (r) => num((r.xtr || 0) + (r.xtu || 0)) }, { h: "TDOE", f: (r) => sgn((r.rtd || 0) + (r.rutd || 0) - (r.xtr || 0) - (r.xtu || 0)) }] },
        { name: "Rank", end: 1, cols: [{ h: "Rank", f: (r) => (r._tot || !r.rk ? (r._tot ? "" : "–") : pos + r.rk) }, { h: "xRank", f: (r) => (r._tot || !r.xrk ? (r._tot ? "" : "–") : pos + r.xrk) }] }];
    }
    const t = table(groups.map((g) => ({ end: g.end, cols: g.cols.map((c) => ({ h: c.h, t: c.t || (g.name ? `${g.name}: ${c.h}` : null), cls: c.cls })) })), { front: false });   // no group-name row, as B-Ref's own table (the groups mark their ends with the red rules; a column's tooltip names its group)
    const cellOf = (c, r) => { const v = c.f(r); if (v instanceof Node) { if (c.cls) v.className += " " + c.cls; return v; } return td(v, c.cls); };
    const T = { _tot: true }; for (const k of ["g", "rts", "tgt", "rec", "ryd", "rtd", "ay", "car", "ruyd", "rutd", "tmt", "tmc", "tmdb", "fp", "xr", "xu", "xtr", "xtu", "att", "cmp", "pyd", "ptd", "int_", "epa", "db", "xc", "xcn", "cc"]) T[k] = 0;
    let snpG = 0, snpS = 0, cpoeS = 0, cpoeD = 0;
    for (const y of ys) {
      const r = Object.assign({ y }, C[y]);
      for (const k in T) if (k !== "_tot") T[k] += r[k] || 0;
      if (r.snpct != null && r.g) { snpS += r.snpct * r.g; snpG += r.g; } if (r.cpoe != null && r.db) { cpoeS += r.cpoe * r.db; cpoeD += r.db; }
      const tr = t.addRow(groups.flatMap((g) => g.cols.map((c) => cellOf(c, r))), y === cy ? "cur" : ""); tr.querySelector("td").title = y === cy ? "The season shown above" : "";
    }
    T.snpct = snpG ? snpS / snpG : null; T.cpoe = cpoeD ? cpoeS / cpoeD : null;
    t.addRow(groups.flatMap((g) => g.cols.map((c) => cellOf(c, T))), "tot first");
    const box = t.box; box.classList.add("sbscroll"); sec.append(box); freeze(t);
    // Age slides under the frozen Season and fades as it goes (B-Ref's), so Tm ends up against Season
    box.addEventListener("scroll", () => { const ag = t.querySelector("thead th.age"), w = ag ? ag.offsetWidth : 0; t.style.setProperty("--sbage", w ? Math.max(0, 1 - box.scrollLeft / w).toFixed(2) : "1"); }, { passive: true });
    sec.append(el("p", "note", "Coaches are the team's head coach and offensive coordinator that season (a traded player shows his main team's). FP/G and xFP/G are coloured by his rank at the position that season, by points scored and by expected points."));
    return sec;
  }

  // ---------- Backfields ----------
  const share = (a, b) => (b ? 100 * a / b : null);
  // a coach cell: the name (two for a shared job) linked to his page
  const coachCell = (n) => { const c = td(null, "l"); if (n) n.split(" / ").forEach((nm, i) => { if (i) c.append(" / "); c.append(link(nm, "#coach/" + encodeURIComponent(nm))); }); else c.textContent = "–"; return c; };
  const BF_COLS = { rb1car: "Car%", rb1opp: "Opp%", rb1snp: "Snap%", rb1gl: "GL%", rb2car: "RB2 Car%", eff: "Backs used", rbtgt: "RB Tgt%", rb1fp: "RB1 FP/Opp", rb2fp: "RB2 FP/Opp" };
  async function backfields(main) {
    const y = SEASONS.includes(+S.bfSeason) ? +S.bfSeason : CUR, rows = TEAMS[y] || [];
    main.textContent = "";
    const sortK = BF_COLS[S.bfSort] ? S.bfSort : "rb1car", dir = S.bfDir || -1;
    const val = (r, k) => k === "rbtgt" ? share(r.rbtgt, r.tmtgt) : k === "rb1fp" ? fpo(r.rbs[0]) : k === "rb2fp" ? (r.rbs[1] ? fpo(r.rbs[1]) : null) : k === "rb1snp" ? r.rbs[0].snp : r[k];
    const sorted = [...rows].sort((a, b) => { const va = val(a, sortK), vb = val(b, sortK); if (va == null) return 1; if (vb == null) return -1; return dir * (va - vb); });
    const sb = (k) => () => { if (S.bfSort === k) S.bfDir = -(S.bfDir || -1); else { S.bfSort = k; S.bfDir = -1; } save(); route(); };
    // one control, so a season pill in the Filters button's place
    const board = listFrame(main, { page: "backfields", title: "Backfields", sub: `by ${BF_COLS[sortK]}`,
      ctl: [seasonPill(y, (v) => { S.bfSeason = v; save(); route(); }), count(`${rows.length} teams · ${y}`, `${rows.length} teams`)],
      about: "How each team split its running back work. Shares count only the games the lead back played, so an injury doesn't make a bell cow look like a committee. Car% is coloured red for the most bell-cow backfields, blue for the most shared; Backs used the same way round. An RB2 in red outscored his lead back per opportunity, the case where more work tends to follow. Tap a column name to sort, a team for its week-by-week split." });
    const t = table([{ cols: [{ h: "Tm", cls: "fz" }, { h: "Head coach", cls: "l" }, { h: "Off. coordinator", cls: "l" }], end: 1 },
                     { name: "Lead back, in his games", end: 1, cols: [{ h: "RB1", cls: "l" }, { h: "G" }, { h: "Car%", onSort: sb("rb1car"), lit: sortK === "rb1car", t: "His share of the team's RB carries in the games he played" }, { h: "Opp%", onSort: sb("rb1opp"), lit: sortK === "rb1opp", t: "Share of RB carries + targets" }, { h: "Snap%", onSort: sb("rb1snp"), lit: sortK === "rb1snp" }, { h: "GL%", onSort: sb("rb1gl"), lit: sortK === "rb1gl", t: "Share of RB carries inside the 5" }] },
                     { name: "The rest", end: 1, cols: [{ h: "RB2", cls: "l" }, { h: "Car%", onSort: sb("rb2car"), lit: sortK === "rb2car" }, { h: "Backs used", onSort: sb("eff"), lit: sortK === "eff", t: "Effective number of backs: 1 = one back took every carry, 2 = an even split" }] },
                     { name: "Passing game", end: 1, cols: [{ h: "RB Tgt%", onSort: sb("rbtgt"), lit: sortK === "rbtgt", t: "Share of all team targets that went to running backs" }] },
                     { name: "PPR pts per carry + target", end: 1, cols: [{ h: "RB1", onSort: sb("rb1fp"), lit: sortK === "rb1fp" }, { h: "RB2", onSort: sb("rb2fp"), lit: sortK === "rb2fp" }] }]);
    const box = boxOf(t, ["bf", y, sortK, dir].join(":"));
    const carR = ranker(rows.map((r) => r.rb1car)), effR = ranker(rows.map((x) => x.eff)), sortR = ranker(rows.map((r) => val(r, sortK)));   // the sorted column is coloured among the 32 too
    const KEYS = ["rb1car", "rb1opp", "rb1snp", "rb1gl", "rb2car", "eff", "rbtgt", "rb1fp", "rb2fp"];
    for (const r of sorted) {
      const b1 = r.rbs[0], b2 = r.rbs[1];
      const f1 = fpo(b1), f2 = b2 ? fpo(b2) : null, f2c = td(num(f2, 2)); if (f2 != null && f1 != null && f2 > f1 + 0.1) { f2c.style.color = "var(--red)"; f2c.style.fontWeight = "700"; f2c.title = "More points per opportunity than the lead back"; }
      const c = { rb1car: td(pc(r.rb1car)), rb1opp: td(pc(r.rb1opp)), rb1snp: td(b1.snp == null ? "–" : Math.round(b1.snp) + "%"), rb1gl: td(r.rb1gl == null ? "–" : pc(r.rb1gl, 0)), rb2car: td(pc(r.rb2car)), eff: td(num(r.eff, 2)), rbtgt: td(pc(share(r.rbtgt, r.tmtgt))), rb1fp: td(num(f1, 2)), rb2fp: f2c };
      paint(c.rb1car, carR(r.rb1car)); c.rb1car.classList.remove("heat"); paint(c.eff, effR(r.eff)); c.eff.classList.remove("heat");
      if (KEYS.includes(sortK)) paint(c[sortK], sortR(val(r, sortK)));   // bold only on the sorted column
      t.addRow([cellLink(r.tm, `#team/${r.tm}/${y}`, "fz"), coachCell(r.hc), coachCell(r.oc || (r.pc ? r.pc + " (HC)" : null)), playerCell(b1.n, b1.id), td(String(r.rb1g)), c.rb1car, c.rb1opp, c.rb1snp, c.rb1gl,
                b2 ? playerCell(b2.n, b2.id) : td("–"), c.rb2car, c.eff, c.rbtgt, c.rb1fp, c.rb2fp]);
    }
    board.append(box); keepBox(box);
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
    // a detail page: the title over the red rule with the staff beside it, a season pill (the one control), the legend, the table sliding sideways
    const tt = el("h1", "ttl", `${tm} backfield, ${y}`), sub = el("small");
    if (rec) { sub.append("Head coach "); sub.append(link(rec.hc || "–", "#coach/" + encodeURIComponent(rec.hc || ""))); if (rec.oc) { sub.append(" · coordinator "); rec.oc.split(" / ").forEach((n, i) => { if (i) sub.append(" / "); sub.append(link(n, "#coach/" + encodeURIComponent(n))); }); } }
    tt.append(sub); main.append(tt);
    const tools = el("div", "tools"), yrsHere = [...SEASONS].reverse().filter((s) => (TEAMS[s] || []).some((r) => r.tm === tm));
    tools.append(seasonPill(y, (v) => { location.hash = `#team/${tm}/${v}`; }, yrsHere));
    const lg = el("div", "legend"); top.forEach((p, i) => { const s = el("span"), sw = el("i"); sw.style.background = COLORS[i]; s.append(sw, p.n); lg.append(s); }); tools.append(lg); main.append(tools);
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
    // the dropdown: the season and the window (the whole season or its last 4 / 8 games)
    POP.spec = { page: "teams", tabs: [["season", "Season"], ["window", "Games"], TABLE_TAB], keys: ["tmSeason", "tmWin"], draw: (tab, h) => {
      if (tab === "season") { const s = h.sec("Which season"); s.append(h.row(h.lbl("Season"), seasonPill(y, (v) => { S.tmSeason = v; save(); route(); }))); h.note(s, D.meta.through < 18 ? `${y} is through week ${D.meta.through}.` : `${y}, the full season.`); if (y !== CUR) h.clear(() => { S.tmSeason = CUR; save(); route(); }); }
      else { const s = h.sec("Which games"); s.append(h.seg([[0, "Season"], [4, "Last 4"], [8, "Last 8"]], win, (v) => { S.tmWin = v; save(); route(); })); h.note(s, "Per team game over the whole season or its last 4 or 8 games — a team's games are the weeks any of its players has a row."); if (win) h.clear(() => { S.tmWin = 0; save(); route(); }); }
    } };
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
    const rk = {}; for (const g of TPOS.concat(["ALL"])) for (const k of ["xfp", "fp", "d"]) rk[g + ":" + k] = ranker(rows.map((r) => r[g][k]));
    const extra = (y !== CUR) + (win > 0), SK = { xfp: "xFP/G", fp: "FP/G", d: "+/−" };
    const board = listFrame(main, { page: "teams", title: "Teams", sub: `by ${NAME[sg]} ${SK[sk]}`,
      ctl: [filtersBtn("Team filters", extra), count(`${rows.length} teams · ${y}${D.meta.through < 18 ? " · through week " + D.meta.through : ""} · PPR${win ? ` · last ${win} games` : ""}`, `${rows.length} teams`)],
      about: "Each offense's PPR points a game by position, and the expected points (xFP) its targets and carries were worth. xFP says how good the opportunities were; FP − xFP is what the players did with them. Every cell is coloured by where that team ranks among the 32 on it (red high); the sorted column is bold. Tap a column name to sort, a team for its backfield week by week. A QB's xFP prices his rushing only and counts his passing points as they were (as on Leaders), so the QB +/− is rushing over expected less fumbles. Fumbles lost and two-point conversions are in FP but not xFP." });
    const t = table(groups), box = boxOf(t, ["tm", y, win, sortK, dir].join(":")); box.classList.add("nonm");   // the second frozen column is the club's code, not a name: it keeps its own width
    rows.forEach((r, i) => {
      const cells = [td(String(i + 1), "fz rk"), cellLink(r.tm, `#team/${r.tm}/${y}`, "l fz2"), td(String(r.n))];
      for (const g of TPOS.concat(["ALL"])) for (const k of ["xfp", "fp", "d"]) {
        const v = r[g][k], c = td(k === "d" ? sgn(v) : num(v)); if (v != null) { paint(c, rk[g + ":" + k](v)); if (sortK !== g + ":" + k) c.classList.remove("heat"); } cells.push(c);   // every cell coloured by its rank; only the sorted column bold
      }
      t.addRow(cells);
    });
    const avg = (g, k) => { const v = rows.map((r) => r[g][k]).filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
    const ac = [td("", "fz"), td("League avg", "l fz2"), td("")];
    for (const g of TPOS.concat(["ALL"])) for (const k of ["xfp", "fp", "d"]) ac.push(td(k === "d" ? sgn(avg(g, k)) : num(avg(g, k))));
    t.addRow(ac, "tot first");
    board.append(box); keepBox(box); freeze(t);
    if (POP.open) { popBody(); placePop(); }
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
    // the dropdown: the position, then the season and the week the board is read after
    POP.spec = { page: "roles", tabs: [["position", "Position"], ["season", "Season"], TABLE_TAB], keys: ["rwPos", "rwSeason", "rwWeek"], draw: (tab, h) => {
      if (tab === "position") { const s = h.sec("Position"); s.append(h.seg(["RB", "WR", "TE"].map((p) => [p, p]), pos, (p) => { S.rwPos = p; save(); route(); })); h.note(s, "A back's share is of his team's running-back carries and targets, a receiver's or tight end's of his team's targets — always in the games he played."); }
      else {
        const s = h.sec("Which season"); s.append(h.row(h.lbl("Season"), seasonPill(y, (v) => { S.rwSeason = v; S.rwWeek = null; save(); route(); }, [...yrs].reverse())));
        const wk = h.sec("As of week"); const weeks = []; for (let k = last; k >= 1; k--) weeks.push([k, `After week ${k}`]);
        wk.append(h.row(h.lbl("Week"), pillSelect(`After week ${K}`, weeks, K, (v) => { S.rwWeek = v; save(); route(); }, "As of week")));
        h.note(wk, "Past weeks and seasons were held out of the fit, so a flag is what the board would have said then.");
        if (y !== yrs[yrs.length - 1] || K < last) h.clear(() => { S.rwSeason = yrs[yrs.length - 1]; S.rwWeek = null; save(); route(); });
      }
    } };
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
    const RW_LAB = { d: mkt ? "vs drafts" : "vs model", adp: "ADP", mk: mkt ? "Drafts" : "Model", td: "Share", l3: "Last 3", proj: "Proj", pts: "Pts/G", rest: "Actual" };
    const extra = (y !== yrs[yrs.length - 1]) + (K < last);
    const bt = g === "RB" ? "Backtest 2017-25, every season held out of its own fit, after week 3: the projection's rest-of-season share r .87 against .79 for the drafts' expectation; backs flagged More work (10+ points over the drafts) turned into 15+ point misses by the market 43% of the time (15% for everyone) and beat it by 15 points of share on average."
      : "Backtest 2017-25, every season held out of its own fit, after week 3: the projection's rest-of-season share r .87 against .76 for the drafts' expectation; receivers flagged More work (4+ points of targets over the drafts) beat the market by 5+ points 57% of the time (20% for everyone), by 6 on average.";
    const board = listFrame(main, { page: "roles", title: "Role Watch", sub: `${POS_WORD[pos]}s · by ${RW_LAB[sortK] || sortK}`,
      ctl: [filtersBtn(`${POS_WORD[pos]} filters`, extra), count(`${rows.length} ${pos}s with 2+ games · ${y} · after week ${K}`, `${rows.length} ${pos}s`)],
      about: `${pos === "RB" ? "Each back's share of his team's running-back carries and targets, in the games he played, against the share the drafts expected." : "Each receiver's share of his team's targets, in the games he played, against the share the drafts expected."} More work marks a projected rest-of-season share ${thr}+ points over the drafts'. ${bt} Most backfield turns are an injury or a benching ahead of him, so check back each week. ${mkt ? "" : "This season has no saved preseason ADP (the snapshot service only keeps the last week), so the comparison is with the model's own preseason line; from 2027 the August ADP is saved before Week 1."}` });
    const groups = [{ cols: [{ h: "Rk", cls: "fz" }, { h: "Player", cls: "l fz2" }, { h: "Tm" }, col("ADP", "adp", "Preseason PPR ADP, and his rank at the position")], end: 1 },
      { name: "Preseason", end: 1, cols: [col(mkt ? "Drafts" : "Model", "mk", mkt ? "The share his ADP implied: what the market expected" : "No preseason ADP was saved for this season, so this is the model's preseason share (last season and the draft, without ADP)")].concat(mkt ? [{ h: "Model", t: "The model's preseason share: ADP plus last season and the draft" }] : []) },
      { name: `Through week ${K}`, end: 1, cols: [{ h: "G" }, col("Share", "td", "His share in the games he played"), col("Last 3", "l3", "His share in his last three games")] },
      { name: "Rest of season", end: 1, cols: [col("Proj", "proj", "Projected share for the rest of the season: to date, last three and preseason, weighted by what held up in past seasons"), col(mkt ? "vs drafts" : "vs model", "d", "Projected share minus the preseason expectation"), col("Pts/G", "pts", "Projected PPR points a game for the rest of the season")]
        .concat(past ? [col("Actual", "rest", "His actual share over the rest of the season (3+ games)"), { h: "Act pts", t: "His actual PPR points a game over the rest of the season" }] : []) }];
    const t = table(groups), box = boxOf(t, ["rw", y, pos, K, sortK, dir].join(":")); // the name ellipsises beside its badge in the 116px column (the baseball's IL badge)
    const prc = ranker(rows.map((x) => x.w[ix("proj")])), sortR = ranker(rows.map((x) => val(x, sortK)), sortK !== "adp");   // the sorted column coloured among the rows (ADP: lower is better)
    rows.forEach((x, i) => {
      const r = x.r, w = x.w, nm = td(null, "l fz2"), wrap = el("div", "nmwrap"); wrap.append(playerLink(r.n, r.id)); nm.append(wrap);   // the name ellipsises on a phone, the badge stays (the baseball's .name.hasil)
      if (x.d >= thr) { const f = el("span", "rwflag", document.documentElement.dataset.view === "mobile" ? "More" : "More work"); f.title = "More work: his projected rest-of-season share beats the drafts' by the flag's margin"; wrap.append(f); }   // a phone's says "More" so the name keeps room in the 116px column (the IL badge's length)
      const c = { adp: td(r.adp ? `${num(r.adp, 0)} · ${pos}${adpRank.get(r.id)}` : "–"), mk: td(pc(x.base)), td: td(pc(w[ix("td")])), l3: td(w[ix("l3")] == null ? "–" : pc(w[ix("l3")])), proj: td(pc(w[ix("proj")])), d: td(sgn(x.d)), pts: td(num(w[ix("pts")])), rest: td(w[ix("rest")] == null ? "–" : pc(w[ix("rest")])) };
      paint(c.d, 50 + 50 * Math.max(-1, Math.min(1, x.d / (thr * 2)))); paint(c.proj, prc(w[ix("proj")]));   // vs drafts and Proj are always coloured; bold only on the sorted column
      for (const k of ["d", "proj"]) if (k !== sortK) c[k].classList.remove("heat");
      if (c[sortK] && !["d", "proj"].includes(sortK)) paint(c[sortK], sortR(val(x, sortK)));
      const cells = [td(String(i + 1), "fz rk"), nm, td(r.tm), c.adp, c.mk];
      if (mkt) cells.push(td(pc(r.pre)));
      cells.push(td(String(w[ix("g")])), c.td, c.l3, c.proj, c.d, c.pts);
      if (past) cells.push(c.rest, td(w[ix("restpts")] == null ? "–" : num(w[ix("restpts")])));
      rowPop(t.addRow(cells), r.id);
    });
    board.append(box); keepBox(box); freeze(t);
    if (POP.open) { popBody(); placePop(); }
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
    WR: [["Usage", ["g", "rts", "rte", "tgtsh", "tprr", "aysh", "adot", "wopr", "awopr", "wos"]], ["Efficiency", ["yprr", "syprr", "ypr"]], ["Fantasy", ["xfpg", "fpg"]]],
    RB: [["Usage", ["g", "snp", "carsh", "tgtsh", "oppg", "wog", "wos"]], ["Rushing", ["ypc", "ryoe", "expl"]], ["Receiving", ["tprr", "yprr", "syprr"]], ["Fantasy", ["xfpg", "fpg"]]],
    QB: [["Passing", ["g", "att", "cmpp", "epadb", "cpoe", "sackp"]], ["Rushing", ["carg", "ruxg"]], ["Fantasy", ["xfpg", "fpg"]]],
  };
  DY_COLS.TE = DY_COLS.WR;
  const DY_NEXT = { WR: ["g", "tprr", "fpg"], TE: ["g", "tprr", "fpg"], RB: ["g", "oppg", "fpg"], QB: ["g", "epadb", "fpg"] };
  const DY_SORT = { WR: "tprr", TE: "tprr", RB: "wog", QB: "epadb" };
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
    const yrLab = (DY_YRS.find((x) => x[0] === cy) || [0, "All"])[1], curM = window.FB[CUR].meta, partial = curM.through < 18;
    // the dropdown: the position; the year in the league and the draft round; the season (or every class) and the minimum
    POP.spec = { page: "dynasty", tabs: [["position", "Position"], ["year", "Year and draft"], ["season", "Season"], TABLE_TAB], keys: ["dyPos", "dyYr", "dyRd", "dySeason", "dyMin"], draw: (tab, h) => {
      if (tab === "position") { const s = h.sec("Position"); s.append(h.seg(["WR", "TE", "RB", "QB"].map((x) => [x, x]), pos, (x) => { S.dyPos = x; save(); route(); })); h.note(s, "Tight ends carry the receivers' columns; fullbacks count as running backs. Each position keeps its own sort and minimum."); }
      else if (tab === "year") {
        const s = h.sec("Year in the league"); s.append(h.seg(DY_YRS, cy, (v) => { S.dyYr = v; save(); route(); })); h.note(s, "A career year is the season less his first NFL season (the draft year, else nflverse's rookie season) plus one. All adds a Yr column.");
        const r = h.sec("Draft"); r.append(h.seg(DY_RDS, rd, (v) => { S.dyRd = v; save(); route(); }));
        if (cy !== 1 || rd !== "") h.clear(() => { S.dyYr = 1; S.dyRd = ""; save(); route(); });
      } else {
        const s = h.sec("Which season"); s.append(h.row(h.lbl("Season"), pillSelect(sy ? String(sy) : "All seasons", [[0, "All seasons"], ...[...SEASONS].reverse().map((v) => [v, String(v)])], sy, (v) => { S.dySeason = v; save(); route(); }, "Season")));
        h.note(s, "One season lists that class alone; the sorted column is still coloured against the same career year in every class.");
        const m = h.sec("Minimum"), f = h.num("Min", mn, { min: 0, step: 10 }, (v) => { S.dyMin = Object.assign({}, S.dyMin, { [pos]: Math.max(0, Math.round(+v || 0)) }); save(); route(); }); f.append(munit); m.append(h.row(f));
        h.note(m, `${mdef} ${munit} by default${partial ? `, pro-rated for ${CUR} through week ${curM.through}` : ""}.`);
        if (sy || mn !== mdef) h.clear(() => { S.dySeason = 0; S.dyMin = Object.assign({}, S.dyMin, { [pos]: mdef }); save(); route(); });
      }
    } };
    const kLab = (kk) => kk === "y" ? "Season" : kk === "age" ? "Age" : kk === "pick" ? "Draft" : kk === "cy" ? "Yr" : kk.startsWith("n:") ? "next season's " + METRIC[kk.slice(2)].h : METRIC[kk].h;
    const extra = (cy !== 1) + (rd !== "") + (sy !== 0) + (mn !== mdef);
    const F = DY_FIND[pos], fbox = el("div", "findings"); if (F) { fbox.append(el("h3", null, "What carries into next season")); const ul = el("ul"); for (const [b, x] of F) { const li = el("li"); li.append(el("b", null, b + ": "), x); ul.append(li); } fbox.append(ul); }
    const lastFull = partial ? CUR - 1 : null;
    const board = listFrame(main, { page: "dynasty", title: "Dynasty", sub: `${yrLab} · by ${kLab(k)}`,
      ctl: [filtersBtn(`${POS_WORD[pos]} filters`, extra), count(`${rows.length} ${pos}s · ${yrLab.toLowerCase()}${sy ? " · " + sy : " · every class"} · ${mn}+ ${munit}${partial ? ` (pro-rated for ${CUR} through week ${curM.through})` : ""}`, `${rows.length} ${pos}s`)],
      about: [el("p", "note", `Every season by the player's year in the league, ${SEASONS[0]}–${CUR}: this year's rookies against every rookie class, second-year players against every second year. The sorted column is coloured against the same year in every class; Next season is what he did the year after. Tap a column name to sort, a name for his page on that season. Age is on 1 September; Draft is the round and overall pick. ${lastFull ? `Next season for a ${lastFull} row is ${CUR} so far (through week ${curM.through}). ` : ""}${pos === "RB" ? "PFR's charting (the elusive rating, broken tackles, yards after contact) starts in 2018. " : ""}Routes are dropbacks he was on the field for${curM.estRoutes ? `; ${CUR}'s are snap share × team dropbacks until nflverse publishes participation` : ""}.`)].concat(F ? [fbox] : []) });
    const sortBy = (kk) => () => { const sd = Object.assign({}, S.dySort), dd = Object.assign({}, S.dyDir); if (k === kk) dd[pos] = -dir; else { sd[pos] = kk; const mm = kk.startsWith("n:") ? kk.slice(2) : kk; dd[pos] = kk === "pick" || kk === "age" ? 1 : kk === "y" || kk === "cy" ? -1 : METRIC[mm] && METRIC[mm].hib === 0 ? 1 : -1; } S.dySort = sd; S.dyDir = dd; save(); route(); };
    const c0 = (h, kk, t, cls) => ({ h, t, cls, onSort: kk ? sortBy(kk) : null, lit: kk === k });
    const groups = [{ cols: [{ h: "Rk", cls: "fz" }, { h: "Player", cls: "l fz2" }, c0("Season", "y")].concat(cy ? [] : [c0("Yr", "cy", "His year in the league that season")]).concat([{ h: "Tm" }, c0("Age", "age", "Age on 1 September of that season"), c0("Draft", "pick", "Round · overall pick; UDFA = undrafted")]), end: 1 }];
    for (const [name, ks] of DY_COLS[pos]) groups.push({ name, end: 1, cols: ks.map((kk) => c0(METRIC[kk].h, kk, METRIC[kk].t)) });
    groups.push({ name: "Next season", end: 1, cls: "nxt", cols: nk.map((kk) => c0(METRIC[kk].h, "n:" + kk, "The season after: " + (METRIC[kk].t || METRIC[kk].h))) });
    const t = table(groups), box = boxOf(t, ["dy", pos, cy, rd, sy, mn, k, dir].join(":"));
    rows.forEach((r, i) => {
      const pickS = () => { S.pseason = Object.assign({}, S.pseason, { [r.p.id]: r.y }); save(); };   // his page opens on that season
      const nm = td(null, "l fz2"), a = link(r.p.n, "#player/" + r.p.id); a.addEventListener("click", (ev) => { pickS(); openPlayer(r.p.id, ev); }); nm.append(a);
      const cells = [td(String(i + 1), "fz rk"), nm, td(String(r.y))]; if (!cy) cells.push(td(String(r.cy)));
      cells.push(td(r.p.tms && r.p.tms.length > 1 ? r.p.tms.join("/") : r.p.tm), td(r.p.age != null ? String(Math.floor(r.p.age)) : "–"), td(r.e.dr ? `R${r.e.dr[1]} · ${r.e.dr[2]}` : "UDFA"));
      for (const kk of keys) { const c = td(fmtM(kk, r.m[kk])); if (kk === k) paint(c, pctIn(r.m[kk])); cells.push(c); }
      for (const kk of nk) { const v = r.nm ? r.nm[kk] : null, c = td(r.nx ? fmtM(kk, v) : r.y === CUR ? "" : "–", "nx"); if ("n:" + kk === k) paint(c, pctIn(v)); cells.push(c); }
      const tr = t.addRow(cells); tr.addEventListener("click", (ev) => { if (ev.target.closest("a, button")) return; pickS(); openPlayer(r.p.id, ev); }); tr.classList.add("clk");
    });
    if (rows.length) {
      const avg = (f) => { const v = rows.map(f).filter((x) => x != null && isFinite(x)); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
      const ac = [td("", "fz"), td(`Average (${rows.length})`, "l fz2"), td("")]; if (!cy) ac.push(td("")); ac.push(td(""), td(num(avg((r) => r.p.age), 1)), td(""));
      for (const kk of keys) ac.push(td(fmtM(kk, avg((r) => r.m[kk]))));
      for (const kk of nk) ac.push(td(fmtM(kk, avg((r) => (r.nm ? r.nm[kk] : null)))));
      t.addRow(ac, "tot first");
    } else t.addRow([td("No players at that minimum.", "l")]);
    board.append(box); keepBox(box); freeze(t);
    if (POP.open) { popBody(); placePop(); }
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

  const ROLE_WORD = { hc: "Head coach", oc: "Coordinator", all: "Staff" }, ROLE_LAB = { hc: "head coaches", oc: "coordinators", all: "all staff" };
  const C_COLS = { n: "Seasons", car: "Car%", opp: "Opp%", snp: "Snap%", gl: "GL%", eff: "Backs used", cow: "Bell-cow yrs", com: "Committee yrs", tgt: "RB Tgt%" };
  function coaches(main) {
    main.textContent = "";
    const pick = ROLE_PICK[S.coachRole] ? S.coachRole : "hc", minS = Math.max(1, +S.coachMin || 1); let q0 = String(S.coachQ || "").trim().toLowerCase();   // q0 moves as he types
    const CS = coachSeasons(), L = leagueAvg();
    // the averages are over the seasons in the role picked; Teams / Roles still say where else he's been
    let rows = [...CS.entries()].map(([n, all]) => ({ n, all, rs: all.filter(ROLE_PICK[pick]) })).filter((x) => x.rs.length >= minS).map((x) => Object.assign(x, { a: agg(x.rs) }));
    const sortK = C_COLS[S.cSort] ? S.cSort : "car", dir = S.cDir || -1;
    rows.sort((x, z) => { const a = x.a[sortK], b = z.a[sortK]; if (a == null) return 1; if (b == null) return -1; return dir * (a - b); });
    const sb = (k) => () => { if (S.cSort === k) S.cDir = -(S.cDir || -1); else { S.cSort = k; S.cDir = -1; } save(); route(); };
    const shown = () => rows.filter((r) => !q0 || r.n.toLowerCase().includes(q0)).length;
    // the dropdown: the job and a name search (typing narrows the list in place, no redraw), then the minimum seasons
    POP.spec = { page: "coaches", tabs: [["coaches", "Coaches"], ["minimum", "Minimum"], TABLE_TAB], keys: ["coachRole", "coachMin", "coachQ"], draw: (tab, h) => {
      if (tab === "coaches") {
        const s = h.sec("Which coaches"); s.append(h.seg([["hc", "Head coaches"], ["oc", "Coordinators"], ["all", "All staff"]], pick, (k) => { S.coachRole = k; save(); route(); }));
        h.note(s, "Head coaches and Coordinators average only the seasons in that job; All staff averages every season he was on the staff, position coach included.");
        const f = h.sec("Find a coach"), lab = el("label", "search"), q = el("input"); q.type = "search"; q.placeholder = "Search name"; q.value = S.coachQ || ""; q.setAttribute("aria-label", "Find a coach"); lab.append(q); f.append(lab);
        q.addEventListener("input", () => { S.coachQ = q.value; q0 = q.value.trim().toLowerCase(); save(); t.querySelectorAll("tbody tr[data-k]").forEach((tr) => { tr.hidden = !!q0 && !tr.dataset.k.includes(q0); }); cnt.textContent = cntText(); });
        if (pick !== "hc" || q0) h.clear(() => { S.coachRole = "hc"; S.coachQ = ""; save(); route(); });
      } else {
        const s = h.sec("Minimum"), f = h.num("Min seasons", minS, { min: 1, max: 11 }, (v) => { S.coachMin = Math.max(1, Math.round(+v || 1)); save(); route(); }); s.append(h.row(f));
        h.note(s, "Seasons in the job picked; a coach with fewer is left off the list.");
        if (minS !== 2) h.clear(() => { S.coachMin = 2; save(); route(); });
      }
    } };
    const extra = (pick !== "hc") + (minS !== 2) + (!!q0);
    const cntText = () => isMobile() ? `${shown()} coaches` : `${shown()} coaches · ${minS}+ season${minS > 1 ? "s" : ""} as ${pick === "all" ? "an offensive coach" : pick === "hc" ? "head coach" : "coordinator"}${q0 ? ` · "${S.coachQ.trim()}"` : ""}`;
    const cnt = count(cntText(), cntText());
    const board = listFrame(main, { page: "coaches", title: "Coaches", sub: `${ROLE_LAB[pick]} · by ${C_COLS[sortK]}`, ctl: [filtersBtn(`${ROLE_WORD[pick]} filters`, extra), cnt],
      about: [el("p", "note", "Every coach on an offensive staff since 2016, by how his teams split running back work in the seasons he was there. A coach's average counts each of those seasons once. Style: Bell cow when his lead backs averaged 68%+ of RB carries in their games (the top third of coaches), Committee under 60% (the bottom third), and between them a lead back with a change of pace. A lead back takes 64% of the carries in his games in a typical season. Staffs are each season's final staff on Wikipedia, so a coach let go mid-season isn't listed that year (a head coach always is, from the games). Tap a column name to sort, a name for his page."), findings()] });
    const t = table([{ cols: [{ h: "Coach", cls: "l fz" }, { h: "Seasons", onSort: sb("n"), lit: sortK === "n" }, { h: "Teams", cls: "l" }, { h: "Every job", cls: "l", t: "Seasons in each job across his whole offensive-staff history: HC head coach, OC coordinator, PC play-caller, PGC / RGC pass / run game coordinator, QB / RB / WR / TE / OL position coach" }, { h: "Style", cls: "l" }], end: 1 },
                     { name: "Lead back (in his games)", end: 1, cols: [{ h: "Car%", onSort: sb("car"), lit: sortK === "car" }, { h: "Opp%", onSort: sb("opp"), lit: sortK === "opp" }, { h: "Snap%", onSort: sb("snp"), lit: sortK === "snp" }, { h: "GL%", onSort: sb("gl"), lit: sortK === "gl" }] },
                     { name: "Backfield", end: 1, cols: [{ h: "Backs used", onSort: sb("eff"), lit: sortK === "eff" }, { h: "Bell-cow yrs", onSort: sb("cow"), lit: sortK === "cow", t: "Seasons his lead back took 72%+ of RB carries in his games (the top third of team-seasons)" }, { h: "Committee yrs", onSort: sb("com"), lit: sortK === "com", t: "Seasons his lead back took under 58% (the bottom third)" }] },
                     { name: "Passing game", end: 1, cols: [{ h: "RB Tgt%", onSort: sb("tgt"), lit: sortK === "tgt" }] }]);
    const box = boxOf(t, ["co", pick, minS, sortK, dir].join(":")); box.classList.add("namefz");   // the coach's name is the first frozen column: the 116px name column there
    const carR = ranker(rows.map((r) => r.a.car)), sortR = ranker(rows.map((r) => r.a[sortK]));
    for (const r of rows) {
      const teams = [...new Set(r.all.map((x) => x.tm))].join(", "), [vd, vp] = verdict(r.a), tag = el("span", "tag", vd), vc = td(null, "l"); paint(tag, vp); tag.classList.remove("heat"); vc.append(tag);
      const c = { n: td(String(r.a.n)), car: td(pc(r.a.car)), opp: td(pc(r.a.opp)), snp: td(pc(r.a.snp, 0)), gl: td(pc(r.a.gl, 0)), eff: td(num(r.a.eff, 2)), cow: td(String(r.a.cow)), com: td(String(r.a.com)), tgt: td(pc(r.a.tgt)) };
      paint(c.car, carR(r.a.car)); c.car.classList.remove("heat"); paint(c[sortK], sortR(r.a[sortK]));   // Car% always coloured; the sorted column coloured and bold
      const tr = t.addRow([cellLink(r.n, "#coach/" + encodeURIComponent(r.n), "l fz"), c.n, td(teams, "l"), td(catLine(r.all), "l"), vc, c.car, c.opp, c.snp, c.gl, c.eff, c.cow, c.com, c.tgt]);
      tr.dataset.k = r.n.toLowerCase(); if (q0 && !tr.dataset.k.includes(q0)) tr.hidden = true;
    }
    t.addRow([td("League, 2016–" + String(CUR).slice(2), "l fz"), td(String(L.n)), td(""), td(""), td(""), td(pc(L.car)), td(pc(L.opp)), td(pc(L.snp, 0)), td(pc(L.gl, 0)), td(num(L.eff, 2)), td(String(L.cow)), td(String(L.com)), td(pc(L.tgt))], "tot first");
    board.append(box); keepBox(box); freeze(t);
    if (POP.open) { popBody(); placePop(); }
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
      const f1 = fpo(b1), f2 = b2 ? fpo(b2) : null, f2c = td(num(f2, 2)); if (f2 != null && f1 != null && f2 > f1 + 0.1) { f2c.style.color = "var(--red)"; f2c.style.fontWeight = "700"; }
      let nxt = "–"; if (b2) { const nx = (TEAMS[r.y + 1] || []).find((x) => x.rbs.some((b) => b.id === b2.id)); if (nx) { const i = nx.rbs.findIndex((b) => b.id === b2.id), all = nx.rbcar || 1; nxt = pc(100 * nx.rbs[i].car / all) + (nx.tm !== r.tm ? ` (${nx.tm})` : ""); } }
      const job = td(r.roles.join(", ") + (r.cats.has("PC") && !r.cats.has("OC") ? " (called plays)" : ""), "l");
      const hcc = td(null, "l"); if (r.hc && r.hc !== name) hcc.append(link(r.hc, "#coach/" + encodeURIComponent(r.hc))); else hcc.textContent = r.hc === name ? "himself" : "–";
      t.addRow([cellLink(String(r.y), `#team/${r.tm}/${r.y}`, "fz"), td(r.tm), job, hcc, playerCell(b1.n, b1.id), td(String(r.rb1g)), car, td(pc(r.rb1opp)), td(b1.snp == null ? "–" : Math.round(b1.snp) + "%"), td(r.rb1gl == null ? "–" : pc(r.rb1gl, 0)), td(num(f1, 2)),
                b2 ? playerCell(b2.n, b2.id) : td("–"), td(pc(r.rb2car)), f2c, td(nxt), td(num(r.eff, 2)), td(pc(share(r.rbtgt, r.tmtgt)))]);
    }
    main.append(t.box, findings(), el("p", "note", "Every season he was on an offensive staff, in whatever job. Car% is coloured against every team-season since 2016. An RB2's FP/Opp in red beat the lead back's; Next yr Car% shows whether he got more of the work the following season (his share of that team's RB carries over the whole season)."));
  }

  // ---------- Settings ----------
  // (23 Oct 2026, the football site in the baseball site's dress): one white card with three tabs across the top in the Filters-button
  // dress — a tab is a link to #settings/<tab>, so Back works — the Appearance rows the baseball page has (colour scheme, light or dark,
  // layout, tables, font, site default; no wOBA scale or sync here, they're baseball's), the stat glossary from METRIC by position, and a
  // paragraph per page under How this page works. themes.js (window.FB_THEMES / FB_TABLES) holds the schemes and the device's picks.
  const SET_TABS = [["glossary", "Stat glossary"], ["appearance", "Appearance"], ["key", "Colour key"], ["how", "How this page works"]];
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
    } else if (tab === "key") { lead("Colour key", "What the colours on every table and bar mean."); body.append(colourKey()); }
    else { lead("How this page works", "What each page shows and where the numbers come from."); body.append(howTo()); }
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
  // the colour key: the one scale every heat-mapped cell, pill and bar shares, and what else is coloured
  function colourKey() {
    const b = el("div", "prose");
    const key = el("div"), scale = el("span", "scale"); [5, 25, 50, 75, 95].forEach((p) => { const i = el("i"); paint(i, p); scale.append(i); });
    key.append("Percentiles run 0–100 within the position's qualifiers that season", scale, "blue is cold, red is hot — Savant's scale, the same in every colour scheme. Stats where lower is better (drops, contested targets, stuffed carries, interceptions) are flipped so 100 is always the best.");
    b.append(key);
    for (const html of [
      `<b>On a list</b> — the sorted column is filled with each player's percentile colour (Table format ▸ Heat map colours every column; Numbers shows the percentiles themselves). A value in <b><i>bold italic</i></b> is the best among the qualifiers. Teams colours every cell by the team's rank among the 32; Backfields and Coaches colour Car% red for the most bell-cow backfields and blue for the most shared, and an <b style="color:var(--red)">RB2 in red</b> out-produced his lead back per touch.`,
      `<b>On his page</b> — each bar runs to his percentile in its colour, the bubble carrying the number; FP / G and xFP / G on the band are pills in the same colour. In the xFP build-up His is coloured by where he stands among the qualifiers on that step and ± red lifts his points, blue costs them; the yellow cell is his expected points per game.`,
      `<b>Role Watch</b> — vs drafts runs blue to red by how far his projected share sits under or over what the drafts expected; <b style="color:var(--red)">More work</b> marks a share 10+ points over for a back, 4+ for a receiver.`,
    ]) b.append(Object.assign(el("div"), { innerHTML: html }));
    return b;
  }
  function howTo() {
    const b = el("div", "prose");
    b.append(Object.assign(el("div"), { innerHTML: "Click a column name to sort by it; click a name for his page (a popup over the list, with a × to close it). The colours are explained under <b>Colour key</b>." }));
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
    document.body.dataset.page = page; document.body.classList.toggle("lst", LIST_PAGES.has(page));   // a list page stands: main is the screen's height and only the box scrolls
    document.title = PAGE_TITLE[page] ? "Sean's Football · " + PAGE_TITLE[page] : "Sean's Football Site";
    const bs = $("#bscroll"); if (bs) { if (Object.keys(LB.keep).length > 40) LB.keep = {}; LB.keep[bs.dataset.key] = { top: bs.scrollTop, left: bs.scrollLeft }; }   // a list box's place, put back whenever that same list draws again
    if (page === "player" && a) noteRecent(a);
    const main = $("main"), same = S.lastPage === h;
    if (page === "player" && same) main.style.minHeight = main.offsetHeight + "px"; else main.style.minHeight = "";   // a player's page redrawn in place (a season, a tab) keeps its height through the Loading… line, so the page stays where it was
    main.innerHTML = '<p class="load">Loading…</p>';
    const go = page === "player" ? player(main, a) : page === "settings" ? settingsPage(main, a) : page === "backfields" ? backfields(main) : page === "team" ? teamPage(main, a, b) : page === "coaches" ? coaches(main) : page === "coach" ? coachPage(main, a) : page === "roles" ? roleWatch(main) : page === "teams" ? teamsPage(main) : page === "dynasty" ? dynasty(main) : leaders(main);
    Promise.resolve(go).catch((err) => { main.textContent = ""; main.style.minHeight = ""; main.append(el("p", "load", "Couldn't load that season's data. Check the connection and reload.")); console.error(err); });
    if (S.lastPage !== h) { window.scrollTo(0, 0); S.lastPage = h; save(); }
  }
  document.body.prepend(header());
  { const top = $(".top"), set = () => { for (const k of ["--toph", "--header-h"]) document.documentElement.style.setProperty(k, top.offsetHeight + "px"); }; new ResizeObserver(set).observe(top); set(); }   // where a table's pinned column names sit (--header-h is the baseball stylesheet's name for it)
  window.addEventListener("hashchange", route);
  route();
})();

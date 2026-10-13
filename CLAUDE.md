# Sean's Football — how it is built, where the numbers come from, and how to change it

Live: **https://seanvarg13.github.io/fantasy-football/** · repo: `seanvarg13/fantasy-football`

Sean reads it on his phone from the hosted copy, so **anything that is not published does not exist for him**. Publishing is merging
to `main`; after a hand edit to `fb.js` / `fb.css` / `index.html` run `python3 tools/publish.py` (stamps the `?v=` hashes so a phone
picks the change up at once) before merging. Code style: dense, comments say why, no framework, no build step.

Sean, 13 Oct 2026: "I'd be curious what a fantasy football website in the exact same nature of this site would look like", then
"Could we also do coaching staff history stuff ... cases like Chuba Hubbard this year, Bucky Irving where ppl thought they'd be in
committees but they in fact were not plus cases like Jaylen Warren at rb with points per touch reviving usage and also how coaches
utilize RBs in the pass game and historically feed their bell cow or rb1 or if it's truly a 1a / Let's make this happen". A site of its own, in its own repo (Sean, 13 Oct 2026: "make it so the baseball and football apps/sites are two different ones not
one intertwined one" — it began as `football/` inside seanvarg13.github.io and moved here the same day). Same dress as his baseball
site (the light-blue band with the red stripe, B-Ref tables, Savant percentile bars, boxy buttons, Barlow Condensed + Source Sans 3),
PPR scoring throughout, and its own home-screen app (`manifest.json`, the football icon in `icons/`). No links between the two sites.

**Files**: `index.html` (stamped by `tools/publish.py`: `?v=` = sha1 of every loaded file and `data/*.js`),
`fb.js` (one IIFE, no build step, no framework), `fb.css`, and generated `data/`:
`fb-<season>.js` (`window.FB[y] = {meta, players}`, a player's weekly rows named by `meta.wfields` — append only),
`index.js` (`FB_INDEX`: name, position, seasons, bio, headshot, draft), `teams.js` (`FB_TEAMS`: every team-season's coaches and RB
usage), `career.js` (`FB_CAREER`: season lines + position ranks, loaded with a player page), `staff.json` (coordinators).

**Data** (`tools/build_fb.py --cache .cache/fb --out data --seasons 2016-2026 --current 2026`, ~7 min, everything anonymous
from nflverse's GitHub releases): play-by-play 2016 on, participation (who was on the field — a route = a dropback he was out for;
the season in progress has no participation yet, so its routes are snap share × team dropbacks, `meta.estRoutes`), snap counts
(PFR ids mapped through `players.parquet`), Next Gen rushing (RYOE), `players.parquet` for bios / headshots, nfldata's `games.csv`
for the head coach game by game (OAK / SD / STL read as LV / LAC / LA). PPR points per player-week: catches, yards / 10, TDs, passing
(yards / 25, 4 a TD, −2 an INT — for anyone who threw), −2 a lost fumble on an offensive snap, +2 a two-point conversion, kneel-down
yards, and 6 for any touchdown he scored on a kickoff or punt — 2025 against nflverse's `fantasy_points_ppr`: 87% to the tenth,
mean gap 0.12 points a season, none over 3.5 (what's left: a few laterals and odd plays). A week with points but no offensive snap
(a kick-return touchdown) gets its own row.

**xFP** (expected PPR points): two `HistGradientBoostingRegressor`s price every target (air yards, yard line, down, distance, pass
location, shotgun, position, a flag when air yards are missing) and every carry (yard line, down, distance, run location / gap,
shotgun, position, scramble) by what a play like it scores, and two more give the touchdown chance alone (xTD), fitted
leave-one-season-out on every finished season and anchored so each season's xFP sums to its real points. A player's xFP / game,
FPOE / game (points over expected), TDOE.

**Pages** (hash routes): **Leaders** (`#leaders`, WR / TE / RB / QB, any season, B-Ref table with Basic / Usage / Efficiency / Fantasy
groups — Route%, TPRR, target and air-yard share, aDOT, WOPR, red-zone targets, YPRR, CROE, YACOE, carry share, snap share, opportunities
/ game, goal-line carries, RYOE, FP / opportunity, EPA / dropback, CPOE … — the sorted column heat-filled, a Qualified avg row;
qualifying: WR / TE 200 routes or 40 targets, RB 90 carries + targets, QB 200 dropbacks, scaled by weeks played in a season in
progress); **a player's page** (`#player/<gsis id>`: the band with bio and FP / G · xFP / G · FPOE / G chips, Savant bars by section
against his position's qualifiers, an **xFP build-up** tab — the league's per-game xFP with his routes, targets per route, xFP per
target and rushing xFP swapped in one at a time, marked yellow at his xFP / G, then TD luck and the rest to his FP / G, plus a "where
the gap comes from" table — a **Game log** tab, a **Backfield** tab for RBs, and a season-by-season table with **each season's head
coach and offensive coordinator**, linked); **Backfields** (`#backfields`: every team's lead-back carry / opportunity / snap / goal-line
share **in the games the lead back played**, so an injury doesn't read as a committee, RB2, effective backs used = 1 / Σ share², RB share
of targets, FP per opportunity for RB1 and RB2 — RB2 in red when he out-produced the lead back per touch, the Jaylen Warren case);
**a team's backfield** (`#team/<TM>/<season>`: week-by-week carry-split bars and each back's snap% / carries / targets / FP);
**Coaches** (`#coaches`, head coaches or coordinators, min seasons: lead-back shares averaged over the seasons he held the job, bell-cow
and committee seasons, RB target share, a Style tag — **Bell cow** when his lead backs averaged 68%+ of RB carries in their games,
**Committee** under 60%, a lead back with a change of pace between; cut at the league's thirds of coaches 2016-25, single seasons 72% /
58%; a typical lead back takes 64%); **a coach's page** (`#coach/<name>`: every season with RB1 / RB2 and whether the RB2 got more work
the next year).

**Coaching staffs** (`tools/build_staff.py`; Sean, 13 Oct 2026: "For the play caller stuff do it based on who is on the offense / So if
Mike LaFleur is on that team for his history include every team he coached on"): each team-season's Wikipedia page read raw
(`index.php?action=raw`, one request a second — the API and REST endpoints answer 429 from shared IPs), cached in `.cache/fb/wiki/`
(`--reparse` re-reads them all with no requests). From its **final staff** (`{{NFL final staff}}`'s Head Coaches + Offensive Coaches
blocks — some pages spell the keys `head_coach =` / `offensive =` — or, for the season in progress, the club's `{{<Team> staff}}`
template, `;Head coach(es)` or bold `Head coaches` up to the defensive coaches) every offensive coach as `[role, name]` (`off` in
`staff.json`, `st` in `teams.js`; defensive / special-teams / strength assistants out, "Vacant" out), plus the coordinator (the Staff
lines, else the infobox's `off_coach`; "de facto" / none = the head coach called plays, `pc`). Spellings folded to one per coach
(`canon`: "T. J." = "T.J.", case), Jr. / Sr. kept apart (Tony Sparano and Tony Sparano Jr.). 822 coaches, all 352 team-seasons,
a median 11 offensive coaches each; 23 past team-seasons name no coordinator. The head coach is the games list's (the one who coached
the most games, so interims count), except in the season in progress, where nfldata still had last year's man (2026: Gannon, Morris,
McDermott) — Wikipedia's wins when the games list's coach isn't on the staff (`team_seasons(…, current=)`); `HC_FIX` mends
"Klint Kubliak". Every run of the workflow re-reads this season's staffs.

**A coach's history** (`coachSeasons` in `fb.js`) is every team-season he was on the offensive staff, in any job: each job is sorted into
HC / OC / PC (play-caller: the coordinator, or a head coach with none) / PGC / RGC / QB / RB / WR / TE / OL / Asst (`ROLE_CATS`). Coaches
page: **Head coaches**, **Coordinators** (OC or play-caller) or **Every offensive coach** — the averages are over the seasons in the job
picked, the Teams and Every job columns over his whole history, a Find a coach box. A coach's page: his stints (club, seasons, jobs —
"ATL 2016 offensive assistant · SF 2017–20 pass game specialist / coordinator · NYJ 2021–22 OC · LA 2023–25 OC · ARI 2026 head coach" for
Mike LaFleur), the averages over every season, and a season table with his job and that year's head coach. Staffs are the season's
final staff, so a coach let go mid-season isn't listed that year (a head coach always is, from the games).

**Updates**: `.github/workflows/update.yml` — Monday, Tuesday and Friday at 11:20 UTC September to mid-February (after Sunday, Monday
night and Thursday night games; nflverse refreshes overnight), and by hand (Actions → Update; `staff` input refreshes those
seasons' staffs on top of this season's, `dry` builds without publishing). It publishes the way the baseball site's cloud run does: the built `data/` kept aside, reset to main, put back, stamped, one plain
commit on top of main, never a force-push.

**Football to-dos** (Sean, 13 Oct 2026, parked until he says go):
* *Staff history's niche logistics* ("we can figure out the more niche logistics there later"): weighting a season by his job
  (play-caller vs position coach), mid-season firings and hirings (the final staff misses a fired coordinator — Greg Roman, Buffalo 2016),
  who actually called plays when the title doesn't say, title changes within a season.
* *A projection model* that would have seen Gibbs's big year, Bucky Irving, Chuba Hubbard, Christian Watson and Parker Washington coming.

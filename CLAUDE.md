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
page: **Head coaches**, **Coordinators** (OC or play-caller) or **All staff** — the averages are over the seasons in the job
picked, the Teams and Every job columns over his whole history, a Find a coach box. A coach's page: his stints (club, seasons, jobs —
"ATL 2016 offensive assistant · SF 2017–20 pass game specialist / coordinator · NYJ 2021–22 OC · LA 2023–25 OC · ARI 2026 head coach" for
Mike LaFleur), the averages over every season, and a season table with his job and that year's head coach. Staffs are the season's
final staff, so a coach let go mid-season isn't listed that year (a head coach always is, from the games).

**Updates**: `.github/workflows/update.yml` — Monday, Tuesday and Friday at 11:20 UTC September to mid-February (after Sunday, Monday
night and Thursday night games; nflverse refreshes overnight), and by hand (Actions → Update; `staff` input refreshes those
seasons' staffs on top of this season's, `dry` builds without publishing). It publishes the way the baseball site's cloud run does: the built `data/` kept aside, reset to main, put back, stamped, one plain
commit on top of main, never a force-push.

**What staff history can and can't tell you (Sean, 13 Oct 2026: "my goal is to help identify cases like chuba and bucky where ppl going
in thought they would be in committees but the reality is they are not ... with the staff history")**: tested before building on it (every
team-season 2016-25; the RB1's carry share in his own games as the target; scratch `staff/roles.py`, `room.py`, `persist*.py`, `pccheck.py`):
* *By job*: a staff member's history is his team-seasons before this one, shrunk n / (n + 3). Held out by season, the play-caller's history
  predicts this season's lead-back share at r .00, play-caller + head coach .04, every role together .11 — position coaches add nothing.
  The team's own split the year before: .21.
* *The room*: the backs' prior-season opportunities a game (a rookie by draft round), the best one's share of the top two and his gap
  over the second: r .33. Staff history on top of it: no gain (.32).
* *Does a style repeat?* Same play-caller, same team, next year: r .36 (mostly the same backs). Same team, new play-caller: .16. A
  play-caller who moves teams: −.38 (23 moves). After the room, a play-caller explains ~4% of the split, p .30 by permutation — chance.
  Raw (room ignored) it reads 17%, which is the backs he kept, not him.
* *What does travel*: the **RB share of targets** (a play-caller's next team r .40 on 23 moves, .2-.3 on other cuts; 24% of its variance by
  coach) — the one scheme habit that follows him. Run rate, goal-line share and backs used don't.
* *Who called plays*: **`data/playcallers.json`** — head coaches who called their own offense by team and seasons, hand-built from public
  reporting (edit freely); `play_caller()` in `build_fb.py` uses it when that man is the head coach that season (the season in progress
  follows the last listed season under the same head coach), else Wikipedia's "de facto", else the coordinator. It moved a third of
  team-seasons' play-caller and sharpened nothing above (target share moves .17 next year / .28 first year at a new team vs his career).
* *Mid-season changes*: the head coach is the games list's, game by game; a coordinator fired mid-season is missing from the final staff
  and two coordinators listed in one season are both credited — left as is, since nothing here depends on it.
On the site: the Coaches list and every coach's page carry a **What follows a coach** box (`findings()` in `fb.js`, `.findings`) saying
the above; the third Coaches button is **All staff**. The bell-cow question is Role Watch's (below), which reads it from the weekly usage, since the staff
added nothing.

**Football to-dos** (Sean, 13 Oct 2026, parked until he says go):
* ~~Staff history's niche logistics~~ — done 13 Oct 2026, above.
* ~~A projection model~~ — Role Watch, 13 Oct 2026, below. Not built: a points projection page, Role Watch on the player page.

## Role Watch (Sean, 13 Oct 2026: "help identify cases like chuba and bucky where ppl going in thought they would be in committees but
the reality is they are not in committees and are featured")

The **Role Watch** page (`#roles`, `roleWatch()` in `fb.js`) lists every back, receiver and tight end with his share of his team's work
— a back's carries + targets over his team's running-back carries + targets, a receiver's or tight end's targets over his team's targets,
always in the games he played — against what the drafts expected, after any week of any season 2017 on. **More work** (`.rwflag`) marks a
projected rest-of-season share 10+ points over the drafts' for a back, 4+ for a receiver / tight end (`RW_FLAG`).

* **Build**: `tools/build_proj.py` (after `build_fb.py`; the workflow's Role Watch step, non-fatal) reads `data/fb-<y>.js`, `data/index.js`
  and `data/adp/ppr-<y>.json` and writes `data/proj-<y>.js` (`window.FBP[y]`: `meta.wfields` names each week row's fields). `--check`
  prints the backtest. Columns: **Drafts** (`mk`) = a fit of share on ADP alone (his ADP, his rank among his team's same-group players,
  the two best teammates' ADP); **Model** (`pre`) = that plus last season's share and games, rookie / draft round, age, and for a back the
  best-drafted teammate's share and round; **Proj** = a + b·share to date + c·last three + d·preseason, weights per group and per week
  (week 12's past it), each season scored with weights fitted on the others; **Pts/G** the same for PPR points.
* **ADP**: `data/adp/ppr-2016…2025.json` are Fantasy Football Calculator's last pre-kickoff week, saved by hand on 13 Oct 2026. The service
  serves only its last seven days, so 2026 has none and its comparison is the model's own preseason line. `tools/fetch_adp.py` (the
  workflow's Preseason ADP step, from 15 August; scheduled runs then only save it and publish) keeps the newest week that ended before
  kickoff (the Thursday after Labor Day) and never touches the file after — so 2027 on has a market column.
* **What it found** (2017-25, after week 3, every season held out): the market is good preseason (ADP's share vs the full season r .73;
  last season + the draft without ADP .65; both .74) — the edge is the first weeks, which beat any preseason line. Rest-of-season share r
  .87 against .79 for the drafts' (receivers .87 / .76). Backs flagged More work were 15+ point misses by the market 43% of the time (15%
  for everyone) and beat it by 15 points on average; receivers flagged beat it by 5+ 57% of the time (20%). Staff history added nothing
  to it (above). Most backfield turns are an injury or benching ahead of him, so the board is a weekly read, not a preseason one.
* **Sean's cases**: Hubbard 2024 flagged after week 3 (drafts 36%, 61% to date, projected 53%, got 82%); Irving 2024 not flagged until
  later (29% → 41% to date, +7 after week 3; got 51%); Parker Washington 2025 flagged from week 3 (+6, got 21% of targets); Christian
  Watson 2022 flagged after week 11 (his breakout was week 10). **Gibbs 2024 is not a share story** — his share held at 47-55% all
  season; his year was efficiency and touchdowns, which a usage board can't see.

## Teams (Sean, 13 Oct 2026: "an xfp/g and points/g by team by position")

The **Teams** page (`#teams`, `teamsPage()` in `fb.js`, second in the nav) lists every offense with xFP/G, FP/G and +/− (FP − xFP) for its
QBs, RBs, WRs (and FBs with the RBs) and TEs, and all four together, per team game, for a season or its last 4 / 8 games. It sums the
week rows (`w`), so a traded player counts for the team he played for that week, and a team's games are the weeks any of its players
has a row. Every cell is coloured by its rank among the 32 (red high), every column sorts, a team opens its backfield page, and a
League avg row closes the table. **A QB's xFP is his rushing xFP plus his actual passing points**, as on Leaders (passing isn't priced):
the week rows carry no passing line, so each week's passing points are his points less his rushing / receiving ones, scaled so his
weeks add up to his season's `passFP` — a single-team QB's season matches Leaders exactly. Fumbles lost and two-point plays are in FP
but not xFP, so the QB +/− is rushing over expected less fumbles. The phone nav fits five pages on one line (the 640px / 380px rules
in `fb.css`).

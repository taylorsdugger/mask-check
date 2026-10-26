# Mask Check

A small Cloudflare Worker that checks CDC data for the Quad Cities and Muscatine (Rock Island, Mercer, Scott and Muscatine counties) and tells me if COVID, flu or RSV is high or climbing. It has a dashboard page and sends an email through Resend.

It's not medical advice. Risk is relative, and this is one way to read the CDC numbers.

## How it decides

For each virus it looks at two things:

- **Level.** The CDC wastewater viral activity level at the four local plants (two in Rock Island County, Muscatine, and Davenport). It takes the highest one, but a plant's level only counts once it holds two weeks in a row. Each week uses the lower of that week and the plant's previous report (looking back two weeks in case it skipped one), since the small plants often jump a level or two for one week and drop right back. Mercer County has no plant, so it leans on Rock Island and Davenport.
- **Trend.** The CDC epidemic trend (Rt) estimate for the local health service area. If CDC didn't estimate it locally (common for RSV), it uses the Illinois and Iowa state estimates. "Growing" and "Likely Growing" count as rising.

- **Forecast.** The CDC forecast hubs' ensemble (COVID, FluSight and RSV), which combines every model submitted that week. It forecasts weekly hospital admissions per state, up to three weeks out. If admissions three weeks out are 20% or more above this week, that counts as rising too, but only once wastewater is above Very Low. The COVID ensemble forecast a rise nearly every week of summer 2026 while wastewater sat at Very Low. States under 10 admissions a week are skipped, since a couple of patients swings the percentage too much. Home uses whichever of Illinois and Iowa is rising faster.

| Wastewater level | Not rising | Rising |
|---|---|---|
| Very Low or Low | Low | Watch |
| Moderate | Elevated | High |
| High or Very High | High | High |

- Low: no mask needed.
- Watch: no mask yet, but keep one on you.
- Elevated: mask in crowded indoor places this week.
- High: mask indoors in public this week.

The overall level is the worst of the three. ER visit trends show up on the dashboard for context, but they don't change the score.

Set `CAUTION = "cautious"` in `wrangler.toml` to treat a Low wastewater level as Moderate.

## Other places

Chicago, Des Moines, Iowa City and New York City get the same score, for travel and as a possible early sign for here. They don't change the home level. When a virus is worse in one of them than at home, the email and dashboard show a heads up.

- Big cities have lots of plants, so instead of the worst plant they use the level most people there are at (each plant weighted by the people it serves).
- New York City uses the Westchester plants, just north of the Bronx, for its level. CDC has no plants in the five boroughs, and no Rt or ER trends for the city. So NYC also pulls [NYC Health's own data](https://github.com/nychealth/respiratory-illness-data): if ER visits for a virus are up two weeks in a row, that counts as rising. The NYC cards also chart citywide wastewater as a share of the past year's peak. It's raw viral load, not CDC's Very Low to Very High scale, so it doesn't set the level.

Add or change places in `OTHER_AREAS` in `src/config.ts`. Each one is a list of counties with their state and fips code.

## History and what changed

Every refresh saves that morning's rating for each place and virus to D1 (`ratings` table, see `migrations/`). The email and dashboard compare against the last morning and say what moved, like "Flu went Low → Watch" plus the reason. The subject line ends with "same as yesterday" or "changed since yesterday", so most mornings you can skip the email.

The dashboard's "Home over time" strip charts those ratings. Before the daily ratings start it shows a replay of last winter.

### The replay

`scripts/replay.ts` runs past weeks through the same `buildReport`, one rating per Monday, using only the data CDC would have had out by then. CDC only keeps the last four weeks of its trend (Rt) estimates, so the replay has wastewater and forecasts but no trend.

```bash
npm run replay -- 2025-09-01 2026-10-19 .wrangler/replay/replay.sql
npx wrangler d1 execute mask-check --remote --file .wrangler/replay/replay.sql
```

The first run, Sep 2025 to Oct 2026 at home, turned up two problems:

- The small plants (Rock Island #482 and #483, Muscatine) jump a level or two for one week and come right back. Taking the highest plant picked up every one of those, so last fall COVID flipped between Low and High week to week. Davenport's plant serves 141k people and is much smoother.
- The COVID forecast ensemble had Illinois admissions going up 26 to 74% nearly every week from late May to October 2026, while wastewater sat at Very Low. So COVID was on Watch for about 20 weeks straight.

So now a plant's level only counts once it holds two reports, and a forecast rise doesn't count while wastewater is Very Low. Weeks at each level, before and after:

| | Low | Watch | Elevated | High |
|---|---|---|---|---|
| Overall, before | 6 | 20 | 6 | 28 |
| Overall, after | 31 | 3 | 4 | 22 |
| COVID, after | 35 | 4 | 7 | 14 |
| Flu, after | 47 | 1 | 8 | 4 |
| RSV, after | 41 | 0 | 0 | 19 |

The cost shows up at the start of the winter wave. Before, flu was on Watch from late November because the forecast had admissions doubling, about four weeks ahead of High. After, flu goes from Low straight to High on Dec 29, and RSV does the same a week later, since wastewater was still Very Low while the forecasts climbed. The live check also has CDC's trend estimate, which should catch a rise like that, but the replay can't show it because CDC doesn't keep past trend estimates. Worth watching how early flu and RSV get flagged this winter.

## Why it isn't daily

All of the local CDC data updates once a week. Wastewater and Rt land on Friday, and ER visits land midweek. The plants sample two or three times a week, but CDC only publishes weekly, and about a week behind.

The Worker still emails every morning at 7:30 Central. Cron runs in UTC, so there are two triggers (12:30 and 13:30 UTC) and only the one that lands at 7:30 in Chicago sends. Both runs refresh the report.

Set `SEND_EVERY_DAY = "false"` to only get an email on Mondays and on mornings the overall level changes.

CDC's api is slow, usually 3 to 16 seconds per query and sometimes it hangs. So the cron saves the report to KV and the dashboard reads that copy. If CDC is down at send time, the email goes out with the last saved report and a warning at the top. The dashboard and email also warn when the data is more than two weeks old.

## Data

| What | CDC dataset |
|---|---|
| Wastewater viral activity level, per plant | [atcp-73re](https://data.cdc.gov/d/atcp-73re) |
| Epidemic trends and Rt, per health service area | [ahfs-x44r](https://data.cdc.gov/d/ahfs-x44r) |
| ED visit trends, per county | [rdmq-nq56](https://data.cdc.gov/d/rdmq-nq56) |
| COVID forecast ensemble, per state | [CDCgov/covid19-forecast-hub](https://github.com/CDCgov/covid19-forecast-hub) |
| Flu forecast ensemble, per state | [cdcepi/FluSight-forecast-hub](https://github.com/cdcepi/FluSight-forecast-hub) |
| RSV forecast ensemble, per state | [CDCgov/rsv-forecast-hub](https://github.com/CDCgov/rsv-forecast-hub) |

The plant ids and counties are in `src/config.ts`.

## Run it locally

```bash
npm install
cp .dev.vars.example .dev.vars   # add your Resend key and email
npx wrangler d1 migrations apply mask-check --local
npm run dev
```

- Dashboard: http://localhost:8787
- Report json: http://localhost:8787/api/report
- Rating history json: http://localhost:8787/api/history
- Email preview: http://localhost:8787/api/email-preview
- Run the morning check: `curl "http://localhost:8787/__scheduled?cron=30+12+*+*+*"`. It refreshes the saved report, and only sends a real email if it's 7am-ish in Chicago. To send one now, start dev with `npx wrangler dev --var FORCE_SEND:true` and run the same curl.

`npm test` runs the scoring tests.

## Deploy

```bash
npx wrangler kv namespace create STATE   # paste the id into wrangler.toml
npx wrangler d1 create mask-check         # paste the id into wrangler.toml
npx wrangler d1 migrations apply mask-check --remote
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put EMAIL_TO
npm run deploy
```

It sends from `mask-check@taylordugger.com`, which is verified in Resend. Resend's shared `onboarding@resend.dev` sender only sends to the address the Resend account signed up with.

After the first deploy, add `DASHBOARD_URL` under `[vars]` so the email links to the dashboard.

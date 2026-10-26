// Replays past weeks through the same scoring rules and writes them as D1
// rows, so the dashboard has last winter to compare against. One rating per
// Monday, using only the data CDC would have had out by then.
//
// CDC only keeps the last four weeks of its trend (Rt) estimates, so the
// replay has wastewater and forecasts but no trend.
//
//   npm run replay -- 2025-09-01 2026-10-19 replay.sql
//   npx wrangler d1 execute mask-check --remote --file replay.sql
import { writeFileSync } from "node:fs";
import type { WastewaterRow } from "../src/cdc";
import { daysBefore } from "../src/cdc";
import { HOME } from "../src/config";
import { parse, type ForecastRow } from "../src/forecast";
import { ratingsFor, type Rating } from "../src/history";
import { buildReport, THREATS } from "../src/score";

const HUBS = {
  covid: { repo: "CDCgov/covid19-forecast-hub", model: "CovidHub-ensemble", target: "wk inc covid hosp" },
  flu: { repo: "cdcepi/FluSight-forecast-hub", model: "FluSight-ensemble", target: "wk inc flu hosp" },
  rsv: { repo: "CDCgov/rsv-forecast-hub", model: "RSVHub-ensemble", target: "wk inc rsv hosp" },
} as const;

const [from, to, out] = process.argv.slice(2);
if (!from || !to || !out) throw new Error("usage: replay <from yyyy-mm-dd> <to yyyy-mm-dd> <out.sql>");

const states = new Set(HOME.counties.map((c) => c.fips.slice(0, 2)));
const addDays = (iso: string, days: number) => daysBefore(iso, -days);

async function wastewater(): Promise<WastewaterRow[]> {
  const url = new URL("https://data.cdc.gov/resource/atcp-73re.json");
  const servesHome = HOME.counties
    .map((c) => `(state_territory = '${c.state}' AND counties_served like '%${c.county}%')`)
    .join(" OR ");
  url.searchParams.set("$select", "week_end,site,state_territory,counties_served,population_served,pathogen_target,site_wval,site_wval_category");
  url.searchParams.set("$where", `(${servesHome}) AND week_end >= '${daysBefore(from, 70)}' AND week_end <= '${to}'`);
  url.searchParams.set("$limit", "50000");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`CDC wastewater returned ${res.status}`);
  return res.json();
}

const forecastFiles = new Map<string, Promise<ForecastRow[] | null>>();
function forecastFile(virus: keyof typeof HUBS, referenceDate: string) {
  const key = `${virus}-${referenceDate}`;
  if (!forecastFiles.has(key)) {
    const hub = HUBS[virus];
    const url = `https://raw.githubusercontent.com/${hub.repo}/main/model-output/${hub.model}/${referenceDate}-${hub.model}.csv`;
    forecastFiles.set(
      key,
      fetch(url).then(async (res) => {
        if (res.status === 404) return null;
        if (!res.ok) throw new Error(`${hub.model} ${referenceDate} returned ${res.status}`);
        return parse(await res.text(), virus, hub.target, states);
      }),
    );
  }
  return forecastFiles.get(key)!;
}

// The newest ensemble posted by Monday is for the Saturday just past. Fall
// back two more weeks, the same as the Worker does.
async function forecastsAsOf(monday: string): Promise<ForecastRow[]> {
  const rows = await Promise.all(
    (Object.keys(HUBS) as (keyof typeof HUBS)[]).map(async (virus) => {
      for (const back of [2, 9, 16]) {
        const found = await forecastFile(virus, daysBefore(monday, back));
        if (found) return found;
      }
      return [];
    }),
  );
  return rows.flat();
}

const allWastewater = await wastewater();
const mondays: string[] = [];
for (let d = from; d <= to; d = addDays(d, 7)) mondays.push(d);

const ratings: Rating[] = [];
for (const monday of mondays) {
  // Wastewater for a week ending Saturday lands about nine days later.
  const known = allWastewater.filter((r) => r.week_end >= daysBefore(monday, 70) && r.week_end <= daysBefore(monday, 7));
  const report = buildReport({ wastewater: known, rt: [], ed: [], forecasts: await forecastsAsOf(monday), nyc: null }, monday);
  ratings.push(...ratingsFor(report, monday, "replay").filter((r) => r.area === "home"));
}

const sql = (v: string | number | null) => (v === null ? "NULL" : typeof v === "number" ? String(v) : `'${v.replace(/'/g, "''")}'`);
writeFileSync(
  out,
  ratings
    .map(
      (r) =>
        `INSERT OR REPLACE INTO ratings (date, area, virus, threat, level, trend, forecast_change, source) VALUES (${[r.date, r.area, r.virus, r.threat, r.level, r.trend, r.forecast_change, r.source].map(sql).join(", ")});`,
    )
    .join("\n") + "\n",
);

const viruses = ["all", "covid", "flu", "rsv"];
console.log(["week", ...viruses].join("\t"));
for (const monday of mondays) {
  console.log([monday, ...viruses.map((v) => {
    const r = ratings.find((x) => x.date === monday && x.virus === v)!;
    return v === "all" ? r.threat : `${r.threat} (${r.level ?? "-"}${r.forecast_change === null ? "" : `, ${Math.round(r.forecast_change * 100)}%`})`;
  })].join("\t"));
}
console.log("\nweeks at each level");
for (const v of viruses) {
  const counts = THREATS.map((t) => `${t} ${ratings.filter((r) => r.virus === v && r.threat === t).length}`);
  console.log(`${v}\t${counts.join("\t")}`);
}

import { ALL_AREAS, HOME } from "./config";
import { fetchForecasts, type ForecastRow } from "./forecast";
import { fetchNyc, type NycData } from "./nyc";

// All three are Socrata datasets on data.cdc.gov, updated once a week.
// Wastewater viral activity level, per treatment plant, per week.
const WASTEWATER = "atcp-73re";
// Epidemic trends (Rt category), per health service area and per state.
const RT = "ahfs-x44r";
// ED visit trends, per county (rolled up to its health service area).
const ED = "rdmq-nq56";

export interface WastewaterRow {
  week_end: string;
  site: string;
  state_territory: string;
  counties_served: string;
  population_served?: string;
  pathogen_target: string;
  site_wval?: string;
  site_wval_category?: string;
}

export interface RtRow {
  origin_date: string;
  estimate_level: "HSA" | "state";
  county_code?: string;
  hsa_name?: string;
  state_name: string;
  disease: string;
  category: string;
  p_growing?: string;
}

export interface EdRow {
  week_end: string;
  county: string;
  hsa: string;
  [trend: string]: string;
}

export interface CdcData {
  wastewater: WastewaterRow[];
  rt: RtRow[];
  ed: EdRow[];
  // null when the forecast hubs couldn't be reached. The rest still works.
  forecasts: ForecastRow[] | null;
  // null when NYC Health couldn't be reached, or no area uses it.
  nyc: NycData | null;
}

const quoted = (values: string[]) => values.map((v) => `'${v}'`).join(",");

async function query<T>(dataset: string, params: Record<string, string>): Promise<T[]> {
  const url = new URL(`https://data.cdc.gov/resource/${dataset}.json`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  // CDC's api often takes several seconds and sometimes hangs, so give each
  // query a few tries.
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(25_000) });
      if (!res.ok) throw new Error(`CDC ${dataset} returned ${res.status}: ${await res.text()}`);
      return await res.json();
    } catch (err) {
      if (attempt === 3) throw err;
    }
  }
}

export async function fetchCdcData(today: string): Promise<CdcData> {
  const since = daysBefore(today, 70);
  const counties = ALL_AREAS.flatMap((a) => a.counties);
  const states = quoted([...new Set(counties.map((c) => c.state))]);
  const servesCounty = counties
    .map((c) => `(state_territory = '${c.state}' AND counties_served like '%${c.county}%')`)
    .join(" OR ");
  const [wastewater, rt, ed, forecasts, nyc] = await Promise.all([
    query<WastewaterRow>(WASTEWATER, {
      $select: "week_end,site,state_territory,counties_served,population_served,pathogen_target,site_wval,site_wval_category",
      $where: `(${servesCounty}) AND week_end >= '${since}'`,
      $order: "week_end",
      $limit: "5000",
    }),
    query<RtRow>(RT, {
      $select: "origin_date,estimate_level,county_code,hsa_name,state_name,disease,category,p_growing",
      // The dataset has had rows with typo'd future origin dates, so cap at today.
      $where:
        `horizon = '0' AND origin_date >= '${daysBefore(today, 21)}' AND origin_date <= '${today}'` +
        ` AND (county_code in (${quoted(counties.map((c) => c.fips))}) OR (estimate_level = 'state' AND state_name in (${states})))`,
      $limit: "5000",
    }),
    query<EdRow>(ED, {
      $where: `fips in (${quoted(HOME.counties.map((c) => c.fips))}) AND week_end >= '${daysBefore(today, 21)}'`,
      $order: "week_end DESC",
      $limit: "100",
    }),
    fetchForecasts(today, [...new Set(counties.map((c) => c.fips.slice(0, 2)))]).catch((err) => {
      console.error(err);
      return null;
    }),
    ALL_AREAS.some((a) => a.nycHealth)
      ? fetchNyc().catch((err) => {
          console.error(err);
          return null;
        })
      : null,
  ]);
  return { wastewater, rt, ed, forecasts, nyc };
}

export function daysBefore(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

import type { Virus } from "./config";

// The ensemble from each CDC forecast hub: CDC's combination of every model
// submitted that week. Files are named for a Saturday reference date and get
// posted a few days before it.
const HUBS: Record<Virus, { repo: string; model: string; target: string }> = {
  covid: { repo: "CDCgov/covid19-forecast-hub", model: "CovidHub-ensemble", target: "wk inc covid hosp" },
  flu: { repo: "cdcepi/FluSight-forecast-hub", model: "FluSight-ensemble", target: "wk inc flu hosp" },
  rsv: { repo: "CDCgov/rsv-forecast-hub", model: "RSVHub-ensemble", target: "wk inc rsv hosp" },
};

export interface ForecastRow {
  virus: Virus;
  stateFips: string;
  referenceDate: string;
  horizon: number;
  endDate: string;
  median: number;
}

export async function fetchForecasts(today: string, stateFips: string[]): Promise<ForecastRow[]> {
  const rows = await Promise.all(
    (Object.keys(HUBS) as Virus[]).map((virus) => latestForecast(virus, today, new Set(stateFips))),
  );
  return rows.flat();
}

async function latestForecast(virus: Virus, today: string, states: Set<string>): Promise<ForecastRow[]> {
  const hub = HUBS[virus];
  for (const date of saturdaysNear(today)) {
    const url = `https://raw.githubusercontent.com/${hub.repo}/main/model-output/${hub.model}/${date}-${hub.model}.csv`;
    const res = await fetch(url, { signal: AbortSignal.timeout(25_000) });
    if (res.status === 404) continue;
    if (!res.ok) throw new Error(`${hub.model} ${date} returned ${res.status}`);
    return parse(await res.text(), virus, hub.target, states);
  }
  return [];
}

// Next Saturday first, since that week's file may already be posted, then
// back a few weeks.
function saturdaysNear(today: string): string[] {
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + ((6 - date.getUTCDay() + 7) % 7));
  return [0, 7, 14, 21].map((back) => {
    const d = new Date(date);
    d.setUTCDate(d.getUTCDate() - back);
    return d.toISOString().slice(0, 10);
  });
}

export function parse(csv: string, virus: Virus, target: string, states: Set<string>): ForecastRow[] {
  const rows: ForecastRow[] = [];
  const marker = `,${target},`;
  for (const line of csv.split("\n")) {
    if (!line.includes(marker) || !line.includes(",quantile,0.5,")) continue;
    const [referenceDate, location, horizon, , endDate, , , value] = line.split(",");
    if (!states.has(location)) continue;
    rows.push({ virus, stateFips: location, referenceDate, horizon: Number(horizon), endDate, median: Number(value) });
  }
  return rows;
}

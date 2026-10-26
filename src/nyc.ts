import type { Virus } from "./config";

// NYC's health department publishes its own weekly respiratory data, which
// fills in for the CDC data the city doesn't have.
const BASE = "https://raw.githubusercontent.com/nychealth/respiratory-illness-data/main/data";

const ED_FILES: Record<Virus, { file: string; column: string }> = {
  covid: { file: "ED_data_COVID-19.csv", column: "COVID-19 visits overall" },
  flu: { file: "ED_data_influenza.csv", column: "Influenza visits overall" },
  rsv: { file: "ED_data_RSV.csv", column: "RSV visits overall" },
};

// CDC's flu wastewater is flu A only. NYC splits A and B, so add them for a
// fuller picture of flu.
const WASTEWATER_COLUMNS: Record<Virus, string[]> = {
  covid: ["SARS-CoV-2 viral load"],
  flu: ["Flu A viral load", "Flu B viral load"],
  rsv: ["RSV viral load"],
};

export interface WeekValue {
  week: string;
  value: number;
}

export interface NycData {
  // Share of ER visits for each virus, citywide.
  ed: Record<Virus, WeekValue[]>;
  // Citywide wastewater viral load, in NYC Health's own units.
  wastewater: Record<Virus, WeekValue[]>;
}

export async function fetchNyc(): Promise<NycData> {
  const viruses = Object.keys(ED_FILES) as Virus[];
  const [wastewaterCsv, ...edCsvs] = await Promise.all([
    get("Wastewater_viral_load_data.csv"),
    ...viruses.map((v) => get(ED_FILES[v].file)),
  ]);
  const wastewater = parseCsv(wastewaterCsv);
  return {
    ed: Object.fromEntries(
      viruses.map((v, i) => [v, series(parseCsv(edCsvs[i]), [ED_FILES[v].column])]),
    ) as NycData["ed"],
    wastewater: Object.fromEntries(
      viruses.map((v) => [v, series(wastewater, WASTEWATER_COLUMNS[v])]),
    ) as NycData["wastewater"],
  };
}

async function get(file: string): Promise<string> {
  const res = await fetch(`${BASE}/${file}`, { signal: AbortSignal.timeout(25_000) });
  if (!res.ok) throw new Error(`NYC Health ${file} returned ${res.status}`);
  return res.text();
}

export function parseCsv(csv: string): Record<string, string>[] {
  const [header, ...lines] = csv.trim().split("\n");
  const unquote = (cell: string) => cell.trim().replace(/^"|"$/g, "");
  const columns = header.split(",").map(unquote);
  return lines.map((line) => Object.fromEntries(line.split(",").map((cell, i) => [columns[i], unquote(cell)])));
}

function series(rows: Record<string, string>[], columns: string[]): WeekValue[] {
  return rows
    .map((r) => ({ week: r.date, value: columns.reduce((sum, c) => sum + Number(r[c]), 0) }))
    .filter((p) => p.week && Number.isFinite(p.value))
    .sort((a, b) => a.week.localeCompare(b.week));
}

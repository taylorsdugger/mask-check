import type { CdcData, WastewaterRow } from "./cdc";
import { daysBefore } from "./cdc";
import { HOME, OTHER_AREAS, VIRUSES, type Area, type Virus } from "./config";
import type { ForecastRow } from "./forecast";

export const LEVELS = ["Very Low", "Low", "Moderate", "High", "Very High"];
export const THREATS = ["Low", "Watch", "Elevated", "High"] as const;
export type Threat = (typeof THREATS)[number];

export const ADVICE: Record<Threat, string> = {
  Low: "No mask needed.",
  Watch: "No mask needed yet, but keep one on you. It's starting to climb.",
  Elevated: "Mask in crowded indoor places this week.",
  High: "Mask indoors in public this week.",
};

const TREND_RANK: Record<string, number> = {
  Growing: 2,
  "Likely Growing": 1,
  "Not Changing": 0,
  "Likely Declining": -1,
  Declining: -2,
};

// The forecast counts as rising when hospital admissions three weeks out are
// at least this much above this week. Below the floor, a couple of extra
// patients swings the percentage too much to mean anything.
export const FORECAST_RISE = 0.2;
const FORECAST_MIN_ADMISSIONS = 10;

export interface Forecast {
  state: string;
  from: number;
  to: number;
  change: number;
  endDate: string;
  referenceDate: string;
}

export interface SiteLevel {
  label: string;
  wval: number | null;
  category: string;
}

export interface VirusReport {
  id: Virus;
  name: string;
  threat: Threat;
  advice: string;
  reason: string;
  why: string;
  level: string | null;
  levelWeek: string | null;
  sites: SiteLevel[];
  history: { week: string; wval: number; category: string }[];
  trend: string | null;
  trendArea: string | null;
  trendWeek: string | null;
  forecast: Forecast | null;
  edTrends: { area: string; trend: string }[];
}

export interface AreaReport {
  id: string;
  name: string;
  note?: string;
  aggregate: Area["level"];
  threat: Threat;
  advice: string;
  viruses: VirusReport[];
}

export interface Report {
  generatedAt: string;
  threat: Threat;
  headline: string;
  advice: string;
  caution: string;
  viruses: VirusReport[];
  areas: AreaReport[];
  headsUp: string[];
  warnings: string[];
}

export function buildReport(data: CdcData, today: string, caution = "normal"): Report {
  const home = scoreArea(HOME, data, caution);
  const areas = OTHER_AREAS.map((area) => scoreArea(area, { ...data, ed: [] }, caution));

  const warnings: string[] = [];
  const staleBefore = daysBefore(today, 16);
  for (const v of home.viruses) {
    if (!v.levelWeek) warnings.push(`No ${v.name} wastewater data in the last 10 weeks.`);
    else if (v.levelWeek < staleBefore) warnings.push(`${v.name} wastewater is stale. Last week reported: ${v.levelWeek}.`);
    if (!v.trend) warnings.push(`No ${v.name} trend estimate from CDC in the last 3 weeks.`);
    if (v.forecast && v.forecast.referenceDate < daysBefore(today, 21)) {
      warnings.push(`The ${v.name} forecast is stale. Latest is for the week of ${v.forecast.referenceDate}.`);
    }
  }
  if (!data.forecasts) warnings.push("Couldn't load the CDC forecast hubs, so forecasts are left out.");

  const drivers = home.viruses.filter((v) => v.threat === home.threat);
  const headline =
    home.threat === "Low"
      ? "Low: COVID, flu and RSV are all quiet"
      : `${home.threat}: ${drivers.map((v) => v.name).join(", ")}`;

  return {
    generatedAt: new Date().toISOString(),
    threat: home.threat,
    headline,
    advice: ADVICE[home.threat],
    caution,
    viruses: home.viruses,
    areas,
    headsUp: headsUp(home, areas),
    warnings,
  };
}

// Bigger cities can be an early sign of what's coming, so call out any virus
// that's worse somewhere else than it is at home.
function headsUp(home: AreaReport, areas: AreaReport[]): string[] {
  return home.viruses.flatMap((homeVirus) => {
    const worse = areas.filter((a) => {
      const there = a.viruses.find((v) => v.id === homeVirus.id)!;
      return THREATS.indexOf(there.threat) > THREATS.indexOf(homeVirus.threat);
    });
    if (!worse.length) return [];
    const places = worse.map((a) => `${a.name} (${a.viruses.find((v) => v.id === homeVirus.id)!.threat})`);
    return [`${homeVirus.name} is worse in ${places.join(", ")} than here (${homeVirus.threat}).`];
  });
}

function scoreArea(area: Area, data: CdcData, caution: string): AreaReport {
  const states = new Set(area.counties.map((c) => c.state));
  const fips = new Set(area.counties.map((c) => c.fips));
  const stateNames = new Map(area.counties.map((c) => [c.fips.slice(0, 2), c.state]));
  const areaData: CdcData = {
    wastewater: data.wastewater.filter((r) =>
      area.counties.some((c) => r.state_territory === c.state && r.counties_served.includes(c.county)),
    ),
    rt: data.rt.filter((r) => (r.estimate_level === "HSA" ? fips.has(r.county_code!) : states.has(r.state_name))),
    ed: data.ed,
    forecasts: (data.forecasts ?? []).filter((f) => stateNames.has(f.stateFips)),
  };
  const viruses = VIRUSES.map((virus) => scoreVirus(virus, areaData, area.level, caution, stateNames));
  const threat = THREATS[Math.max(...viruses.map((v) => THREATS.indexOf(v.threat)))];
  return { id: area.id, name: area.name, note: area.note, aggregate: area.level, threat, advice: ADVICE[threat], viruses };
}

function scoreVirus(
  virus: (typeof VIRUSES)[number],
  data: CdcData,
  aggregate: Area["level"],
  caution: string,
  stateNames: Map<string, string>,
): VirusReport {
  const rows = data.wastewater.filter((r) => r.pathogen_target === virus.wastewater && r.site_wval_category);

  const levelWeek = rows.reduce<string | null>((max, r) => (!max || r.week_end > max ? r.week_end : max), null);
  const latest = rows.filter((r) => r.week_end === levelWeek);
  const sites = latest
    .map((r) => ({
      label: `${r.counties_served} #${r.site.replace("ID:", "")} · ${formatPeople(Number(r.population_served))}`,
      wval: r.site_wval ? Number(r.site_wval) : null,
      category: r.site_wval_category!,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const levelRank = latest.length
    ? aggregate === "highest"
      ? Math.max(...latest.map((r) => LEVELS.indexOf(r.site_wval_category!)))
      : typicalRank(latest)
    : null;
  const level = levelRank === null ? null : LEVELS[levelRank];

  const history = weeklyHistory(rows, aggregate);

  const trend = pickTrend(data, virus.rt);
  const forecast = pickForecast(data.forecasts ?? [], virus.id, stateNames);
  const trendRising = trend !== null && TREND_RANK[trend.category] > 0;
  const forecastRising = forecast !== null && forecast.change >= FORECAST_RISE;
  const growing = trendRising || forecastRising;

  const effectiveRank = caution === "cautious" && levelRank === 1 ? 2 : levelRank;
  const threat = THREATS[threatIndex(effectiveRank, growing)];

  const levelText = level ? `wastewater ${level.toLowerCase()}` : "no wastewater data";
  const trendText = trend ? trend.category.toLowerCase() : "trend unknown";
  const forecastText = forecast ? `, forecast ${forecast.change >= 0 ? "up" : "down"} ${Math.abs(Math.round(forecast.change * 100))}%` : "";

  const edTrends = data.ed
    .filter((r) => r.week_end === data.ed[0]?.week_end && r[virus.ed] && r[virus.ed] !== "Data Unavailable")
    .map((r) => ({ area: r.hsa, trend: r[virus.ed] }))
    .filter((t, i, all) => all.findIndex((o) => o.area === t.area) === i);

  return {
    id: virus.id,
    name: virus.name,
    threat,
    advice: ADVICE[threat],
    reason: `${virus.name} ${levelText}, ${trendText}${forecastText}`,
    why: explain(level, caution === "cautious" && levelRank === 1, trendRising ? trend : null, forecastRising ? forecast : null),
    level,
    levelWeek,
    sites,
    history,
    trend: trend?.category ?? null,
    trendArea: trend?.area ?? null,
    trendWeek: trend?.week ?? null,
    forecast,
    edTrends,
  };
}

function explain(
  level: string | null,
  cautionBump: boolean,
  risingTrend: { category: string } | null,
  risingForecast: Forecast | null,
): string {
  const levelPart = level ? `Wastewater is ${level.toLowerCase()}` : "There's no wastewater data";
  const bump = cautionBump ? " (cautious mode counts that as moderate)" : "";
  const reasons = [
    risingTrend && `CDC's trend estimate says ${risingTrend.category.toLowerCase()}`,
    risingForecast &&
      `hospital admissions are forecast up ${Math.round(risingForecast.change * 100)}% by ${shortDate(risingForecast.endDate)}`,
  ].filter(Boolean);
  return reasons.length ? `${levelPart}${bump} and rising. ${capitalize(reasons.join(", and "))}.` : `${levelPart}${bump} and not rising.`;
}

const capitalize = (s: string) => s[0].toUpperCase() + s.slice(1);
const shortDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export function threatIndex(levelRank: number | null, growing: boolean): number {
  if (levelRank !== null && levelRank >= 3) return 3;
  if (levelRank === 2) return growing ? 3 : 2;
  return growing ? 1 : 0;
}

// The level the middle person in the area is at, weighting each plant by the
// people it serves.
export function typicalRank(rows: WastewaterRow[]): number {
  const sites = rows
    .map((r) => ({ rank: LEVELS.indexOf(r.site_wval_category!), people: Number(r.population_served) || 1 }))
    .sort((a, b) => a.rank - b.rank);
  const half = sites.reduce((sum, s) => sum + s.people, 0) / 2;
  let seen = 0;
  for (const s of sites) {
    seen += s.people;
    if (seen >= half) return s.rank;
  }
  return sites[sites.length - 1].rank;
}

function weeklyHistory(rows: WastewaterRow[], aggregate: Area["level"]) {
  const byWeek = new Map<string, { max: number; weighted: number; people: number; rows: WastewaterRow[] }>();
  for (const r of rows) {
    const wval = Number(r.site_wval);
    if (!Number.isFinite(wval)) continue;
    const people = Number(r.population_served) || 1;
    const week = byWeek.get(r.week_end) ?? { max: 0, weighted: 0, people: 0, rows: [] };
    week.rows.push(r);
    week.max = Math.max(week.max, wval);
    week.weighted += wval * people;
    week.people += people;
    byWeek.set(r.week_end, week);
  }
  return [...byWeek]
    .map(([week, w]) => ({
      week,
      wval: aggregate === "highest" ? w.max : Math.round((w.weighted / w.people) * 100) / 100,
      category:
        LEVELS[
          aggregate === "highest"
            ? Math.max(...w.rows.map((r) => LEVELS.indexOf(r.site_wval_category!)))
            : typicalRank(w.rows)
        ],
    }))
    .slice(-10);
}

function formatPeople(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "population unknown";
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M people` : `${Math.round(n / 1000)}k people`;
}

// The local health service area estimate is the one we want. CDC often skips
// RSV at that level, so fall back to the state estimate. Across areas, take
// whichever is growing fastest.
function pickTrend(data: CdcData, disease: string) {
  const rows = data.rt.filter((r) => r.disease === disease && r.category in TREND_RANK);
  const latest = rows.reduce<string | null>((max, r) => (!max || r.origin_date > max ? r.origin_date : max), null);
  const current = rows.filter((r) => r.origin_date === latest);
  const local = current.filter((r) => r.estimate_level === "HSA");
  const pool = local.length ? local : current;
  if (!pool.length) return null;
  const pick = pool.reduce((best, r) => (TREND_RANK[r.category] > TREND_RANK[best.category] ? r : best));
  return {
    category: pick.category,
    area: pick.estimate_level === "HSA" ? pick.hsa_name! : pick.state_name,
    week: pick.origin_date,
  };
}

// Compare this week's admissions to the furthest week out, per state, and
// take whichever state is rising fastest.
function pickForecast(rows: ForecastRow[], virus: Virus, stateNames: Map<string, string>): Forecast | null {
  const forecasts: Forecast[] = [];
  for (const [stateFips, state] of stateNames) {
    const mine = rows.filter((r) => r.virus === virus && r.stateFips === stateFips);
    const now = mine.find((r) => r.horizon === 0);
    const last = mine.reduce<ForecastRow | null>((max, r) => (!max || r.horizon > max.horizon ? r : max), null);
    if (!now || !last || last.horizon <= 0 || now.median < FORECAST_MIN_ADMISSIONS) continue;
    forecasts.push({
      state,
      from: Math.round(now.median),
      to: Math.round(last.median),
      change: last.median / now.median - 1,
      endDate: last.endDate,
      referenceDate: now.referenceDate,
    });
  }
  if (!forecasts.length) return null;
  return forecasts.reduce((best, f) => (f.change > best.change ? f : best));
}

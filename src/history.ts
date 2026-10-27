import type { Report } from "./score";

// One rating per day, place and virus. Virus "all" is the place's overall
// rating. "replay" rows were scored later from past CDC data by
// scripts/replay.ts, "daily" rows were scored that morning.
export interface Rating {
  date: string;
  area: string;
  virus: string;
  threat: string;
  level: string | null;
  trend: string | null;
  forecast_change: number | null;
  source: "daily" | "replay";
}

export interface Changes {
  since: string;
  home: string[];
  areas: string[];
}

export function ratingsFor(report: Report, date: string, source: Rating["source"] = "daily"): Rating[] {
  const places = [{ id: "home", threat: report.threat, viruses: report.viruses }, ...report.areas];
  return places.flatMap((place) => [
    { date, area: place.id, virus: "all", threat: place.threat, level: null, trend: null, forecast_change: null, source },
    ...place.viruses.map((v) => ({
      date,
      area: place.id,
      virus: v.id,
      threat: v.threat,
      level: v.level,
      trend: v.trend,
      forecast_change: v.forecast ? Math.round(v.forecast.change * 1000) / 1000 : null,
      source,
    })),
  ]);
}

export function changesSince(previous: Rating[], report: Report): Changes | null {
  if (!previous.length) return null;
  const before = (area: string, virus: string) =>
    previous.find((r) => r.area === area && r.virus === virus)?.threat;

  const home = report.viruses.flatMap((v) => {
    const was = before("home", v.id);
    return was && was !== v.threat ? [`${v.name} went ${was} → ${v.threat}. ${v.why}`] : [];
  });
  const areas = report.areas.flatMap((a) => {
    const moved = a.viruses.flatMap((v) => {
      const was = before(a.id, v.id);
      return was && was !== v.threat ? [`${v.name} ${was} → ${v.threat}`] : [];
    });
    return moved.length ? [`${a.name}: ${moved.join(", ")}.`] : [];
  });
  return { since: previous[0].date, home, areas };
}

export const threatsByPlace = (ratings: Rating[]): Record<string, string> =>
  Object.fromEntries(ratings.map((r) => [`${r.area}/${r.virus}`, r.threat]));

export function threatsChanged(before: Record<string, string> | undefined, now: Record<string, string>): boolean {
  if (!before) return true;
  return Object.entries(now).some(([key, threat]) => before[key] !== threat);
}

export async function previousRatings(db: D1Database, date: string): Promise<Rating[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM ratings WHERE source = 'daily' AND date = (
         SELECT max(date) FROM ratings WHERE source = 'daily' AND date < ?1)`,
    )
    .bind(date)
    .all<Rating>();
  return results;
}

export async function saveRatings(db: D1Database, rows: Rating[]): Promise<void> {
  const insert = db.prepare(
    `INSERT OR REPLACE INTO ratings (date, area, virus, threat, level, trend, forecast_change, source)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
  );
  await db.batch(
    rows.map((r) => insert.bind(r.date, r.area, r.virus, r.threat, r.level, r.trend, r.forecast_change, r.source)),
  );
}

export async function homeHistory(db: D1Database, since: string): Promise<Rating[]> {
  const { results } = await db
    .prepare("SELECT * FROM ratings WHERE area = 'home' AND date >= ?1 ORDER BY date")
    .bind(since)
    .all<Rating>();
  return results;
}

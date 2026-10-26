import { describe, expect, it } from "vitest";
import type { CdcData, WastewaterRow } from "../src/cdc";
import { buildReport, threatIndex, typicalRank } from "../src/score";

const PLACES: Record<string, { state: string; county: string; people: string }> = {
  "ID:482": { state: "Illinois", county: "Rock Island", people: "25202" },
  "ID:2212": { state: "Iowa", county: "Scott", people: "141344" },
  "ID:413": { state: "Illinois", county: "Cook", people: "1134897" },
  "ID:419": { state: "Illinois", county: "Cook", people: "1263110" },
  "ID:418": { state: "Illinois", county: "Cook", people: "13098" },
};

const ww = (site: string, pathogen: string, week: string, wval: string, category: string): WastewaterRow => ({
  week_end: week,
  site,
  state_territory: PLACES[site].state,
  counties_served: PLACES[site].county,
  population_served: PLACES[site].people,
  pathogen_target: pathogen,
  site_wval: wval,
  site_wval_category: category,
});

const rt = (disease: string, category: string, where: "home" | "cook" | "Illinois" = "home") => ({
  origin_date: "2026-10-20",
  estimate_level: where === "Illinois" ? ("state" as const) : ("HSA" as const),
  county_code: where === "home" ? "17161" : where === "cook" ? "17031" : undefined,
  hsa_name: where === "home" ? "Rock Island (Moline), IL - Henry, IL" : where === "cook" ? "Cook (Chicago), IL - DuPage, IL" : undefined,
  state_name: "Illinois",
  disease,
  category,
});

const data = (overrides: Partial<CdcData> = {}): CdcData => ({
  wastewater: [
    ww("ID:482", "SARS-CoV-2", "2026-10-10", "2.8", "Low"),
    ww("ID:482", "SARS-CoV-2", "2026-10-17", "1.9", "Very Low"),
    ww("ID:2212", "SARS-CoV-2", "2026-10-17", "3.2", "Low"),
    ww("ID:482", "Influenza A virus", "2026-10-17", "1.0", "Very Low"),
    ww("ID:482", "RSV", "2026-10-17", "1.0", "Very Low"),
    ww("ID:413", "RSV", "2026-10-17", "6.0", "Moderate"),
    ww("ID:419", "RSV", "2026-10-17", "5.5", "Moderate"),
    ww("ID:418", "RSV", "2026-10-17", "12.0", "Very High"),
  ],
  rt: [
    rt("COVID-19", "Not Changing"),
    rt("Influenza", "Growing"),
    rt("RSV", "Not Estimated"),
    rt("RSV", "Growing", "Illinois"),
    rt("RSV", "Not Changing", "cook"),
  ],
  ed: [],
  forecasts: [],
  ...overrides,
});

const fc = (virus: "covid" | "flu" | "rsv", stateFips: string, now: number, later: number) => [
  { virus, stateFips, referenceDate: "2026-10-24", horizon: 0, endDate: "2026-10-24", median: now },
  { virus, stateFips, referenceDate: "2026-10-24", horizon: 3, endDate: "2026-11-14", median: later },
];

describe("threatIndex", () => {
  it("maps level and trend to a threat", () => {
    expect(threatIndex(0, false)).toBe(0);
    expect(threatIndex(1, true)).toBe(1);
    expect(threatIndex(2, false)).toBe(2);
    expect(threatIndex(2, true)).toBe(3);
    expect(threatIndex(4, false)).toBe(3);
    expect(threatIndex(null, true)).toBe(1);
  });
});

describe("typicalRank", () => {
  it("takes the level of the middle person, not the worst plant", () => {
    const cook = data().wastewater.filter((r) => r.counties_served === "Cook");
    expect(typicalRank(cook)).toBe(2);
  });
});

describe("buildReport", () => {
  it("uses the highest plant level at home from the newest week", () => {
    const covid = buildReport(data(), "2026-10-26").viruses.find((v) => v.id === "covid")!;
    expect(covid.level).toBe("Low");
    expect(covid.levelWeek).toBe("2026-10-17");
    expect(covid.sites).toHaveLength(2);
    expect(covid.history).toEqual([
      { week: "2026-10-10", wval: 2.8, category: "Low" },
      { week: "2026-10-17", wval: 3.2, category: "Low" },
    ]);
  });

  it("flags a rising virus as Watch even when the level is very low", () => {
    const report = buildReport(data(), "2026-10-26");
    expect(report.viruses.find((v) => v.id === "flu")!.threat).toBe("Watch");
    expect(report.threat).toBe("Watch");
    expect(report.headline).toContain("Flu");
  });

  it("falls back to the state trend when the local one isn't estimated", () => {
    const rsv = buildReport(data(), "2026-10-26").viruses.find((v) => v.id === "rsv")!;
    expect(rsv.trend).toBe("Growing");
    expect(rsv.trendArea).toBe("Illinois");
  });

  it("scores other areas on their own plants and trends", () => {
    const report = buildReport(data(), "2026-10-26");
    const chicago = report.areas.find((a) => a.id === "chicago")!;
    const rsv = chicago.viruses.find((v) => v.id === "rsv")!;
    expect(rsv.level).toBe("Moderate");
    expect(rsv.trendArea).toBe("Cook (Chicago), IL - DuPage, IL");
    expect(rsv.threat).toBe("Elevated");
    expect(report.viruses.find((v) => v.id === "rsv")!.sites.map((s) => s.label)).toEqual(["Rock Island #482 · 25k people"]);
  });

  it("calls out a virus that's worse in another area", () => {
    expect(buildReport(data(), "2026-10-26").headsUp).toEqual(["RSV is worse in Chicago (Elevated) than here (Watch)."]);
  });

  it("counts a forecast rise of 20% or more as rising", () => {
    const report = buildReport(data({ forecasts: [...fc("covid", "17", 80, 104), ...fc("covid", "19", 14, 15)] }), "2026-10-26");
    const covid = report.viruses.find((v) => v.id === "covid")!;
    expect(covid.trend).toBe("Not Changing");
    expect(covid.forecast).toMatchObject({ state: "Illinois", from: 80, to: 104, endDate: "2026-11-14" });
    expect(covid.threat).toBe("Watch");
    expect(covid.reason).toBe("COVID wastewater low, not changing, forecast up 30%");
    expect(covid.why).toBe("Wastewater is low and rising. Hospital admissions are forecast up 30% by Nov 14.");
  });

  it("explains a rating in plain words", () => {
    const report = buildReport(data(), "2026-10-26");
    expect(report.viruses.find((v) => v.id === "covid")!.why).toBe("Wastewater is low and not rising.");
    expect(report.viruses.find((v) => v.id === "flu")!.why).toBe("Wastewater is very low and rising. CDC's trend estimate says growing.");
  });

  it("ignores a smaller forecast rise", () => {
    const covid = buildReport(data({ forecasts: fc("covid", "17", 80, 92) }), "2026-10-26").viruses.find((v) => v.id === "covid")!;
    expect(covid.threat).toBe("Low");
  });

  it("skips states with too few admissions to trust the percentage", () => {
    const covid = buildReport(data({ forecasts: fc("covid", "19", 5, 8) }), "2026-10-26").viruses.find((v) => v.id === "covid")!;
    expect(covid.forecast).toBeNull();
    expect(covid.threat).toBe("Low");
  });

  it("uses each area's own state forecast", () => {
    const report = buildReport(data({ forecasts: fc("covid", "36", 300, 400) }), "2026-10-26");
    expect(report.viruses.find((v) => v.id === "covid")!.forecast).toBeNull();
    expect(report.areas.find((a) => a.id === "nyc")!.viruses.find((v) => v.id === "covid")!.forecast?.state).toBe("New York");
  });

  it("warns when the forecast hubs can't be reached", () => {
    expect(buildReport(data({ forecasts: null }), "2026-10-26").warnings).toContain(
      "Couldn't load the CDC forecast hubs, so forecasts are left out.",
    );
  });

  it("treats Low as Moderate in cautious mode", () => {
    const covid = buildReport(data(), "2026-10-26", "cautious").viruses.find((v) => v.id === "covid")!;
    expect(covid.threat).toBe("Elevated");
  });

  it("warns when wastewater is stale", () => {
    expect(buildReport(data(), "2026-11-20").warnings.some((w) => w.includes("stale"))).toBe(true);
  });

  it("reports Low when nothing is up", () => {
    const report = buildReport(data({ rt: [] }), "2026-10-26");
    expect(report.threat).toBe("Low");
    expect(report.warnings).toContain("No COVID trend estimate from CDC in the last 3 weeks.");
  });
});

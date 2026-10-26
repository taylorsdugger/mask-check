import { describe, expect, it } from "vitest";
import type { CdcData, WastewaterRow } from "../src/cdc";
import type { NycData } from "../src/nyc";
import { buildReport, direction, threatIndex, typicalRank } from "../src/score";

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
  nyc: null,
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

describe("direction", () => {
  const pts = (values: number[]) => values.map((value, i) => ({ week: String(i), value }));
  it("needs two weeks the same way in a row", () => {
    expect(direction(pts([1, 2, 3]))).toBe("Increasing");
    expect(direction(pts([3, 2, 1]))).toBe("Decreasing");
    expect(direction(pts([1, 3, 2]))).toBe("No Change");
    expect(direction(pts([1, 2]))).toBeNull();
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

  it("labels plants by place name when the county has one", () => {
    const covid = buildReport(data(), "2026-10-26").viruses.find((v) => v.id === "covid")!;
    expect(covid.sites.map((s) => s.label)).toEqual(["Davenport #2212 · 141k people", "Rock Island #482 · 25k people"]);
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

  it("doesn't count a forecast rise while wastewater is very low", () => {
    const flu = buildReport(data({ rt: [], forecasts: fc("flu", "17", 80, 120) }), "2026-10-26").viruses.find((v) => v.id === "flu")!;
    expect(flu.level).toBe("Very Low");
    expect(flu.threat).toBe("Low");
    expect(flu.why).toBe(
      "Wastewater is very low and not rising. Hospital admissions are forecast up 50%, but that doesn't count while wastewater is very low.",
    );
  });

  it("only counts a plant's jump once it holds two weeks", () => {
    const jump = (before: string) =>
      data({
        wastewater: [
          ww("ID:482", "SARS-CoV-2", "2026-10-10", "5.0", before),
          ww("ID:482", "SARS-CoV-2", "2026-10-17", "9.0", "High"),
          ww("ID:2212", "SARS-CoV-2", "2026-10-17", "3.2", "Low"),
        ],
      });
    const once = buildReport(jump("Very Low"), "2026-10-26").viruses.find((v) => v.id === "covid")!;
    expect(once.level).toBe("Low");
    expect(once.threat).toBe("Low");
    expect(once.sites.find((s) => s.label.startsWith("Rock Island"))!.category).toBe("High");
    expect(once.why).toBe("Wastewater is low and not rising. It jumped to high this week, but a jump only counts once it holds two weeks.");

    const twice = buildReport(jump("High"), "2026-10-26").viruses.find((v) => v.id === "covid")!;
    expect(twice.level).toBe("High");
    expect(twice.threat).toBe("High");
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

  it("counts NYC's ER visits rising two weeks in a row as rising for NYC only", () => {
    const weeks = (values: number[]) => values.map((value, i) => ({ week: `2026-10-${String(3 + i * 7).padStart(2, "0")}`, value }));
    const nyc: NycData = {
      ed: { covid: weeks([0.56, 0.45, 0.38]), flu: weeks([0.32, 0.4, 0.48]), rsv: weeks([0.03, 0.04, 0.04]) },
      wastewater: { covid: weeks([40, 20, 10]), flu: weeks([1, 2, 4]), rsv: weeks([5, 5, 5]) },
    };
    const report = buildReport(data({ nyc }), "2026-10-26");
    const nycFlu = report.areas.find((a) => a.id === "nyc")!.viruses.find((v) => v.id === "flu")!;
    expect(nycFlu.threat).toBe("Watch");
    expect(nycFlu.why).toBe("There's no wastewater data and rising. NYC's ER visits are up two weeks in a row.");
    expect(nycFlu.edTrends).toEqual([{ area: "NYC Health, week of Oct 17", trend: "Increasing" }]);
    expect(nycFlu.cityWastewater).toEqual([
      { week: "2026-10-03", pct: 25 },
      { week: "2026-10-10", pct: 50 },
      { week: "2026-10-17", pct: 100 },
    ]);
    expect(report.viruses.find((v) => v.id === "flu")!.cityWastewater).toBeNull();
    expect(report.areas.find((a) => a.id === "chicago")!.viruses[0].cityWastewater).toBeNull();
  });

  it("warns when NYC Health can't be reached", () => {
    expect(buildReport(data(), "2026-10-26").warnings).toContain(
      "Couldn't load NYC Health's data, so New York City uses CDC data only.",
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

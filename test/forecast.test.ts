import { describe, expect, it } from "vitest";
import { parse } from "../src/forecast";

const csv = `reference_date,location,horizon,target,target_end_date,output_type,output_type_id,value
2026-10-24,17,0,wk inc covid hosp,2026-10-24,quantile,0.5,79.65
2026-10-24,17,0,wk inc covid hosp,2026-10-24,quantile,0.975,120.1
2026-10-24,17,3,wk inc covid hosp,2026-11-14,quantile,0.5,104.3
2026-10-24,17,3,wk inc covid prop ed visits,2026-11-14,quantile,0.5,0.0022
2026-10-24,06,3,wk inc covid hosp,2026-11-14,quantile,0.5,900
`;

describe("parse", () => {
  it("keeps the median admissions for the states asked for", () => {
    expect(parse(csv, "covid", "wk inc covid hosp", new Set(["17"]))).toEqual([
      { virus: "covid", stateFips: "17", referenceDate: "2026-10-24", horizon: 0, endDate: "2026-10-24", median: 79.65 },
      { virus: "covid", stateFips: "17", referenceDate: "2026-10-24", horizon: 3, endDate: "2026-11-14", median: 104.3 },
    ]);
  });
});

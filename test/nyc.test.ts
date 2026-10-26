import { describe, expect, it } from "vitest";
import { parseCsv } from "../src/nyc";

describe("parseCsv", () => {
  it("reads NYC Health's quoted csv", () => {
    const csv = `"date","SARS-CoV-2 viral load","Flu A viral load"\n2026-10-17,"38161377","2576663"\n`;
    expect(parseCsv(csv)).toEqual([{ date: "2026-10-17", "SARS-CoV-2 viral load": "38161377", "Flu A viral load": "2576663" }]);
  });
});

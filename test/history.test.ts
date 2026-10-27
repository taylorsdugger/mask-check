import { describe, expect, it } from "vitest";
import { changesSince, ratingsFor, threatsByPlace, threatsChanged, type Rating } from "../src/history";
import type { Report, VirusReport } from "../src/score";

const virus = (id: VirusReport["id"], name: string, threat: VirusReport["threat"]) =>
  ({ id, name, threat, level: "Low", trend: null, forecast: null, why: `${name} why.` }) as VirusReport;

const report = (home: VirusReport[], chicago: VirusReport[]) =>
  ({
    threat: "Watch",
    viruses: home,
    areas: [{ id: "chicago", name: "Chicago", threat: "High", viruses: chicago }],
  }) as unknown as Report;

const rating = (area: string, virus: string, threat: string): Rating => ({
  date: "2026-10-25",
  area,
  virus,
  threat,
  level: null,
  trend: null,
  forecast_change: null,
  source: "daily",
});

describe("ratingsFor", () => {
  it("has an overall row and one per virus for every place", () => {
    const rows = ratingsFor(report([virus("flu", "Flu", "Watch")], [virus("flu", "Flu", "High")]), "2026-10-26");
    expect(rows.map((r) => `${r.area}/${r.virus}/${r.threat}`)).toEqual([
      "home/all/Watch",
      "home/flu/Watch",
      "chicago/all/High",
      "chicago/flu/High",
    ]);
  });
});

describe("changesSince", () => {
  it("returns null with nothing to compare against", () => {
    expect(changesSince([], report([], []))).toBeNull();
  });

  it("lists what moved at home with the reason, and other places in one line each", () => {
    const changes = changesSince(
      [rating("home", "flu", "Low"), rating("home", "covid", "Watch"), rating("chicago", "covid", "Elevated")],
      report([virus("flu", "Flu", "Watch"), virus("covid", "COVID", "Watch")], [virus("covid", "COVID", "High")]),
    );
    expect(changes).toEqual({
      since: "2026-10-25",
      home: ["Flu went Low → Watch. Flu why."],
      areas: ["Chicago: COVID Elevated → High."],
    });
  });

  it("skips places that weren't rated the day before", () => {
    const changes = changesSince([rating("home", "flu", "Watch")], report([virus("flu", "Flu", "Watch")], [virus("flu", "Flu", "High")]));
    expect(changes).toEqual({ since: "2026-10-25", home: [], areas: [] });
  });
});

describe("threatsChanged", () => {
  const now = threatsByPlace([rating("home", "all", "Watch"), rating("chicago", "flu", "High")]);

  it("is true with no earlier email to compare against", () => {
    expect(threatsChanged(undefined, now)).toBe(true);
  });

  it("is false when every rating matches the last email", () => {
    expect(threatsChanged({ "home/all": "Watch", "chicago/flu": "High" }, now)).toBe(false);
  });

  it("is true when any place moved, not only home", () => {
    expect(threatsChanged({ "home/all": "Watch", "chicago/flu": "Elevated" }, now)).toBe(true);
  });
});

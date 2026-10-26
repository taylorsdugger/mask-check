import { HOME } from "./config";
import type { Forecast, Report, VirusReport } from "./score";

const COLORS: Record<string, string> = {
  Low: "#2e7d4f",
  Watch: "#b7791f",
  Elevated: "#c05621",
  High: "#c53030",
};

const escape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const erText = (trends: VirusReport["edTrends"]) =>
  trends.map((t) => ` ER visits ${t.trend.toLowerCase()} (${t.area}).`).join("");

const forecastText = (f: Forecast | null) =>
  f ? `Forecast ${f.change >= 0 ? "up" : "down"} ${Math.abs(Math.round(f.change * 100))}% by ${f.endDate.slice(5)} (${f.state})` : "No forecast";

const shortDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

const newest = (dates: (string | null | undefined)[]) =>
  dates.reduce<string | null>((max, d) => (d && (!max || d > max) ? d : max), null);

// CDC posts weekly and about a week behind, so say how old each piece is.
function dataAsOf(report: Report): string {
  const wastewater = newest(report.viruses.map((v) => v.levelWeek));
  const trend = newest(report.viruses.map((v) => v.trendWeek));
  const forecast = newest(report.viruses.map((v) => v.forecast?.referenceDate));
  const parts = [
    wastewater && `wastewater through ${shortDate(wastewater)}`,
    trend && `trend estimate from ${shortDate(trend)}`,
    forecast && `forecast from the week of ${shortDate(forecast)}`,
  ].filter(Boolean);
  return parts.length ? `Data: ${parts.join(", ")}.` : "";
}

function changeLines(report: Report): string[] {
  const c = report.changes;
  if (!c) return [];
  return [...(c.home.length ? c.home : [`No change here since ${shortDate(c.since)}.`]), ...c.areas];
}

export function emailSubject(report: Report): string {
  const c = report.changes;
  const suffix = !c ? "" : c.home.length ? ", changed since yesterday" : ", same as yesterday";
  return `Mask check: ${report.headline}${suffix}`;
}

const KEY = [
  ["Low", "No mask needed. Wastewater is low and not rising."],
  ["Watch", "No mask yet, keep one on you. Wastewater is low but rising."],
  ["Elevated", "Mask in crowded indoor places. Wastewater is moderate and not rising."],
  ["High", "Mask indoors in public. Wastewater is moderate and rising, or high."],
];

export function emailHtml(report: Report, dashboardUrl?: string): string {
  const rows = report.viruses
    .map(
      (v) => `
      <tr>
        <td style="padding:8px 12px;border-top:1px solid #e2e2e2;font-weight:600">${v.name}</td>
        <td style="padding:8px 12px;border-top:1px solid #e2e2e2;color:${COLORS[v.threat]};font-weight:600">${v.threat}</td>
        <td style="padding:8px 12px;border-top:1px solid #e2e2e2">${escape(v.level ?? "No data")}<br>
          <span style="color:#666;font-size:12px">${v.sites.map((s) => `${escape(s.label)}: ${escape(s.category)}`).join("<br>")}</span></td>
        <td style="padding:8px 12px;border-top:1px solid #e2e2e2">${escape(v.trend ?? "Unknown")}<br>
          <span style="color:#666;font-size:12px">${escape(v.trendArea ?? "")}<br>${escape(forecastText(v.forecast))}</span></td>
      </tr>
      <tr><td colspan="4" style="padding:0 12px 8px;color:#444;font-size:13px">${escape(v.why)}</td></tr>`,
    )
    .join("");

  const warnings = report.warnings.length
    ? `<p style="background:#fff8e1;padding:8px 12px;border-radius:6px;font-size:13px">${report.warnings.map(escape).join("<br>")}</p>`
    : "";

  const headsUp = report.headsUp.length
    ? `<p style="background:#fff3e8;padding:8px 12px;border-radius:6px;font-size:13px"><strong>Heads up:</strong> ${report.headsUp.map(escape).join("<br>")}</p>`
    : "";

  const changes = changeLines(report);
  const changeBox = changes.length
    ? `<p style="background:#f2f2f2;padding:8px 12px;border-radius:6px;font-size:14px"><strong>Since yesterday:</strong><br>${changes.map(escape).join("<br>")}</p>`
    : "";
  const asOf = dataAsOf(report);

  const cell = (threat: string, sub: string) =>
    `<td style="padding:8px 12px;border-top:1px solid #e2e2e2"><span style="color:${COLORS[threat]};font-weight:600">${threat}</span><br><span style="color:#666;font-size:12px">${escape(sub)}</span></td>`;
  const areaRows = report.areas
    .map(
      (a) => `
      <tr>
        <td style="padding:8px 12px;border-top:1px solid #e2e2e2;font-weight:600">${escape(a.name)}</td>
        ${a.viruses.map((v) => cell(v.threat, `${v.level ?? "No data"}, ${(v.trend ?? "trend unknown").toLowerCase()}. ${forecastText(v.forecast)}.${erText(v.edTrends)}`)).join("")}
      </tr>`,
    )
    .join("");

  const link = dashboardUrl ? `<p><a href="${escape(dashboardUrl)}">Open the dashboard</a></p>` : "";

  return `<!doctype html>
<html><body style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1a1a1a;max-width:640px;margin:0 auto;padding:16px">
  <p style="margin:0;color:#666;font-size:13px">${HOME.name}</p>
  <h1 style="margin:4px 0 8px;font-size:24px;color:${COLORS[report.threat]}">${report.threat}</h1>
  <p style="font-size:18px;margin:0 0 4px">${escape(report.advice)}</p>
  <p style="margin:0 0 16px;color:#666;font-size:12px">${escape(asOf)}</p>
  ${changeBox}
  ${headsUp}
  ${warnings}
  <table style="border-collapse:collapse;width:100%;font-size:14px">
    <tr style="text-align:left;color:#666;font-size:12px">
      <th style="padding:4px 12px">Virus</th><th style="padding:4px 12px">Risk</th>
      <th style="padding:4px 12px">Wastewater</th><th style="padding:4px 12px">Trend (Rt)</th>
    </tr>
    ${rows}
  </table>
  <h2 style="font-size:16px;margin:24px 0 4px">Other places</h2>
  <table style="border-collapse:collapse;width:100%;font-size:14px">
    <tr style="text-align:left;color:#666;font-size:12px">
      <th style="padding:4px 12px"></th>${report.viruses.map((v) => `<th style="padding:4px 12px">${v.name}</th>`).join("")}
    </tr>
    ${areaRows}
  </table>
  ${link}
  <h2 style="font-size:16px;margin:24px 0 4px">What the levels mean</h2>
  <table style="border-collapse:collapse;width:100%;font-size:13px">
    ${KEY.map(([t, text]) => `<tr><td style="padding:4px 12px 4px 0;color:${COLORS[t]};font-weight:600;white-space:nowrap">${t}</td><td style="padding:4px 0">${text}</td></tr>`).join("")}
  </table>
  <p style="color:#666;font-size:12px;margin-top:24px">CDC wastewater viral activity level and epidemic trend (Rt) estimates. Each plant uses the middle of its last three weekly reports, so one odd week up or down doesn't count. A virus also counts as rising when CDC's ensemble forecast has state hospital admissions up 20% or more three weeks out, unless wastewater is very low. It also counts as rising in New York City when NYC Health's ER visits are up two weeks in a row. All of it updates once a week. At home the wastewater level is the highest of the local plants. Elsewhere it's the level most people there are at. New York City uses Westchester plants, since CDC has none in the five boroughs.</p>
</body></html>`;
}

export function emailText(report: Report, dashboardUrl?: string): string {
  const lines = report.viruses.map((v) => `${v.name}: ${v.threat}. ${v.why}`);
  const areas = report.areas.map(
    (a) => `${a.name}: ${a.viruses.map((v) => `${v.name} ${v.threat}`).join(", ")}.`,
  );
  return [
    report.threat,
    report.advice,
    dataAsOf(report),
    ...(changeLines(report).length ? ["", "Since yesterday:", ...changeLines(report)] : []),
    ...report.headsUp.map((h) => `Heads up: ${h}`),
    "",
    ...lines,
    ...report.warnings,
    "",
    "Other places",
    ...areas,
    dashboardUrl ?? "",
  ].join("\n");
}

export async function sendEmail(
  env: { RESEND_API_KEY: string; EMAIL_FROM: string; EMAIL_TO: string },
  subject: string,
  html: string,
  text: string,
): Promise<void> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: env.EMAIL_TO.split(",").map((s) => s.trim()),
      subject,
      html,
      text,
    }),
  });
  if (!res.ok) throw new Error(`Resend returned ${res.status}: ${await res.text()}`);
}

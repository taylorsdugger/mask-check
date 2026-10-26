import { fetchCdcData } from "./cdc";
import { emailHtml, emailSubject, emailText, sendEmail } from "./email";
import { buildReport, type Report } from "./score";

interface Env {
  STATE: KVNamespace;
  RESEND_API_KEY: string;
  EMAIL_TO: string;
  EMAIL_FROM: string;
  CAUTION: string;
  SEND_EVERY_DAY: string;
  DASHBOARD_URL?: string;
  FORCE_SEND?: string;
}

interface LastSent {
  threat: string;
  date: string;
}

// Bump when the Report shape changes, so a stored report from the old shape
// is never served to the new dashboard.
const REPORT_KEY = "report-v3";

const today = () => new Date().toISOString().slice(0, 10);

const chicago = (part: "hour" | "weekday") =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    ...(part === "hour" ? { hour: "numeric", hourCycle: "h23" } : { weekday: "short" }),
  }).format(new Date());

async function refreshReport(env: Env): Promise<Report> {
  const report = buildReport(await fetchCdcData(today()), today(), env.CAUTION);
  await env.STATE.put(REPORT_KEY, JSON.stringify(report));
  return report;
}

async function storedReport(env: Env): Promise<Report> {
  return (await env.STATE.get<Report>(REPORT_KEY, "json")) ?? refreshReport(env);
}

export default {
  async fetch(request, env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === "/api/report") return Response.json(await storedReport(env));
    if (pathname === "/api/email-preview") {
      return new Response(emailHtml(await storedReport(env), env.DASHBOARD_URL), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }
    return new Response("Not found", { status: 404 });
  },

  async scheduled(_controller, env): Promise<void> {
    const isSendTime = Number(chicago("hour")) === 7 || env.FORCE_SEND === "true";

    let r: Report;
    try {
      r = await refreshReport(env);
    } catch (err) {
      const stored = await env.STATE.get<Report>(REPORT_KEY, "json");
      if (!isSendTime || !stored) throw err;
      console.error(err);
      r = {
        ...stored,
        warnings: [`Couldn't reach CDC this morning. This is the report from ${stored.generatedAt.slice(0, 10)}.`, ...stored.warnings],
      };
    }
    if (!isSendTime) return;

    const last = await env.STATE.get<LastSent>("last-sent", "json");
    const changed = last?.threat !== r.threat;
    if (!changed && chicago("weekday") !== "Mon" && env.SEND_EVERY_DAY !== "true") return;

    await sendEmail(env, emailSubject(r), emailHtml(r, env.DASHBOARD_URL), emailText(r, env.DASHBOARD_URL));
    await env.STATE.put("last-sent", JSON.stringify({ threat: r.threat, date: today() } satisfies LastSent));
  },
} satisfies ExportedHandler<Env>;

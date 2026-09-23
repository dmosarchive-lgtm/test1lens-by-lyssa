// Google Calendar via a service account (no Google sign-in screens needed).
// Setup: create a service account, share Lyssa's calendar with its email ("Make changes to events"),
// and set GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY, GOOGLE_CALENDAR_ID.
import { createSign } from "node:crypto";
import { env, store } from "./core.mjs";

const F = () => globalThis.__LBL_TEST__?.fetch || fetch;
export const TZ = () => env("TIMEZONE") || "America/Denver";
export const calendarConfigured = () =>
  !!(env("GOOGLE_SERVICE_ACCOUNT_EMAIL") && env("GOOGLE_PRIVATE_KEY") && env("GOOGLE_CALENDAR_ID"));

const b64u = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
let cachedToken = null;
async function accessToken() {
  if (cachedToken && cachedToken.exp > Date.now() + 60_000) return cachedToken.token;
  const now = Math.floor(Date.now() / 1000);
  const head = b64u({ alg: "RS256", typ: "JWT" });
  const claim = b64u({ iss: env("GOOGLE_SERVICE_ACCOUNT_EMAIL"), scope: "https://www.googleapis.com/auth/calendar",
    aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 });
  const key = String(env("GOOGLE_PRIVATE_KEY")).replace(/\\n/g, "\n");
  const sig = createSign("RSA-SHA256").update(`${head}.${claim}`).sign(key, "base64url");
  const r = await F()("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${head}.${claim}.${sig}` }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token) throw new Error(`Google sign-in failed: ${d.error_description || d.error || r.status}`);
  cachedToken = { token: d.access_token, exp: Date.now() + (d.expires_in || 3600) * 1000 };
  return cachedToken.token;
}
async function gapi(path, { method = "GET", body, query } = {}) {
  const cal = encodeURIComponent(env("GOOGLE_CALENDAR_ID"));
  const url = `https://www.googleapis.com/calendar/v3/calendars/${cal}${path}${query ? "?" + new URLSearchParams(query) : ""}`;
  const r = await F()(url, { method, headers: { authorization: `Bearer ${await accessToken()}`, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  if (r.status === 204 || r.status === 410) return null; // deleted / already gone
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Google Calendar error: ${d.error?.message || r.status}`);
  return d;
}

/* ---------- time helpers (bookings are in Lyssa's local time zone) ---------- */
function tzOffsetMin(epoch, tz) {
  const s = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longOffset" }).formatToParts(new Date(epoch)).find((p) => p.type === "timeZoneName")?.value || "GMT";
  const m = s.match(/GMT([+-])(\d{2}):?(\d{2})?/);
  return m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] || 0)) : 0;
}
// "2026-10-17", "16:20" -> epoch ms for that wall-clock time in the business time zone
export function localEpoch(date, hm, tz = TZ()) {
  const [y, mo, d] = String(date).split("-").map(Number);
  const [h, mi] = String(hm || "0:00").split(":").map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  let t = guess - tzOffsetMin(guess, tz) * 60_000;
  t = guess - tzOffsetMin(t, tz) * 60_000;
  return t;
}
const pad = (n) => String(n).padStart(2, "0");
const wall = (date, hm, addMin = 0) => {
  const [h, m] = String(hm).split(":").map(Number);
  const t = new Date(Date.UTC(...String(date).split("-").map((x, i) => (i === 1 ? Number(x) - 1 : Number(x))), h, m + addMin));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}T${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}:00`;
};

/* ---------- events for bookings ---------- */
function eventBody(b) {
  const paid = b.status === "paid", dep = b.status === "deposit_paid";
  const lines = [
    `Client: ${b.name}`, b.email && `Email: ${b.email}`, b.phone && `Phone: ${b.phone}`,
    b.fullPrice && `Session price: $${b.fullPrice}${b.amountPaid ? ` · paid so far: $${b.amountPaid}` : ""}`,
    b.invoiceNo && `Invoice: ${b.invoiceNo}`,
    b.addons && `Add-ons: ${b.addons}`, b.people && `Who's coming: ${b.people}`, b.notes && `Notes: ${b.notes}`,
    "", "Booked through the Lens By Lyssa website.",
  ].filter((x) => x !== undefined && x !== false && x !== null);
  return {
    summary: `${paid ? "" : dep ? "[Deposit paid] " : "[Awaiting payment] "}${b.title}: ${b.name}`,
    location: b.location || undefined,
    description: lines.join("\n"),
    start: { dateTime: wall(b.date, b.start), timeZone: TZ() },
    end: { dateTime: wall(b.date, b.start, Number(b.durationMin) || 60), timeZone: TZ() },
    colorId: paid ? "2" : dep ? "6" : "5", // green paid, orange deposit paid, yellow waiting
    extendedProperties: { private: { lblBooking: b.id, lblSlot: b.miniId && b.slot ? `${b.miniId}|${b.slot}` : "" } },
  };
}
export async function upsertBookingEvent(b) {
  if (!calendarConfigured() || !b.date || !b.start) return b.calendarEventId || null;
  if (b.calendarEventId) {
    const r = await gapi(`/events/${encodeURIComponent(b.calendarEventId)}`, { method: "PATCH", body: eventBody(b) });
    if (r) return r.id;
  }
  const r = await gapi("/events", { method: "POST", body: eventBody(b) });
  return r?.id || null;
}
export async function deleteBookingEvent(b) {
  if (!calendarConfigured() || !b.calendarEventId) return;
  await gapi(`/events/${encodeURIComponent(b.calendarEventId)}`, { method: "DELETE" });
}

/* ---------- busy times (block mini slots that clash with her calendar) ---------- */
export async function busyOn(date) {
  if (!calendarConfigured()) return [];
  const key = `busy-${date}`;
  const c = await store("cache").get(key, { type: "json" }).catch(() => null);
  if (c && Date.now() - c.at < 5 * 60_000) return c.busy;
  const from = localEpoch(date, "0:00"), to = from + 26 * 3600_000;
  const d = await gapi("/events", { query: { timeMin: new Date(from).toISOString(), timeMax: new Date(to).toISOString(), singleEvents: "true", maxResults: "250" } });
  const busy = (d?.items || [])
    .filter((e) => e.status !== "cancelled" && e.transparency !== "transparent" && e.start?.dateTime && e.end?.dateTime)
    .filter((e) => !String(e.extendedProperties?.private?.lblSlot || "")) // our own mini events are tracked separately
    .map((e) => [Date.parse(e.start.dateTime), Date.parse(e.end.dateTime)]);
  await store("cache").setJSON(key, { at: Date.now(), busy }).catch(() => {});
  return busy;
}
export const minutesOf = (len, fallback = 20) => { const n = parseInt(String(len), 10); return Number.isFinite(n) && n > 0 ? n : fallback; };
export async function busySlotsFor(m, slots) {
  if (!calendarConfigured() || m.useCalendar === false || m.status !== "open" || !m.date) return [];
  const busy = await busyOn(m.date);
  const len = minutesOf(m.len, Number(m.interval) || 20) * 60_000;
  return slots.filter((s) => { const a = localEpoch(m.date, s); return busy.some(([bs, be]) => a < be && a + len > bs); });
}
export async function calendarCheck({ write = false } = {}) {
  if (!calendarConfigured()) return { configured: false };
  try {
    await gapi("/events", { query: { maxResults: "1", timeMin: new Date().toISOString() } });
    if (write) {
      const tomorrow = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
      const ev = await gapi("/events", { method: "POST", body: { summary: "Lens By Lyssa test event (safe to delete)", start: { dateTime: wall(tomorrow, "9:00"), timeZone: TZ() }, end: { dateTime: wall(tomorrow, "9:15"), timeZone: TZ() } } });
      await gapi(`/events/${encodeURIComponent(ev.id)}`, { method: "DELETE" });
    }
    return { configured: true, ok: true, calendarId: env("GOOGLE_CALENDAR_ID") };
  } catch (e) { return { configured: true, ok: false, error: e.message, calendarId: env("GOOGLE_CALENDAR_ID") }; }
}

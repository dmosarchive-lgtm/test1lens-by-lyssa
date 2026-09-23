// Shared helpers for all Lens By Lyssa functions.
import { getStore } from "@netlify/blobs";
import Stripe from "stripe";
import { createHmac, createHash, timingSafeEqual, randomUUID } from "node:crypto";
import DEFAULTS from "./defaults.mjs";

const T = () => globalThis.__LBL_TEST__; // test hook (never set in production)
export const env = (k) => (T()?.env && k in T().env ? T().env[k] : process.env[k]);

/* ---------- storage ---------- */
export function store(name) {
  if (T()?.store) return T().store(name);
  return getStore(name, { consistency: "strong" });
}

/* ---------- responses ---------- */
export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...headers },
  });
}
export const fail = (message, status = 400) => json({ error: message }, status);

export async function readJSON(req, maxBytes = 600_000) {
  const text = await req.text();
  if (text.length > maxBytes) throw new HttpError("That's too much data to save at once.", 413);
  try { return JSON.parse(text || "{}"); } catch { throw new HttpError("Couldn't read the request.", 400); }
}
export class HttpError extends Error { constructor(m, s) { super(m); this.status = s; } }
export function handle(fn) {
  return async (req, context) => {
    try { return await fn(req, context); }
    catch (e) {
      if (e instanceof HttpError) return fail(e.message, e.status);
      console.error(e);
      return fail("Something went wrong on our side. Please try again.", 500);
    }
  };
}

/* ---------- admin auth (signed token, no database needed) ---------- */
const secret = () => env("SESSION_SECRET") || env("ADMIN_PASSWORD") || "";
const b64u = (s) => Buffer.from(s).toString("base64url");
const sig = (data) => createHmac("sha256", secret()).update(data).digest("base64url");
const same = (a, b) => {
  const ha = createHash("sha256").update(String(a)).digest();
  const hb = createHash("sha256").update(String(b)).digest();
  return timingSafeEqual(ha, hb);
};
export function checkPassword(pw) {
  const real = env("ADMIN_PASSWORD");
  if (!real) throw new HttpError("The admin password hasn't been set up yet (ADMIN_PASSWORD).", 503);
  return same(pw || "", real);
}
export function makeToken(days = 14) {
  const body = b64u(JSON.stringify({ exp: Date.now() + days * 864e5 }));
  return body + "." + sig(body);
}
export function requireAdmin(req) {
  const h = req.headers.get("authorization") || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  const [body, s] = token.split(".");
  if (!body || !s || !secret() || !same(s, sig(body))) throw new HttpError("Please sign in again.", 401);
  let exp = 0; try { exp = JSON.parse(Buffer.from(body, "base64url").toString()).exp; } catch {}
  if (Date.now() > exp) throw new HttpError("Your sign-in expired. Please sign in again.", 401);
}

/* ---------- content ---------- */
const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
// Fill in any fields missing from saved content with the defaults (so new features "just work").
export function withDefaults(saved, def = DEFAULTS) {
  if (!isObj(saved)) return structuredClone(def);
  const out = {};
  for (const k of Object.keys(def)) {
    if (!(k in saved)) out[k] = structuredClone(def[k]);
    else if (isObj(def[k]) && isObj(saved[k])) out[k] = withDefaults(saved[k], def[k]);
    else out[k] = saved[k];
  }
  for (const k of Object.keys(saved)) if (!(k in out)) out[k] = saved[k];
  return out;
}
export async function getContent() {
  const saved = await store("content").get("site", { type: "json" });
  return withDefaults(saved || {});
}
export async function saveContent(c) {
  const clean = sanitize(c);
  await store("content").setJSON("site", clean);
  return clean;
}
// Keep saved content tidy and safe: plain JSON, sane sizes, safe photo URLs.
const SAFE_URL = /^(\/api\/photo\/[A-Za-z0-9-]+|https:\/\/[^\s"'<>]+|data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+)?$/;
export function sanitize(v, key = "") {
  if (Array.isArray(v)) return v.slice(0, 200).map((x) => sanitize(x, key));
  if (isObj(v)) {
    const o = {};
    for (const [k, x] of Object.entries(v)) { if (k === "booked" || k === "busy") continue; o[k] = sanitize(x, k); }
    return o;
  }
  if (typeof v === "string") {
    if (key === "photo" && !SAFE_URL.test(v)) return "";
    return v.slice(0, key === "photo" ? 3_000_000 : 4000);
  }
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "boolean" || v === null) return v;
  return undefined;
}

/* ---------- mini-session slots ---------- */
export function slotsFor(m) {
  const out = [];
  if (!m?.start || !m?.end) return out;
  const step = Math.max(5, Math.min(240, Number(m.interval) || 20));
  const toMin = (t) => { const [h, mm] = String(t).split(":").map(Number); return h * 60 + mm; };
  for (let t = toMin(m.start), end = toMin(m.end); t <= end && out.length < 100; t += step) {
    out.push(`${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`);
  }
  return out;
}
export const slotKey = (miniId, slot) => `${miniId}|${slot}`;
export async function bookedSlots() {
  const { blobs } = await store("slots").list();
  const map = {};
  for (const b of blobs) { const [id, slot] = b.key.split("|"); (map[id] ||= []).push(slot); }
  return map;
}

/* ---------- money + stripe ---------- */
export const cents = (n) => Math.round(Number(n) * 100);
export function stripe() {
  if (T()?.stripe) return T().stripe;
  const key = env("STRIPE_SECRET_KEY");
  if (!key) throw new HttpError("Online payments aren't set up yet. Please reach out by email to book.", 503);
  return new Stripe(key);
}
export const siteUrl = (req) => env("URL") || new URL(req.url).origin;
export const newId = () => randomUUID();

/* ---------- optional email notifications (Resend) ---------- */
export async function notify(subject, lines) {
  const key = env("RESEND_API_KEY"), to = env("NOTIFY_EMAIL");
  if (!key || !to) return;
  const esc = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  const html = `<div style="font-family:sans-serif;font-size:15px">${lines.map(([k, v]) => `<p><b>${esc(k)}:</b> ${esc(v)}</p>`).join("")}<p style="color:#888">Open your admin panel to see everything.</p></div>`;
  try {
    const fetcher = T()?.fetch || fetch;
    await fetcher("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ from: env("NOTIFY_FROM") || "Lens By Lyssa <onboarding@resend.dev>", to: [to], subject, html }),
    });
  } catch (e) { console.error("notify failed", e); }
}

/* ---------- light input checks ---------- */
export const str = (v, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");
export const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

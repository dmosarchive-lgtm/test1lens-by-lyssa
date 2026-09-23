// Booking records: one per scheduled session (full session or mini), with a personal pay link.
import { store, newId, siteUrl, str, isEmail, HttpError, slotKey } from "./core.mjs";
import { upsertBookingEvent, deleteBookingEvent, minutesOf } from "./gcal.mjs";

const B = () => store("bookings");
export const getBooking = (id) => (/^[A-Za-z0-9-]{8,64}$/.test(id || "") ? B().get(id, { type: "json" }) : null);
export async function putBooking(b) { b.updatedAt = new Date().toISOString(); await B().setJSON(b.id, b); return b; }
export async function listBookings() {
  const { blobs } = await B().list();
  const all = (await Promise.all(blobs.map((x) => B().get(x.key, { type: "json" })))).filter(Boolean);
  return all.sort((a, b) => `${a.date} ${a.start}`.localeCompare(`${b.date} ${b.start}`));
}
export const payUrl = (req, b) => `${siteUrl(req)}/?pay=${b.id}`;

// Try the calendar, but never let a calendar hiccup lose a booking.
export async function syncCalendar(b) {
  try { b.calendarEventId = await upsertBookingEvent(b); b.calendarError = ""; }
  catch (e) { b.calendarError = e.message; console.error(e); }
  return b;
}
export async function removeFromCalendar(b) {
  try { await deleteBookingEvent(b); b.calendarEventId = null; } catch (e) { console.error(e); }
}

export function cleanBookingInput(x, content) {
  const b = {
    name: str(x.name, 120), email: str(x.email, 200), phone: str(x.phone, 40),
    title: str(x.title, 120), date: str(x.date, 10), start: str(x.start, 5),
    durationMin: Math.max(5, Math.min(600, Number(x.durationMin) || 60)),
    location: str(x.location, 200), notes: str(x.notes, 2000),
    payType: ["full", "deposit", "custom", "none"].includes(x.payType) ? x.payType : "full",
    amount: Math.max(0, Math.round((Number(x.amount) || 0) * 100) / 100),
    fullPrice: Math.max(0, Number(x.fullPrice) || 0),
    miniId: str(x.miniId, 60), slot: str(x.slot, 5), addons: str(x.addons, 450), people: str(x.people, 40),
    dueDate: /^\d{4}-\d{2}-\d{2}$/.test(x.dueDate || "") ? x.dueDate : "",
    invoiceNote: str(x.invoiceNote, 1500),
  };
  if (!b.name) throw new HttpError("Add the client's name.", 400);
  if (b.email && !isEmail(b.email)) throw new HttpError("That email address doesn't look right.", 400);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date)) throw new HttpError("Pick a date for the session.", 400);
  if (!/^\d{1,2}:\d{2}$/.test(b.start)) throw new HttpError("Pick a start time.", 400);
  if (b.miniId) {
    const m = (content.minis || []).find((z) => z.id === b.miniId);
    if (!m) throw new HttpError("That mini session doesn't exist anymore.", 400);
    b.slot = b.slot || b.start; b.start = b.slot;
    b.durationMin = minutesOf(m.len, Number(m.interval) || 20);
    b.title = b.title || m.name; b.location = b.location || m.where;
  }
  if (!b.title) b.title = "Photo session";
  if (b.payType !== "none" && !(b.amount > 0)) throw new HttpError("Set the amount they'll pay.", 400);
  if (b.payType === "full" || !b.fullPrice) b.fullPrice = Math.max(b.fullPrice, b.amount);
  if (!b.dueDate && b.payType !== "none") {
    const days = Math.max(0, Number(content.invoice?.dueDays ?? 3));
    const soon = new Date(Date.now() + days * 864e5).toISOString().slice(0, 10);
    b.dueDate = soon < b.date ? soon : b.date;
  }
  return b;
}

export async function reserveSlot(b) {
  if (!b.miniId) return;
  const r = await store("slots").set(slotKey(b.miniId, b.slot), JSON.stringify({ booking: b.id, name: b.name, at: Date.now() }), { onlyIfNew: true });
  if (r && r.modified === false) throw new HttpError("That mini time is already booked.", 409);
}
export async function releaseSlot(b) {
  if (!b.miniId || !b.slot) return;
  const key = slotKey(b.miniId, b.slot);
  const cur = await store("slots").get(key, { type: "json" }).catch(() => null);
  if (!cur || cur.booking === b.id || cur.session === b.stripeSession) await store("slots").delete(key);
}
export function newBooking(fields) {
  return { id: newId(), status: fields.payType === "none" ? "paid" : "awaiting_payment", createdAt: new Date().toISOString(), calendarEventId: null, payments: [], ...fields };
}

/* ---------- money on a booking: deposit first, then the balance, all through the same link ---------- */
const round2 = (n) => Math.round(Number(n) * 100) / 100;
export const paidTotal = (b) => round2((b.payments || []).reduce((s, p) => s + Number(p.amount || 0), 0));
export const fullOf = (b) => Number(b.fullPrice) || Number(b.amount) || 0;
export function amountDue(b) {
  if (b.status === "cancelled" || b.payType === "none") return 0;
  const paid = paidTotal(b);
  if (!paid) return round2(b.amount);
  return Math.max(0, round2(fullOf(b) - paid));
}
export function recordPayment(b, { amount, method, session = "", invoice = "" }) {
  b.payments = [...(b.payments || []), { amount: round2(amount), method, session, invoice, at: new Date().toISOString() }];
  b.amountPaid = paidTotal(b);
  b.status = b.amountPaid + 0.005 >= fullOf(b) ? "paid" : "deposit_paid";
  b.paidAt = new Date().toISOString();
  if (session) b.stripeSession = session;
  return b;
}
export async function nextInvoiceNo() {
  const meta = store("meta");
  const cur = (await meta.get("invoiceSeq", { type: "json" })) || { n: 1000 };
  cur.n += 1;
  await meta.setJSON("invoiceSeq", cur);
  return `LBL-${cur.n}`;
}

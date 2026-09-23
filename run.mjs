// Backend tests: node test/run.mjs
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { install, dispatch } from "./harness.mjs";

const T = install();
const B = "http://localhost:8787";
const req = (path, { method = "GET", body, token, raw, type, headers = {} } = {}) =>
  dispatch(new Request(B + path, {
    method,
    headers: { ...(token ? { authorization: "Bearer " + token } : {}), ...(raw ? { "content-type": type } : body !== undefined ? { "content-type": "application/json" } : {}), ...headers },
    body: raw ?? (body !== undefined ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined),
  }));
const j = async (r) => ({ status: r.status, body: await r.json() });
let passed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log("  ✓", name); } catch (e) { console.error("  ✗", name, "\n", e); process.exitCode = 1; } }

console.log("Lens By Lyssa backend");
let token;

await test("public content returns defaults before anything is saved", async () => {
  const r = await j(await req("/api/content"));
  assert.equal(r.status, 200); assert.equal(r.body.live, true);
  assert.equal(r.body.content.brand.name, "Lens By Lyssa");
  assert.deepEqual(r.body.content.minis[0].booked, []);
});
await test("wrong password is rejected", async () => {
  const r = await j(await req("/api/login", { method: "POST", body: { password: "nope" } }));
  assert.equal(r.status, 401);
});
await test("right password gives a token", async () => {
  const r = await j(await req("/api/login", { method: "POST", body: { password: "pumpkin123" } }));
  assert.equal(r.status, 200); token = r.body.token; assert.ok(token.includes("."));
});
await test("saving content needs a valid token", async () => {
  assert.equal((await req("/api/content", { method: "PUT", body: { content: {} } })).status, 401);
  assert.equal((await req("/api/content", { method: "PUT", body: { content: {} }, token: token + "x" })).status, 401);
});
await test("admin can save content; unsafe photo URLs are stripped", async () => {
  const c = (await j(await req("/api/content"))).body.content;
  c.brand.name = "Lens By Lyssa Test"; c.home.collage[0].photo = "javascript:alert(1)"; c.home.collage[1].photo = "/api/photo/abc-123-def";
  c.minis[0].booked = ["16:00"]; // client-only field, must not be saved
  const r = await j(await req("/api/content", { method: "PUT", body: { content: c }, token }));
  assert.equal(r.status, 200);
  const back = (await j(await req("/api/content"))).body.content;
  assert.equal(back.brand.name, "Lens By Lyssa Test");
  assert.equal(back.home.collage[0].photo, "");
  assert.equal(back.home.collage[1].photo, "/api/photo/abc-123-def");
  assert.deepEqual(back.minis[0].booked, []);
});
let photoUrl;
await test("photo upload + serving", async () => {
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
  assert.equal((await req("/api/upload", { method: "POST", raw: bytes, type: "image/jpeg" })).status, 401);
  assert.equal((await req("/api/upload", { method: "POST", raw: bytes, type: "text/html", token })).status, 400);
  const r = await j(await req("/api/upload", { method: "POST", raw: bytes, type: "image/jpeg", token }));
  assert.equal(r.status, 200); photoUrl = r.body.url; assert.match(photoUrl, /^\/api\/photo\/[a-f0-9-]+$/);
  const img = await req(photoUrl);
  assert.equal(img.status, 200); assert.equal(img.headers.get("content-type"), "image/jpeg");
  assert.deepEqual(new Uint8Array(await img.arrayBuffer()), bytes);
  assert.equal((await req("/api/photo/nope")).status, 404);
});
await test("booking note lands in the inbox; honeypot is ignored", async () => {
  assert.equal((await req("/api/inquiry", { method: "POST", body: { kind: "inquiry", name: "Ava", email: "bad" } })).status, 400);
  assert.equal((await req("/api/inquiry", { method: "POST", body: { kind: "inquiry", name: "Bot", email: "b@x.co", website: "spam" } })).status, 200);
  assert.equal((await req("/api/inquiry", { method: "POST", body: { kind: "inquiry", name: "Ava Nguyen", email: "ava@example.com", session: "family", message: "hi <b>there</b>" } })).status, 200);
  assert.equal((await req("/api/inquiry", { method: "POST", body: { kind: "waitlist", email: "w@example.com", mini: "Spring Bloom Minis" } })).status, 200);
  const r = await j(await req("/api/inbox", { token }));
  assert.equal(r.body.items.length, 2);
  assert.ok(r.body.items.some((i) => i.name === "Ava Nguyen" && i.kind === "inquiry"));
  assert.equal((await req("/api/inbox")).status, 401);
});
await test("message-first mode blocks paying for a package directly", async () => {
  const r = await j(await req("/api/checkout", { method: "POST", body: { type: "package", id: "groups-sunbeam", name: "Ava", email: "ava@example.com" } }));
  assert.equal(r.status, 403); assert.match(r.body.error, /note first/);
  const c = (await j(await req("/api/content"))).body.content; c.pricing.bookingMode = "pay";
  await req("/api/content", { method: "PUT", body: { content: c }, token });
});
await test("package checkout uses server prices (full and deposit)", async () => {
  let r = await j(await req("/api/checkout", { method: "POST", body: { type: "package", id: "groups-sunbeam", deposit: false, name: "Ava", email: "ava@example.com", price: 1 } }));
  assert.equal(r.status, 200); assert.match(r.body.url, /checkout\.stripe\.test/);
  let p = T.stripe.created.at(-1).params;
  assert.equal(p.line_items[0].price_data.unit_amount, 10000);
  assert.equal(p.line_items[0].price_data.product_data.name, "Groups · Sunbeam session");
  assert.equal(p.customer_email, "ava@example.com");
  r = await j(await req("/api/checkout", { method: "POST", body: { type: "package", id: "groups-sunbeam", deposit: true, name: "Ava", email: "ava@example.com" } }));
  p = T.stripe.created.at(-1).params;
  assert.equal(p.line_items[0].price_data.unit_amount, 2500);
  assert.equal(p.metadata.deposit, "yes");
  assert.equal((await req("/api/checkout", { method: "POST", body: { type: "package", id: "nope", name: "A", email: "a@b.co" } })).status, 400);
});
await test("mini checkout: slot + paid add-ons, holds the slot", async () => {
  const r = await j(await req("/api/checkout", { method: "POST", body: { type: "mini", miniId: "fall", slot: "16:20", addons: ["extra", "pet"], name: "Maya", email: "maya@example.com" } }));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const p = T.stripe.created.at(-1).params;
  assert.deepEqual(p.line_items.map((l) => l.price_data.unit_amount), [9500, 3000]); // free pup add-on not charged
  assert.equal(p.metadata.slot, "16:20"); assert.match(p.success_url, /paid=mini/);
  const again = await j(await req("/api/checkout", { method: "POST", body: { type: "mini", miniId: "fall", slot: "16:20", name: "Other", email: "o@example.com" } }));
  assert.equal(again.status, 409);
  assert.equal((await req("/api/checkout", { method: "POST", body: { type: "mini", miniId: "fall", slot: "3:33", name: "X", email: "x@example.com" } })).status, 409);
  assert.equal((await req("/api/checkout", { method: "POST", body: { type: "mini", miniId: "spring", slot: "9:00", name: "X", email: "x@example.com" } })).status, 400);
});
const hook = (event) => { const payload = JSON.stringify(event); return req("/api/stripe-webhook", { method: "POST", body: payload, headers: { "stripe-signature": T.stripe.signed(payload) } }); };
const paidEvent = (id, md, amount) => ({ id: "evt_" + id, type: "checkout.session.completed", data: { object: { id, payment_status: "paid", amount_total: amount, customer_details: { email: "maya@example.com", name: "Maya" }, metadata: md } } });
await test("webhook rejects bad signatures", async () => {
  const r = await req("/api/stripe-webhook", { method: "POST", body: "{}", headers: { "stripe-signature": "t=1,v1=bad" } });
  assert.equal(r.status, 400);
});
await test("paid mini books the slot, records payment, is idempotent", async () => {
  const md = { type: "mini", miniId: "fall", slot: "16:20", mini: "Pumpkin Patch Minis", date: "2026-10-17", name: "Maya", addons: "+5 extra photos, Bring the pup" };
  assert.equal((await hook(paidEvent("cs_test_3", md, 12500))).status, 200);
  assert.equal((await hook(paidEvent("cs_test_3", md, 12500))).status, 200); // Stripe retry
  const c = (await j(await req("/api/content"))).body.content;
  assert.deepEqual(c.minis.find((m) => m.id === "fall").booked, ["16:20"]);
  const inbox = (await j(await req("/api/inbox", { token }))).body.items.filter((i) => i.kind === "payment");
  assert.equal(inbox.length, 1); assert.equal(inbox[0].amount, 125); assert.equal(inbox[0].doubleBooked, false);
  // booked slot can't be bought again
  assert.equal((await req("/api/checkout", { method: "POST", body: { type: "mini", miniId: "fall", slot: "16:20", name: "Z", email: "z@example.com" } })).status, 409);
});
await test("double booking is flagged, not lost", async () => {
  const md = { type: "mini", miniId: "fall", slot: "16:20", mini: "Pumpkin Patch Minis", date: "2026-10-17", name: "Late" };
  await hook(paidEvent("cs_test_99", md, 9500));
  const late = (await j(await req("/api/inbox", { token }))).body.items.find((i) => i.stripeSession === "cs_test_99");
  assert.equal(late.doubleBooked, true);
});
await test("expired checkout releases the hold", async () => {
  await req("/api/checkout", { method: "POST", body: { type: "mini", miniId: "fall", slot: "17:00", name: "A", email: "a@example.com" } });
  const sid = T.stripe.created.at(-1).id;
  assert.equal((await req("/api/checkout", { method: "POST", body: { type: "mini", miniId: "fall", slot: "17:00", name: "B", email: "b@example.com" } })).status, 409);
  await hook({ id: "evt_x", type: "checkout.session.expired", data: { object: { id: sid, metadata: { type: "mini", miniId: "fall", slot: "17:00" } } } });
  assert.equal((await req("/api/checkout", { method: "POST", body: { type: "mini", miniId: "fall", slot: "17:00", name: "B", email: "b@example.com" } })).status, 200);
});
await test("admin can release a paid slot and mark messages done", async () => {
  const items = (await j(await req("/api/inbox", { token }))).body.items;
  const pay = items.find((i) => i.stripeSession === "cs_test_3");
  assert.equal((await req("/api/inbox", { method: "PATCH", body: { key: pay.key, releaseSlot: true, handled: true }, token })).status, 200);
  const c = (await j(await req("/api/content"))).body.content;
  assert.deepEqual(c.minis.find((m) => m.id === "fall").booked, []);
  const after = (await j(await req("/api/inbox", { token }))).body.items.find((i) => i.key === pay.key);
  assert.equal(after.handled, true); assert.equal(after.slotReleased, true);
  assert.equal((await req("/api/inbox", { method: "DELETE", body: { key: pay.key }, token })).status, 200);
});
await test("manually blocked slots can't be checked out", async () => {
  const c = (await j(await req("/api/content"))).body.content;
  c.minis[0].taken = ["18:40"];
  await req("/api/content", { method: "PUT", body: { content: c }, token });
  assert.equal((await req("/api/checkout", { method: "POST", body: { type: "mini", miniId: "fall", slot: "18:40", name: "A", email: "a@example.com" } })).status, 409);
});
await test("payments not configured gives a friendly message", async () => {
  const saved = T.stripe; delete T.stripe; T.env.STRIPE_SECRET_KEY = "";
  const r = await j(await req("/api/checkout", { method: "POST", body: { type: "package", id: "groups-sunbeam", name: "A", email: "a@example.com" } }));
  assert.equal(r.status, 503); assert.match(r.body.error, /payments/i);
  T.stripe = saved; T.env.STRIPE_SECRET_KEY = "sk_test_dummy";
});


/* ---------------- bookings, pay links, Google Calendar ---------------- */
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const gcalls = [];
const events = new Map(); let evN = 0;
const busyItems = [];
T.fetch = async (url, init = {}) => {
  const u = new URL(url); const method = init.method || "GET";
  gcalls.push({ method, path: u.pathname, body: init.body });
  const res = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
  if (u.host === "oauth2.googleapis.com") return res({ access_token: "ya29.test", expires_in: 3600 });
  if (u.host === "api.resend.com") return res({ id: "email" });
  const m = u.pathname.match(/\/calendars\/([^/]+)\/events(?:\/(.+))?$/);
  if (!m) return res({ error: { message: "nope" } }, 404);
  const id = m[2] && decodeURIComponent(m[2]);
  if (method === "POST") { const e = { id: "ev" + ++evN, ...JSON.parse(init.body) }; events.set(e.id, e); return res(e); }
  if (method === "PATCH") { const e = { ...events.get(id), ...JSON.parse(init.body) }; events.set(id, e); return res(e); }
  if (method === "DELETE") { events.delete(id); return new Response(null, { status: 204 }); }
  return res({ items: busyItems });
};
Object.assign(T.env, { GOOGLE_SERVICE_ACCOUNT_EMAIL: "site@lbl.iam.gserviceaccount.com", GOOGLE_CALENDAR_ID: "lyssa@example.com",
  GOOGLE_PRIVATE_KEY: privateKey.export({ type: "pkcs8", format: "pem" }).replace(/\n/g, "\\n") });

let bk;
await test("calendar check reports connected", async () => {
  const r = await j(await req("/api/calendar", { method: "POST", body: { test: true }, token }));
  assert.equal(r.body.ok, true, JSON.stringify(r.body));
  assert.ok(gcalls.some((c) => c.path === "/token" || c.method === "POST"));
});
await test("admin creates a session booking -> pay link + yellow calendar hold, inquiry marked handled", async () => {
  const inq = (await j(await req("/api/inbox", { token }))).body.items.find((i) => i.kind === "inquiry");
  const r = await j(await req("/api/bookings", { method: "POST", token, body: { name: "Ava Nguyen", email: "ava@example.com", title: "Sweet Spot session",
    date: "2026-10-24", start: "17:30", durationMin: 60, location: "Snow Canyon", payType: "deposit", amount: 100, fullPrice: 325, inquiryKey: inq.key } }));
  assert.equal(r.status, 200, JSON.stringify(r.body)); bk = r.body.booking;
  assert.equal(bk.status, "awaiting_payment"); assert.match(bk.payUrl, /\/\?pay=/);
  const ev = events.get(bk.calendarEventId);
  assert.ok(ev, "calendar event created"); assert.match(ev.summary, /^\[Awaiting payment\] Sweet Spot session: Ava Nguyen/);
  assert.equal(ev.start.dateTime, "2026-10-24T17:30:00"); assert.equal(ev.end.dateTime, "2026-10-24T18:30:00"); assert.equal(ev.start.timeZone, "America/Denver");
  const after = (await j(await req("/api/inbox", { token }))).body.items.find((i) => i.key === inq.key);
  assert.equal(after.handled, true); assert.equal(after.bookingId, bk.id);
});
await test("public pay page shows safe details only", async () => {
  const r = await j(await req("/api/booking?id=" + bk.id));
  assert.equal(r.status, 200); assert.equal(r.body.firstName, "Ava"); assert.equal(r.body.due, 100); assert.equal(r.body.fullPrice, 325);
  assert.equal(r.body.email, undefined); assert.equal(r.body.notes, undefined);
  assert.equal((await req("/api/booking?id=nope")).status, 404);
});
await test("pay link checkout charges the booking amount", async () => {
  const r = await j(await req("/api/checkout", { method: "POST", body: { type: "booking", id: bk.id, amount: 1 } }));
  assert.equal(r.status, 200);
  const p = T.stripe.created.at(-1).params;
  assert.equal(p.line_items[0].price_data.unit_amount, 10000); assert.equal(p.metadata.bookingId, bk.id); assert.equal(p.customer_email, "ava@example.com");
});
await test("deposit payment -> deposit paid (orange); same link then charges the balance", async () => {
  await hook(paidEvent("cs_bk_1", { type: "booking", bookingId: bk.id, name: "Ava Nguyen" }, 10000));
  let b = (await j(await req("/api/bookings", { token }))).body.items.find((x) => x.id === bk.id);
  assert.equal(b.status, "deposit_paid"); assert.equal(b.paid, 100); assert.equal(b.due, 225);
  let ev = events.get(b.calendarEventId); assert.match(ev.summary, /^\[Deposit paid\] Sweet Spot session/); assert.equal(ev.colorId, "6");
  const pub = (await j(await req("/api/booking?id=" + bk.id))).body;
  assert.equal(pub.due, 225); assert.equal(pub.paid, 100); assert.match(pub.invoiceNo, /^LBL-\d+$/); assert.equal(pub.payments.length, 1);
  const r = await j(await req("/api/checkout", { method: "POST", body: { type: "booking", id: bk.id } }));
  assert.equal(r.status, 200);
  const p = T.stripe.created.filter((x) => x.params && x.params.line_items).at(-1).params;
  assert.equal(p.line_items[0].price_data.unit_amount, 22500); assert.match(p.line_items[0].price_data.product_data.name, /remaining balance/);
  assert.match(p.success_url, /\?pay=.*&paid=1/);
  await hook(paidEvent("cs_bk_2", { type: "booking", bookingId: bk.id, name: "Ava Nguyen" }, 22500));
  b = (await j(await req("/api/bookings", { token }))).body.items.find((x) => x.id === bk.id);
  assert.equal(b.status, "paid"); assert.equal(b.paid, 325); assert.equal(b.due, 0);
  ev = events.get(b.calendarEventId); assert.equal(ev.summary, "Sweet Spot session: Ava Nguyen"); assert.equal(ev.colorId, "2");
  const pay = (await j(await req("/api/inbox", { token }))).body.items.find((i) => i.stripeSession === "cs_bk_1");
  assert.equal(pay.bookingId, bk.id);
  assert.equal((await j(await req("/api/checkout", { method: "POST", body: { type: "booking", id: bk.id } }))).status, 409);
});
await test("Stripe-emailed invoice: sends for the amount due; invoice.paid records payment", async () => {
  const r = await j(await req("/api/bookings", { method: "POST", token, body: { name: "Rae Lin", email: "rae@example.com", title: "Whole Bouquet session", date: "2026-11-02", start: "16:00", durationMin: 90, payType: "deposit", amount: 100, fullPrice: 500 } }));
  const id = r.body.booking.id;
  const s1 = await j(await req("/api/bookings", { method: "PATCH", token, body: { id, action: "stripeInvoice" } }));
  assert.equal(s1.status, 200, JSON.stringify(s1.body));
  assert.match(s1.body.booking.stripeInvoice.url, /invoice\.stripe\.test/);
  const item = T.stripe.created.filter((x) => x.item).at(-1).item; assert.equal(item.amount, 10000); assert.match(item.description, /deposit/);
  const invId = s1.body.booking.stripeInvoice.id;
  const ev = { id: "evt_inv", type: "invoice.paid", data: { object: { id: invId, amount_paid: 10000, customer_email: "rae@example.com", metadata: { type: "booking", bookingId: id, name: "Rae Lin" } } } };
  await hook(ev); await hook(ev); // retry is ignored
  const b = (await j(await req("/api/bookings", { token }))).body.items.find((x) => x.id === id);
  assert.equal(b.status, "deposit_paid"); assert.equal(b.paid, 100); assert.equal(b.payments.length, 1); assert.equal(b.stripeInvoice.paid, true);
  // paying the balance on the site voids nothing (invoice already paid) and completes it
  await hook(paidEvent("cs_rae", { type: "booking", bookingId: id, name: "Rae Lin" }, 40000));
  const b2 = (await j(await req("/api/bookings", { token }))).body.items.find((x) => x.id === id);
  assert.equal(b2.status, "paid");
});
await test("an open Stripe invoice is voided if they pay on the site instead", async () => {
  const r = await j(await req("/api/bookings", { method: "POST", token, body: { name: "Kai", email: "kai@example.com", title: "Snack Size session", date: "2026-11-09", start: "10:00", payType: "full", amount: 150 } }));
  const id = r.body.booking.id;
  const s1 = await j(await req("/api/bookings", { method: "PATCH", token, body: { id, action: "stripeInvoice" } }));
  await hook(paidEvent("cs_kai", { type: "booking", bookingId: id, name: "Kai" }, 15000));
  assert.ok(T.stripe.created.some((x) => x.voided === s1.body.booking.stripeInvoice.id));
});
await test("instant mini payment creates a paid booking on the calendar", async () => {
  await hook(paidEvent("cs_mini_9", { type: "mini", miniId: "holiday", slot: "10:20", mini: "Cozy Holiday Minis", date: "2026-11-21", len: "15 min", where: "Downtown", name: "Maya" }, 11000));
  const b = (await j(await req("/api/bookings", { token }))).body.items.find((x) => x.stripeSession === "cs_mini_9");
  assert.equal(b.status, "paid"); assert.equal(b.durationMin, 15);
  const ev = events.get(b.calendarEventId); assert.equal(ev.start.dateTime, "2026-11-21T10:20:00"); assert.equal(ev.end.dateTime, "2026-11-21T10:35:00");
});
await test("admin books a mini slot for someone -> slot reserved; cancel frees it and removes the event", async () => {
  const r = await j(await req("/api/bookings", { method: "POST", token, body: { name: "Kim", email: "kim@example.com", miniId: "holiday", slot: "10:40", date: "2026-11-21", start: "10:40", payType: "full", amount: 110, fullPrice: 110 } }));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  let c = (await j(await req("/api/content"))).body.content;
  assert.ok(c.minis.find((m) => m.id === "holiday").booked.includes("10:40"));
  const dup = await j(await req("/api/bookings", { method: "POST", token, body: { name: "Lee", miniId: "holiday", slot: "10:40", date: "2026-11-21", start: "10:40", payType: "full", amount: 110 } }));
  assert.equal(dup.status, 409);
  const evId = r.body.booking.calendarEventId;
  await req("/api/bookings", { method: "PATCH", token, body: { id: r.body.booking.id, action: "cancel" } });
  c = (await j(await req("/api/content"))).body.content;
  assert.ok(!c.minis.find((m) => m.id === "holiday").booked.includes("10:40"));
  assert.ok(!events.has(evId));
});
await test("mark paid (cash) and edit time updates the calendar", async () => {
  const r = await j(await req("/api/bookings", { method: "POST", token, body: { name: "Jo", title: "Snack Size session", date: "2026-12-01", start: "9:00", durationMin: 20, payType: "full", amount: 150, fullPrice: 150 } }));
  const id = r.body.booking.id;
  await req("/api/bookings", { method: "PATCH", token, body: { id, action: "update", fields: { start: "10:00" } } });
  await req("/api/bookings", { method: "PATCH", token, body: { id, action: "markPaid" } });
  const b = (await j(await req("/api/bookings", { token }))).body.items.find((x) => x.id === id);
  assert.equal(b.status, "paid"); assert.equal(b.paidOutside, true);
  assert.equal(events.get(b.calendarEventId).start.dateTime, "2026-12-01T10:00:00");
});
await test("busy Google Calendar times hide mini slots and block checkout", async () => {
  const c = (await j(await req("/api/content"))).body.content;
  c.minis.find((m) => m.id === "holiday").taken = [];
  await req("/api/content", { method: "PUT", body: { content: c }, token });
  // dentist appointment 11:00-11:30 Denver time (MST, UTC-7 in November)
  busyItems.push({ status: "confirmed", start: { dateTime: "2026-11-21T11:00:00-07:00" }, end: { dateTime: "2026-11-21T11:30:00-07:00" } });
  busyItems.push({ status: "confirmed", transparency: "transparent", start: { dateTime: "2026-11-21T12:00:00-07:00" }, end: { dateTime: "2026-11-21T12:40:00-07:00" } });
  const s = T.store("cache"); for (const k of [...s._map.keys()]) s._map.delete(k);
  const busy = (await j(await req("/api/content"))).body.content.minis.find((m) => m.id === "holiday").busy;
  assert.deepEqual(busy, ["11:00", "11:20"]); // 10:40 slot ends 10:55 so it's fine; "free" events ignored
  const r = await j(await req("/api/checkout", { method: "POST", body: { type: "mini", miniId: "holiday", slot: "11:20", name: "A", email: "a@example.com" } }));
  assert.equal(r.status, 409);
});
await test("mini request mode blocks instant mini checkout; mini requests land in inbox", async () => {
  const c = (await j(await req("/api/content"))).body.content; c.minisPage.bookingMode = "request";
  await req("/api/content", { method: "PUT", body: { content: c }, token });
  assert.equal((await req("/api/checkout", { method: "POST", body: { type: "mini", miniId: "holiday", slot: "12:00", name: "A", email: "a@example.com" } })).status, 403);
  assert.equal((await req("/api/inquiry", { method: "POST", body: { kind: "mini-request", name: "Sam", email: "sam@example.com", mini: "Cozy Holiday Minis", miniId: "holiday", slot: "12:00" } })).status, 200);
  const it = (await j(await req("/api/inbox", { token }))).body.items.find((i) => i.kind === "mini-request");
  assert.equal(it.slot, "12:00"); assert.equal(it.miniId, "holiday");
});
await test("bookings API needs admin", async () => {
  assert.equal((await req("/api/bookings")).status, 401);
  assert.equal((await req("/api/calendar")).status, 401);
});
console.log(`\n${passed} passed${process.exitCode ? ", some FAILED" : ""}`);

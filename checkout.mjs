// POST /api/checkout — starts a Stripe Checkout. Three kinds:
//   {type:"booking", id}  a personal pay link Lyssa sent after agreeing on a date (message-first)
//   {type:"package", id, deposit}  pay for a package right away (only if "pay right away" is on)
//   {type:"mini", miniId, slot, addons}  grab a mini time right away (only if instant minis are on)
// Prices always come from saved content / the booking, never from the browser.
import { handle, json, fail, readJSON, getContent, stripe, siteUrl, cents, slotsFor, slotKey,
         store, str, isEmail } from "./_lib/core.mjs";
import { getBooking, amountDue, paidTotal } from "./_lib/bookings.mjs";
import { busySlotsFor } from "./_lib/gcal.mjs";

const HOLD_MIN = 31; // Stripe requires checkout links to live at least 30 minutes

export default handle(async (req) => {
  if (req.method !== "POST") return fail("Method not allowed", 405);
  const b = await readJSON(req, 20_000);
  const c = await getContent();
  const base = siteUrl(req);
  let items = [], meta = {}, email = "", success = `${base}/?paid=session`, cancel = `${base}/?canceled=1`, hold = null;

  if (b.type === "booking") {
    const bk = await getBooking(str(b.id, 64));
    if (!bk) return fail("We couldn't find that booking. Please message us.", 404);
    if (bk.status === "cancelled") return fail("This booking isn't open for payment. Please message us.", 409);
    const due = amountDue(bk);
    if (!(due > 0)) return fail("This invoice is already paid. You're all set!", 409);
    const part = paidTotal(bk) > 0 ? " — remaining balance" : bk.payType === "deposit" ? " — deposit" : "";
    items.push({ name: `${bk.title}${part}`, amount: due,
      desc: `${bk.invoiceNo ? bk.invoiceNo + " · " : ""}${bk.date} at ${bk.start}${bk.location ? " · " + bk.location : ""}` });
    meta = { type: "booking", bookingId: bk.id, name: bk.name };
    email = bk.email;
    success = `${base}/?pay=${bk.id}&paid=1`;
    cancel = `${base}/?pay=${bk.id}`;
  } else {
    const name = str(b.name, 120); email = str(b.email, 200);
    if (!name) return fail("Please add your name.");
    if (!isEmail(email)) return fail("Please check your email address.");
    meta = { name, phone: str(b.phone, 40) };
    if (b.type === "package") {
      if ((c.pricing.bookingMode || "message") !== "pay") return fail("Please send a note first so we can set your date. You'll get a payment link after.", 403);
      const p = (c.pricing.packages || []).find((x) => x.id === b.id);
      if (!p) return fail("That package isn't available anymore. Please refresh the page.");
      const deposit = !!b.deposit && c.pricing.allowDeposit && Number(c.pricing.deposit) > 0;
      const amount = deposit ? Math.min(Number(c.pricing.deposit), Number(p.price)) : Number(p.price);
      if (!(amount > 0)) return fail("That package doesn't have a price yet.");
      const type = (c.pricing.categories || []).find((t) => t.id === p.cat);
      const full = type ? `${type.name} · ${p.name}` : p.name;
      items.push({ name: `${full} session${deposit ? " — deposit" : ""}`, amount,
        desc: deposit ? `Holds your date. The remaining $${Number(p.price) - amount} is due on session day.` : p.time });
      Object.assign(meta, { type: "package", package: full, deposit: deposit ? "yes" : "no", price: String(p.price),
        date: str(b.date, 20), message: str(b.message, 450) });
      cancel = `${base}/?canceled=1#tags`;
    } else if (b.type === "mini") {
      if ((c.minisPage.bookingMode || "pay") !== "pay") return fail("Please request your time first. We'll send a payment link once it's confirmed.", 403);
      const m = (c.minis || []).find((x) => x.id === b.miniId);
      if (!m || m.status !== "open") return fail("That mini session isn't open for booking.");
      const slot = str(b.slot, 10), all = slotsFor(m);
      if (!all.includes(slot) || (m.taken || []).includes(slot)) return fail("That time isn't available. Please pick another.", 409);
      const key = slotKey(m.id, slot);
      if (await store("slots").get(key)) return fail("Oh no, someone just booked that time! Please pick another.", 409);
      try { if ((await busySlotsFor(m, [slot])).length) return fail("That time isn't available. Please pick another.", 409); } catch {}
      const h = await store("holds").get(key, { type: "json" });
      if (h && h.until > Date.now()) return fail("Someone is checking out with that time right now. Pick another, or try again in about 30 minutes.", 409);
      items.push({ name: `${m.name} — ${m.date} at ${slot}`, amount: Number(m.price), desc: `${m.len} · ${m.photos} edited photos · ${m.where}` });
      const chosen = (c.addons || []).filter((a) => (b.addons || []).includes(a.id));
      for (const a of chosen) if (Number(a.price) > 0) items.push({ name: a.label, amount: Number(a.price) });
      Object.assign(meta, { type: "mini", miniId: m.id, mini: m.name, slot, date: m.date, len: String(m.len || ""), where: String(m.where || "").slice(0, 200),
        addons: chosen.map((a) => a.label).join(", ").slice(0, 450), people: str(b.people, 40), message: str(b.message, 450) });
      success = `${base}/?paid=mini#minis`;
      cancel = `${base}/?canceled=1#minis`;
      hold = key;
    } else return fail("Unknown checkout type.");
  }
  if (!items.length || !(items[0].amount > 0)) return fail("Nothing to pay for.");

  const expires = Math.floor(Date.now() / 1000) + HOLD_MIN * 60;
  const session = await stripe().checkout.sessions.create({
    mode: "payment",
    ...(email ? { customer_email: email } : {}),
    line_items: items.map((i) => ({
      quantity: 1,
      price_data: { currency: "usd", unit_amount: cents(i.amount),
        product_data: { name: i.name.slice(0, 250), ...(i.desc ? { description: String(i.desc).slice(0, 500) } : {}) } },
    })),
    metadata: meta,
    payment_intent_data: { metadata: meta, description: items[0].name.slice(0, 250) },
    success_url: success,
    cancel_url: cancel,
    expires_at: expires,
  });
  if (hold) await store("holds").setJSON(hold, { until: expires * 1000, session: session.id });
  return json({ url: session.url });
});

export const config = { path: "/api/checkout" };

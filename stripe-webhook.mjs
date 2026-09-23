// POST /api/stripe-webhook — Stripe tells us when a payment finishes.
// Confirms the booking, puts it on Google Calendar, books mini slots, and adds it to the admin inbox.
import { handle, json, fail, stripe, env, store, notify, getContent } from "./_lib/core.mjs";
import { getBooking, putBooking, newBooking, syncCalendar, recordPayment, amountDue } from "./_lib/bookings.mjs";
import { voidOpenStripeInvoice } from "./_lib/stripeinv.mjs";
import { minutesOf } from "./_lib/gcal.mjs";

export default handle(async (req) => {
  if (req.method !== "POST") return fail("Method not allowed", 405);
  const secret = env("STRIPE_WEBHOOK_SECRET");
  if (!secret) return fail("Webhook secret not configured", 503);
  const raw = await req.text();
  let event;
  try { event = stripe().webhooks.constructEvent(raw, req.headers.get("stripe-signature") || "", secret); }
  catch { return fail("Bad signature", 400); }

  const s = event.data?.object || {};
  const md = s.metadata || {};
  const slotKey = md.type === "mini" && md.miniId && md.slot ? `${md.miniId}|${md.slot}` : null;

  if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
    if (s.payment_status !== "paid") return json({ received: true }); // wait for async payment
    const inbox = store("inbox");
    const key = `payment-${s.id}`;
    if (await inbox.get(key)) return json({ received: true, duplicate: true }); // Stripe may retry
    const amount = (s.amount_total || 0) / 100;
    const email = s.customer_details?.email || s.customer_email || "";
    let booking = null, doubleBooked = false;

    if (md.type === "booking" && md.bookingId) {
      booking = await getBooking(md.bookingId);
      if (booking) {
        recordPayment(booking, { amount, method: "card (site)", session: s.id });
        if (!booking.email) booking.email = email;
        if (booking.status === "paid") await voidOpenStripeInvoice(booking); // don't let them pay twice
        await syncCalendar(booking); await putBooking(booking);
      }
    } else if (slotKey) {
      const r = await store("slots").set(slotKey, JSON.stringify({ session: s.id, name: md.name, at: Date.now() }), { onlyIfNew: true });
      doubleBooked = r && r.modified === false;
      await store("holds").delete(slotKey);
      let len = md.len;
      if (!len) { try { len = ((await getContent()).minis || []).find((m) => m.id === md.miniId)?.len; } catch {} }
      booking = newBooking({ name: md.name || s.customer_details?.name || "", email, phone: md.phone || "", title: md.mini || "Mini session",
        date: md.date, start: md.slot, durationMin: minutesOf(len, 20), location: md.where || "", notes: md.message || "",
        payType: "full", amount, fullPrice: amount, miniId: md.miniId, slot: md.slot, addons: md.addons || "", people: md.people || "" });
      recordPayment(booking, { amount, method: "card (site)", session: s.id });
      booking.invoiceNo = "";
      booking.doubleBooked = doubleBooked;
      await syncCalendar(booking); await putBooking(booking);
    }

    const item = {
      kind: "payment", type: md.type || "",
      name: md.name || booking?.name || s.customer_details?.name || "", email, phone: md.phone || booking?.phone || "",
      amount, package: md.package || (md.type === "booking" ? booking?.title || "" : ""),
      deposit: md.deposit || (booking?.payType === "deposit" ? "yes" : ""),
      mini: md.mini || "", miniId: md.miniId || booking?.miniId || "", slot: md.slot || booking?.slot || "",
      date: md.date || booking?.date || "", start: booking?.start || "",
      addons: md.addons || "", people: md.people || "", message: md.message || "",
      bookingId: booking?.id || "", stripeSession: s.id, doubleBooked,
      createdAt: new Date().toISOString(), handled: false,
    };
    await inbox.setJSON(key, item);
    await notify(`${doubleBooked ? "DOUBLE-BOOKED: " : ""}Paid $${amount}: ${booking?.title || item.package || item.mini}`,
      [["Name", item.name], ["Email", item.email], ["When", item.date ? `${item.date} ${item.start || item.slot}` : "(date to be set)"],
       ["Add-ons", item.addons], ["Amount", `$${amount}`], ["Notes", item.message]]);
    return json({ received: true });
  }

  if (event.type === "invoice.paid" && md.bookingId) {
    const inbox = store("inbox");
    const key = `payment-${s.id}`;
    if (await inbox.get(key)) return json({ received: true, duplicate: true });
    const amount = (s.amount_paid || 0) / 100;
    const booking = await getBooking(md.bookingId);
    let overpaid = false;
    if (booking) {
      overpaid = amountDue(booking) <= 0;
      recordPayment(booking, { amount, method: "Stripe invoice", invoice: s.id });
      if (booking.stripeInvoice && booking.stripeInvoice.id === s.id) booking.stripeInvoice.paid = true;
      await syncCalendar(booking); await putBooking(booking);
    }
    const item = { kind: "payment", type: "booking", name: booking?.name || md.name || "", email: s.customer_email || booking?.email || "",
      amount, package: booking?.title || "", date: booking?.date || "", start: booking?.start || "", bookingId: booking?.id || "",
      stripeInvoice: s.id, overpaid, message: "", createdAt: new Date().toISOString(), handled: false };
    await inbox.setJSON(key, item);
    await notify(`${overpaid ? "PAID TWICE: " : ""}Invoice paid $${amount}: ${item.package}`, [["Name", item.name], ["Email", item.email], ["When", `${item.date} ${item.start}`], ["Amount", `$${amount}`]]);
    return json({ received: true });
  }

  if (event.type === "checkout.session.expired" && slotKey) {
    const h = await store("holds").get(slotKey, { type: "json" });
    if (h && h.session === s.id) await store("holds").delete(slotKey);
  }
  return json({ received: true });
});

export const config = { path: "/api/stripe-webhook" };

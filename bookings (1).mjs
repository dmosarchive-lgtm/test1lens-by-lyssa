// Admin: schedule sessions and send personal pay links.
// GET list · POST create · PATCH {id, action: "update" | "markPaid" | "cancel", ...fields}
import { handle, json, fail, readJSON, requireAdmin, getContent, store, str } from "./_lib/core.mjs";
import { listBookings, getBooking, putBooking, newBooking, cleanBookingInput, reserveSlot, releaseSlot,
         syncCalendar, removeFromCalendar, payUrl, amountDue, paidTotal, recordPayment, nextInvoiceNo } from "./_lib/bookings.mjs";
import { sendStripeInvoice, voidOpenStripeInvoice } from "./_lib/stripeinv.mjs";

const view = (req, b) => ({ ...b, payUrl: payUrl(req, b), due: amountDue(b), paid: paidTotal(b) });
import { calendarConfigured } from "./_lib/gcal.mjs";

export default handle(async (req) => {
  requireAdmin(req);
  if (req.method === "GET") {
    const items = await listBookings();
    return json({ items: items.map((b) => view(req, b)), calendar: calendarConfigured() });
  }
  const body = await readJSON(req, 20_000);
  if (req.method === "POST") {
    const content = await getContent();
    const b = newBooking(cleanBookingInput(body, content));
    await reserveSlot(b);
    b.invoiceNo = await nextInvoiceNo();
    if (b.status === "paid") b.paidAt = new Date().toISOString();
    if (body.addToCalendar !== false) await syncCalendar(b);
    await putBooking(b);
    const inq = str(body.inquiryKey, 200);
    if (inq) {
      const it = await store("inbox").get(inq, { type: "json" });
      if (it) { it.handled = true; it.bookingId = b.id; await store("inbox").setJSON(inq, it); }
    }
    return json({ ok: true, booking: view(req, b) });
  }
  if (req.method === "PATCH") {
    const b = await getBooking(str(body.id, 64));
    if (!b) return fail("That booking wasn't found.", 404);
    if (body.action === "cancel") {
      b.status = "cancelled"; b.cancelledAt = new Date().toISOString();
      await releaseSlot(b); await removeFromCalendar(b); await voidOpenStripeInvoice(b);
    } else if (body.action === "markPaid") {
      const amt = body.amount != null ? Number(body.amount) : amountDue(b);
      if (amt > 0) recordPayment(b, { amount: amt, method: str(body.method, 40) || "cash / other" });
      else { b.status = "paid"; b.paidAt = new Date().toISOString(); }
      b.paidOutside = true;
      if (b.status === "paid") await voidOpenStripeInvoice(b);
      await syncCalendar(b);
    } else if (body.action === "update") {
      if (b.status === "cancelled") return fail("That booking was cancelled.");
      const content = await getContent();
      const next = cleanBookingInput({ ...b, ...body.fields }, content);
      const slotChanged = next.miniId !== b.miniId || next.slot !== b.slot;
      if (slotChanged) { await releaseSlot(b); Object.assign(b, next); await reserveSlot(b); }
      else Object.assign(b, next);
      await syncCalendar(b);
    } else if (body.action === "stripeInvoice") {
      if (b.status === "cancelled") return fail("That booking was cancelled.");
      await voidOpenStripeInvoice(b);
      b.stripeInvoice = await sendStripeInvoice(b, await getContent());
    } else return fail("Unknown action.");
    await putBooking(b);
    return json({ ok: true, booking: view(req, b) });
  }
  return fail("Method not allowed", 405);
});

export const config = { path: "/api/bookings" };

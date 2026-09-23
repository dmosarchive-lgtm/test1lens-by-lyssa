// Public: GET /api/booking?id=… — what a client sees on their private invoice page.
import { handle, json, fail, getContent } from "./_lib/core.mjs";
import { getBooking, amountDue, paidTotal, fullOf } from "./_lib/bookings.mjs";

export default handle(async (req) => {
  if (req.method !== "GET") return fail("Method not allowed", 405);
  const b = await getBooking(new URL(req.url).searchParams.get("id") || "");
  if (!b) return fail("We couldn't find that invoice. Please check the link, or send us a note.", 404);
  const c = await getContent();
  return json({
    id: b.id, invoiceNo: b.invoiceNo || "", issued: (b.createdAt || "").slice(0, 10), dueDate: b.dueDate || "",
    status: b.status, firstName: (b.name || "").split(" ")[0], title: b.title,
    date: b.date, start: b.start, durationMin: b.durationMin, location: b.location, addons: b.addons,
    payType: b.payType, fullPrice: fullOf(b), firstAmount: b.amount, paid: paidTotal(b), due: amountDue(b),
    payments: (b.payments || []).map((p) => ({ amount: p.amount, at: p.at })),
    stripeInvoiceUrl: b.stripeInvoice && !b.stripeInvoice.voided && !b.stripeInvoice.paid ? b.stripeInvoice.url : "",
    note: b.invoiceNote || c.invoice?.note || "", terms: c.invoice?.terms || "", invoiceTitle: c.invoice?.title || "Invoice",
    brand: { name: c.brand.name, email: c.brand.email, city: c.brand.city, instagram: c.brand.instagram, owner: c.brand.owner },
  });
});

export const config = { path: "/api/booking" };

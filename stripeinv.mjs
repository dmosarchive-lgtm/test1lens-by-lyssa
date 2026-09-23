// Optional: email a Stripe-hosted invoice for a booking (Stripe charges ~0.4% extra per paid invoice).
import { stripe, cents, HttpError } from "./core.mjs";
import { amountDue } from "./bookings.mjs";

export async function sendStripeInvoice(b, content) {
  if (!b.email) throw new HttpError("Add the client's email first. Stripe emails the invoice to them.", 400);
  const due = amountDue(b);
  if (!(due > 0)) throw new HttpError("Nothing is due on this booking.", 400);
  const s = stripe();
  const found = await s.customers.list({ email: b.email, limit: 1 });
  const customer = found.data[0] || (await s.customers.create({ email: b.email, name: b.name, phone: b.phone || undefined }));
  const days = Math.max(1, Math.round((Date.parse(b.dueDate || b.date) - Date.now()) / 864e5) || 3);
  const md = { type: "booking", bookingId: b.id, name: b.name };
  const inv = await s.invoices.create({
    customer: customer.id,
    collection_method: "send_invoice",
    days_until_due: days,
    pending_invoice_items_behavior: "exclude",
    auto_advance: true,
    metadata: md,
    description: String(b.invoiceNote || content.invoice?.note || "").slice(0, 1500) || undefined,
    footer: String(content.invoice?.terms || "").slice(0, 500) || undefined,
    custom_fields: b.invoiceNo ? [{ name: "Booking", value: b.invoiceNo }] : undefined,
  });
  const label = (b.payments || []).length ? `${b.title} — remaining balance` : b.payType === "deposit" ? `${b.title} — deposit` : b.title;
  await s.invoiceItems.create({ customer: customer.id, invoice: inv.id, currency: "usd", amount: cents(due),
    description: `${label} · ${b.date} at ${b.start}${b.location ? " · " + b.location : ""}`.slice(0, 500) });
  const fin = await s.invoices.finalizeInvoice(inv.id);
  await s.invoices.sendInvoice(inv.id);
  return { id: inv.id, url: fin.hosted_invoice_url || "", amount: due, sentAt: new Date().toISOString() };
}
export async function voidOpenStripeInvoice(b) {
  if (!b.stripeInvoice?.id || b.stripeInvoice.voided || b.stripeInvoice.paid) return;
  try { await stripe().invoices.voidInvoice(b.stripeInvoice.id); b.stripeInvoice.voided = true; } catch (e) { console.error("void failed", e.message); }
}

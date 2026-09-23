// Local preview with the real functions (in-memory storage, fake Stripe): node test/server.mjs
// Admin password: pumpkin123
import http from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname, normalize } from "node:path";
import { install, dispatch } from "./harness.mjs";

const T = install();
const PORT = Number(process.env.PORT || 8787);
// "Checkout" goes straight to the dev pay endpoint below instead of Stripe
const create = T.stripe.checkout.sessions.create;
T.stripe.checkout.sessions.create = async (p) => ({ ...(await create(p)), url: `http://localhost:${PORT}/__dev/pay?session=cs_test_${T.stripe.created.length}` });
const PUB = new URL("../public/", import.meta.url).pathname;
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  // Dev only: pretend the client finished Stripe checkout. /__dev/pay?session=cs_test_1 → sends the signed webhook, then goes to success_url
  if (url.pathname === "/__dev/pay") {
    const hit = T.stripe.created.find((c) => c.id === url.searchParams.get("session"));
    if (!hit) { res.writeHead(404); res.end("no such session"); return; }
    const p = hit.params, amount = p.line_items.reduce((t, li) => t + li.price_data.unit_amount * (li.quantity || 1), 0);
    const payload = JSON.stringify({ id: "evt_" + hit.id, type: "checkout.session.completed", data: { object: { id: hit.id, object: "checkout.session", payment_status: "paid", amount_total: amount, metadata: p.metadata, customer_details: { email: p.customer_email, name: p.metadata?.name } } } });
    await dispatch(new Request(`http://localhost:${PORT}/api/stripe-webhook`, { method: "POST", headers: { "stripe-signature": T.stripe.signed(payload) }, body: payload }));
    res.writeHead(302, { location: p.success_url.replace("{CHECKOUT_SESSION_ID}", hit.id) }); res.end(); return;
  }
  if (url.pathname.startsWith("/api/")) {
    const chunks = []; for await (const c of req) chunks.push(c);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const r = await dispatch(new Request(url, { method: req.method, headers: req.headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : body }));
    res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer())); return;
  }
  let p = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
  if (p.endsWith("/")) p += "index.html";
  if (p === "/admin") { res.writeHead(301, { location: "/admin/" }); res.end(); return; }
  try { const data = await readFile(join(PUB, p)); res.writeHead(200, { "content-type": TYPES[extname(p)] || "application/octet-stream" }); res.end(data); }
  catch { res.writeHead(404); res.end("Not found"); }
}).listen(PORT, () => console.log(`Lens By Lyssa running at http://localhost:${PORT}  (admin: /admin, password pumpkin123)`));

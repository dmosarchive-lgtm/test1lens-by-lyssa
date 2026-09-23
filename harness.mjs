// Test harness: in-memory Netlify Blobs + a Stripe stand-in, so the real functions run locally.
import Stripe from "stripe";

export function memStores() {
  const stores = new Map();
  const make = () => {
    const m = new Map(); let n = 0;
    const etag = () => String(++n);
    const toType = (v, type) => {
      if (v == null) return null;
      if (type === "json") return JSON.parse(typeof v === "string" ? v : Buffer.from(v).toString());
      if (type === "arrayBuffer") return typeof v === "string" ? new TextEncoder().encode(v).buffer : v;
      return typeof v === "string" ? v : Buffer.from(v).toString();
    };
    return {
      async get(k, o = {}) { const e = m.get(k); return e ? toType(e.v, o.type) : null; },
      async getWithMetadata(k, o = {}) { const e = m.get(k); return e ? { data: toType(e.v, o.type), etag: e.etag, metadata: e.md } : null; },
      async set(k, v, o = {}) {
        if (o.onlyIfNew && m.has(k)) return { modified: false };
        const buf = v instanceof ArrayBuffer ? v.slice(0) : v;
        m.set(k, { v: buf, md: o.metadata || {}, etag: etag() }); return { modified: true, etag: m.get(k).etag };
      },
      async setJSON(k, v, o) { return this.set(k, JSON.stringify(v), o); },
      async delete(k) { m.delete(k); },
      async list() { return { blobs: [...m.entries()].map(([key, e]) => ({ key, etag: e.etag })), directories: [] }; },
      _map: m,
    };
  };
  return (name) => { if (!stores.has(name)) stores.set(name, make()); return stores.get(name); };
}

export const WEBHOOK_SECRET = "whsec_test_secret";
export function fakeStripe() {
  const real = new Stripe("sk_test_dummy");
  const created = [];
  return {
    created,
    webhooks: real.webhooks,
    checkout: { sessions: { create: async (params) => {
      const id = "cs_test_" + (created.length + 1);
      created.push({ id, params });
      return { id, url: `https://checkout.stripe.test/${id}` };
    } } },
    customers: { list: async () => ({ data: [] }), create: async (p) => ({ id: "cus_1", ...p }) },
    invoiceItems: { create: async (p) => { created.push({ item: p }); return { id: "ii_1", ...p }; } },
    invoices: {
      create: async (p) => { const id = "in_" + (created.length + 1); created.push({ invoice: id, params: p }); return { id, ...p }; },
      finalizeInvoice: async (id) => ({ id, hosted_invoice_url: `https://invoice.stripe.test/${id}` }),
      sendInvoice: async (id) => ({ id, status: "open" }),
      voidInvoice: async (id) => { created.push({ voided: id }); return { id, status: "void" }; },
    },
    signed(payload) { return real.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET }); },
  };
}

export function install() {
  const stripe = fakeStripe();
  globalThis.__LBL_TEST__ = {
    store: memStores(),
    stripe,
    env: { ADMIN_PASSWORD: "pumpkin123", SESSION_SECRET: "test-session-secret", STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET, STRIPE_SECRET_KEY: "sk_test_dummy", URL: "http://localhost:8787" },
  };
  return globalThis.__LBL_TEST__;
}

// Route a Request to the matching function, like Netlify does.
const ROUTES = [
  ["/api/content", "content"], ["/api/login", "login"], ["/api/upload", "upload"], ["/api/inquiry", "inquiry"],
  ["/api/inbox", "inbox"], ["/api/checkout", "checkout"], ["/api/stripe-webhook", "stripe-webhook"],
  ["/api/bookings", "bookings"], ["/api/booking", "booking"], ["/api/calendar", "calendar"],
];
const mods = {};
async function mod(name) { return (mods[name] ||= await import(`../netlify/functions/${name}.mjs`)); }
export async function dispatch(req) {
  const path = new URL(req.url).pathname;
  const photo = path.match(/^\/api\/photo\/([^/]+)$/);
  if (photo) return (await mod("photo")).default(req, { params: { key: photo[1] } });
  const hit = ROUTES.find(([p]) => p === path);
  if (!hit) return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
  return (await mod(hit[1])).default(req, { params: {} });
}

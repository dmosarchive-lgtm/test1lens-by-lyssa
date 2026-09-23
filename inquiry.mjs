// POST /api/inquiry — booking notes and mini waitlist sign-ups land in the admin inbox.
import { handle, json, fail, readJSON, store, str, isEmail, notify } from "./_lib/core.mjs";

export default handle(async (req) => {
  if (req.method !== "POST") return fail("Method not allowed", 405);
  const b = await readJSON(req, 20_000);
  if (str(b.website)) return json({ ok: true }); // honeypot: bots fill hidden fields
  const kind = ["waitlist", "mini-request"].includes(b.kind) ? b.kind : "inquiry";
  const email = str(b.email, 200);
  if (!isEmail(email)) return fail("Please check your email address.");
  const name = str(b.name, 120);
  if (kind !== "waitlist" && !name) return fail("Please add your name.");
  const item = {
    kind, name, email,
    phone: str(b.phone, 40),
    session: str(b.session, 60),
    date: str(b.date, 20),
    package: str(b.package, 80),
    style: str(b.style, 60),
    mini: str(b.mini, 80),
    miniId: str(b.miniId, 60),
    slot: str(b.slot, 5),
    addons: str(b.addons, 450),
    people: str(b.people, 40),
    message: str(b.message, 3000),
    createdAt: new Date().toISOString(),
    handled: false,
  };
  const key = `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await store("inbox").setJSON(key, item);
  await notify(kind === "waitlist" ? `Waitlist: ${item.mini}` : kind === "mini-request" ? `Mini request: ${item.mini} at ${item.slot}` : `New booking note from ${name}`,
    [["Name", name], ["Email", email], ["Phone", item.phone], ["Session", item.session || item.mini], ["Date", item.date], ["Package", item.package], ["Message", item.message]]);
  return json({ ok: true });
});

export const config = { path: "/api/inquiry" };

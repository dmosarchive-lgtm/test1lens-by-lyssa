// GET  /api/content  -> the site's content (public). Paid mini slots are merged in as `booked`,
//                       and times that clash with Google Calendar as `busy`.
// PUT  /api/content  -> save content (admin only).
import { handle, json, fail, readJSON, requireAdmin, getContent, saveContent, bookedSlots, slotsFor } from "./_lib/core.mjs";
import { busySlotsFor } from "./_lib/gcal.mjs";

export default handle(async (req) => {
  if (req.method === "GET") {
    const [content, booked] = await Promise.all([getContent(), bookedSlots()]);
    await Promise.all((content.minis || []).map(async (m) => {
      m.booked = booked[m.id] || [];
      try { m.busy = await busySlotsFor(m, slotsFor(m)); } catch (e) { m.busy = []; console.error(e); }
    }));
    return json({ live: true, content });
  }
  if (req.method === "PUT") {
    requireAdmin(req);
    const body = await readJSON(req, 20_000_000);
    if (!body || typeof body.content !== "object") return fail("Nothing to save.");
    const saved = await saveContent(body.content);
    return json({ ok: true, savedAt: new Date().toISOString(), content: saved });
  }
  return fail("Method not allowed", 405);
});

export const config = { path: "/api/content" };

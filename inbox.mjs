// Admin inbox: GET list, PATCH {key, handled}, DELETE {key} (optionally releasing a paid mini slot).
import { handle, json, fail, readJSON, requireAdmin, store, str } from "./_lib/core.mjs";

export default handle(async (req) => {
  requireAdmin(req);
  const inbox = store("inbox");
  if (req.method === "GET") {
    const { blobs } = await inbox.list();
    const items = (await Promise.all(blobs.map(async (b) => {
      const v = await inbox.get(b.key, { type: "json" });
      return v ? { key: b.key, ...v } : null;
    }))).filter(Boolean).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return json({ items });
  }
  const body = await readJSON(req, 5000);
  const key = str(body.key, 200);
  const item = key && (await inbox.get(key, { type: "json" }));
  if (!item) return fail("That message wasn't found.", 404);
  if (req.method === "PATCH") {
    if ("handled" in body) item.handled = !!body.handled;
    if (body.releaseSlot && item.miniId && item.slot) {
      await store("slots").delete(`${item.miniId}|${item.slot}`);
      item.slotReleased = true;
    }
    await inbox.setJSON(key, item);
    return json({ ok: true });
  }
  if (req.method === "DELETE") {
    if (body.releaseSlot && item.miniId && item.slot) await store("slots").delete(`${item.miniId}|${item.slot}`);
    await inbox.delete(key);
    return json({ ok: true });
  }
  return fail("Method not allowed", 405);
});

export const config = { path: "/api/inbox" };

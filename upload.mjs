// POST /api/upload (admin) — body is the image file (already resized in the browser).
import { handle, json, fail, requireAdmin, store, newId } from "./_lib/core.mjs";

const TYPES = ["image/jpeg", "image/png", "image/webp"];
export default handle(async (req) => {
  if (req.method !== "POST") return fail("Method not allowed", 405);
  requireAdmin(req);
  const type = (req.headers.get("content-type") || "").split(";")[0].trim();
  if (!TYPES.includes(type)) return fail("Please upload a JPG, PNG or WebP photo.");
  const buf = await req.arrayBuffer();
  if (!buf.byteLength) return fail("That file was empty.");
  if (buf.byteLength > 5.5 * 1024 * 1024) return fail("That photo is too large. Try one under 5 MB.", 413);
  const key = newId();
  await store("photos").set(key, buf, { metadata: { type, size: buf.byteLength, uploadedAt: Date.now() } });
  return json({ url: `/api/photo/${key}` });
});

export const config = { path: "/api/upload" };

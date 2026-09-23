// GET /api/photo/:key — serves an uploaded photo (cached for a year; keys never change).
import { handle, fail, store } from "./_lib/core.mjs";

export default handle(async (req, context) => {
  const key = context.params?.key || "";
  if (!/^[A-Za-z0-9-]{8,64}$/.test(key)) return fail("Not found", 404);
  const hit = await store("photos").getWithMetadata(key, { type: "arrayBuffer" });
  if (!hit || !hit.data) return fail("Not found", 404);
  return new Response(hit.data, {
    headers: {
      "content-type": hit.metadata?.type || "image/jpeg",
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
});

export const config = { path: "/api/photo/:key" };

// Admin: GET /api/calendar — is Google Calendar connected? POST {test:true} also writes + deletes a test event.
import { handle, json, fail, readJSON, requireAdmin } from "./_lib/core.mjs";
import { calendarCheck } from "./_lib/gcal.mjs";

export default handle(async (req) => {
  requireAdmin(req);
  if (req.method === "GET") return json(await calendarCheck());
  if (req.method === "POST") { const b = await readJSON(req, 1000); return json(await calendarCheck({ write: !!b.test })); }
  return fail("Method not allowed", 405);
});

export const config = { path: "/api/calendar" };

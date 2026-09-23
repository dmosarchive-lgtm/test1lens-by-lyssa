// POST /api/login {password} -> {token}
import { handle, json, fail, readJSON, checkPassword, makeToken } from "./_lib/core.mjs";

export default handle(async (req) => {
  if (req.method !== "POST") return fail("Method not allowed", 405);
  const { password } = await readJSON(req, 2000);
  if (!checkPassword(password)) {
    await new Promise((r) => setTimeout(r, 800)); // slow down guessing
    return fail("That password didn't work. Try again?", 401);
  }
  return json({ token: makeToken() });
});

export const config = { path: "/api/login" };

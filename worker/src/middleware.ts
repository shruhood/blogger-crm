import { Context, Next } from "hono";
import { verifyJwt } from "./utils/jwt";
import type { Env } from "./types";

// Attaches `c.set("user", payload)` if a valid Bearer token is present, else 401.
export async function requireAuth(c: Context<{ Bindings: Env; Variables: { user: any } }>, next: Next) {
  const auth = c.req.header("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return c.json({ error: "Missing token" }, 401);

  const payload = await verifyJwt(token, c.env.JWT_SECRET);
  if (!payload) return c.json({ error: "Invalid or expired token" }, 401);

  c.set("user", payload);
  await next();
}

// Use after requireAuth. Roles: admin > editor > viewer.
const ROLE_RANK: Record<string, number> = { viewer: 0, editor: 1, admin: 2 };

export function requireRole(minRole: "viewer" | "editor" | "admin") {
  return async (c: Context<{ Bindings: Env; Variables: { user: any } }>, next: Next) => {
    const user = c.get("user");
    if (!user || ROLE_RANK[user.role] < ROLE_RANK[minRole]) {
      return c.json({ error: "Insufficient permissions" }, 403);
    }
    await next();
  };
}

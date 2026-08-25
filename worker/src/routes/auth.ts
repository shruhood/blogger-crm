import { Hono } from "hono";
import type { Env } from "../types";
import { hashPassword, verifyPassword } from "../utils/password";
import { signJwt } from "../utils/jwt";
import { requireAuth, requireRole } from "../middleware";

const auth = new Hono<{ Bindings: Env; Variables: { user: any } }>();

// Register: the very FIRST user to register becomes 'admin' automatically.
// After that, only an existing admin can create new users (see /invite below).
auth.post("/register", async (c) => {
  const { email, password } = await c.req.json();
  if (!email || !password || password.length < 8) {
    return c.json({ error: "Email and password (min 8 chars) required" }, 400);
  }

  const { results } = await c.env.DB.prepare(`SELECT COUNT(*) as count FROM users`).all();
  const userCount = (results?.[0] as any)?.count ?? 0;

  if (userCount > 0) {
    return c.json({ error: "Registration is closed. Ask an admin to invite you." }, 403);
  }

  const id = crypto.randomUUID();
  const passwordHash = await hashPassword(password);
  await c.env.DB.prepare(`INSERT INTO users (id, email, password_hash, role) VALUES (?, ?, ?, 'admin')`)
    .bind(id, email.toLowerCase(), passwordHash)
    .run();

  const token = await signJwt(
    { sub: id, email, role: "admin", exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7 },
    c.env.JWT_SECRET
  );
  return c.json({ token, user: { id, email, role: "admin" } });
});

auth.post("/login", async (c) => {
  const { email, password } = await c.req.json();
  if (!email || !password) return c.json({ error: "Email and password required" }, 400);

  const user = await c.env.DB.prepare(`SELECT * FROM users WHERE email = ?`).bind(email.toLowerCase()).first();
  if (!user) return c.json({ error: "Invalid credentials" }, 401);

  const valid = await verifyPassword(password, user.password_hash as string);
  if (!valid) return c.json({ error: "Invalid credentials" }, 401);

  const token = await signJwt(
    {
      sub: user.id as string,
      email: user.email as string,
      role: user.role as string,
      exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7, // 7 days
    },
    c.env.JWT_SECRET
  );
  return c.json({ token, user: { id: user.id, email: user.email, role: user.role } });
});

// Admin-only: invite a teammate with a chosen role.
auth.post("/invite", requireAuth, requireRole("admin"), async (c) => {
  const { email, password, role } = await c.req.json();
  if (!email || !password || !["admin", "editor", "viewer"].includes(role)) {
    return c.json({ error: "email, password, and a valid role are required" }, 400);
  }

  const id = crypto.randomUUID();
  const passwordHash = await hashPassword(password);
  try {
    await c.env.DB.prepare(`INSERT INTO users (id, email, password_hash, role) VALUES (?, ?, ?, ?)`)
      .bind(id, email.toLowerCase(), passwordHash, role)
      .run();
  } catch {
    return c.json({ error: "A user with that email already exists" }, 409);
  }
  return c.json({ id, email, role });
});

auth.get("/me", requireAuth, async (c) => {
  return c.json({ user: c.get("user") });
});

export default auth;

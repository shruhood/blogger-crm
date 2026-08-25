import { Hono } from "hono";
import type { Env } from "../types";
import { hashPassword, verifyPassword } from "../utils/password";
import { signJwt } from "../utils/jwt";
import { requireAuth, requireRole } from "../middleware";
import { resolveBloggerBlogId, fetchBloggerTitle } from "../integrations/blogger";

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

// Admin-only: invite a teammate with a chosen role (legacy, password-based).
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

// Admin-only: create a shareable, one-time invite LINK.
// body: { email?, role? }  -> returns { token, link }
auth.post("/invite-link", requireAuth, requireRole("admin"), async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const role = ["admin", "editor", "viewer"].includes(body.role) ? body.role : "editor";
  const email = body.email ? String(body.email).toLowerCase() : null;
  const token = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  await c.env.DB.prepare(
    `INSERT INTO invites (token, email, role, created_by, expires_at) VALUES (?, ?, ?, ?, ?)`
  )
    .bind(token, email, role, c.get("user").sub, expires)
    .run();
  const origin = new URL(c.req.url).origin;
  return c.json({ token, link: `${origin}/join?token=${token}`, role, expires_at: expires });
});

// Public: validate an invite link (used by the /join page to pre-fill the form).
auth.get("/invite/:token", async (c) => {
  const token = c.req.param("token");
  const inv = await c.env.DB.prepare(`SELECT * FROM invites WHERE token = ?`).bind(token).first();
  if (!inv) return c.json({ error: "Invalid invite link" }, 404);
  if (inv.used_at) return c.json({ error: "This invite link has already been used" }, 410);
  if (new Date(inv.expires_at as string).getTime() < Date.now())
    return c.json({ error: "This invite link has expired" }, 410);
  return c.json({ role: inv.role, email: inv.email || null });
});

// Public: redeem an invite link — create the user AND optionally connect a Blogger site.
// body: { token, email, password, blog?: { url, apiKey } }
auth.post("/join", async (c) => {
  const { token, email, password, blog } = await c.req.json();
  if (!token || !email || !password || password.length < 8) {
    return c.json({ error: "token, email and password (min 8 chars) are required" }, 400);
  }

  const inv = await c.env.DB.prepare(`SELECT * FROM invites WHERE token = ?`).bind(token).first();
  if (!inv) return c.json({ error: "Invalid invite link" }, 404);
  if (inv.used_at) return c.json({ error: "This invite link has already been used" }, 410);
  if (new Date(inv.expires_at as string).getTime() < Date.now())
    return c.json({ error: "This invite link has expired" }, 410);
  if (inv.email && inv.email !== String(email).toLowerCase())
    return c.json({ error: "This invite link is locked to a different email address" }, 403);

  const existing = await c.env.DB.prepare(`SELECT id FROM users WHERE email = ?`)
    .bind(String(email).toLowerCase())
    .first();
  if (existing) return c.json({ error: "A user with that email already exists" }, 409);

  const userId = crypto.randomUUID();
  const passwordHash = await hashPassword(password);
  await c.env.DB.prepare(`INSERT INTO users (id, email, password_hash, role) VALUES (?, ?, ?, ?)`)
    .bind(userId, String(email).toLowerCase(), passwordHash, inv.role as string)
    .run();

  await c.env.DB.prepare(`UPDATE invites SET used_at = datetime('now') WHERE token = ?`).bind(token).run();

  let connectedBlog = null;
  if (blog && blog.url) {
    const blogId = await resolveBloggerBlogId(blog.url);
    if (!blogId) {
      // Still let the user in; surface the warning so they can add the blog later.
      return c.json(
        await issueJoinResult(c, userId, email, inv.role as string, null,
          "Account created, but we couldn't find a Blogger blogId for that URL. Add the site from your dashboard."),
        201
      );
    }
    const apiKey = blog.apiKey || "";
    const name = (apiKey ? await fetchBloggerTitle(apiKey, blogId) : null) || String(email).split("@")[0] + "'s Blogger";
    const blogRowId = crypto.randomUUID();
    await c.env.DB.prepare(
      `INSERT INTO blogs (id, name, source, config, webhook_token, owner_id) VALUES (?, ?, 'blogger', ?, NULL, ?)`
    )
      .bind(blogRowId, name, JSON.stringify({ apiKey, blogId }), userId)
      .run();
    connectedBlog = { id: blogRowId, name, blogId };
    return c.json(await issueJoinResult(c, userId, email, inv.role as string, connectedBlog, null), 201);
  }

  return c.json(await issueJoinResult(c, userId, email, inv.role as string, null, null), 201);
});

async function issueJoinResult(c: any, userId: string, email: string, role: string, blog: any, warning: string | null) {
  const token = await signJwt(
    { sub: userId, email, role, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7 },
    c.env.JWT_SECRET
  );
  return { token, user: { id: userId, email, role }, blog: blog || undefined, warning: warning || undefined };
}

auth.get("/me", requireAuth, async (c) => {
  return c.json({ user: c.get("user") });
});

export default auth;

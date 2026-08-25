import { Hono } from "hono";
import type { Env } from "../types";

// This route is intentionally NOT behind requireAuth — it's called directly
// from visitors' browsers via the tracking snippet. Security comes from the
// per-blog random webhook_token instead (see blogs.ts).
const webhook = new Hono<{ Bindings: Env }>();

webhook.post("/:blogId/:token", async (c) => {
  const { blogId, token } = c.req.param();

  const blog = await c.env.DB.prepare(`SELECT id FROM blogs WHERE id = ? AND webhook_token = ?`)
    .bind(blogId, token)
    .first();
  if (!blog) return c.json({ error: "Invalid webhook" }, 404);

  const body = await c.req.json().catch(() => ({}));
  await c.env.DB.prepare(`INSERT INTO pageviews (blog_id, url, referrer) VALUES (?, ?, ?)`)
    .bind(blogId, body.url || null, body.referrer || null)
    .run();

  return c.json({ ok: true });
});

export default webhook;

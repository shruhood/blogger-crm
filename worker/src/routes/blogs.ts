import { Hono } from "hono";
import type { Env } from "../types";
import { requireAuth, requireRole } from "../middleware";
import { syncBlog } from "../integrations/sync";
import { resolveBloggerBlogId } from "../integrations/blogger";

const blogs = new Hono<{ Bindings: Env; Variables: { user: any } }>();

blogs.use("*", requireAuth);

// Public-ish helper (still under requireAuth) to auto-resolve a Blogger blogId
// from a pasted site URL, so users never have to dig it out of the dashboard.
blogs.post("/resolve", async (c) => {
  const { url } = await c.req.json();
  if (!url) return c.json({ error: "url is required" }, 400);
  const blogId = await resolveBloggerBlogId(url);
  if (!blogId) return c.json({ error: "Could not find a Blogger blogId for that URL" }, 404);
  return c.json({ blogId, url });
});
blogs.get("/", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT b.id, b.name, b.source, b.created_at,
            (SELECT COUNT(*) FROM posts p WHERE p.blog_id = b.id) as post_count,
            (SELECT COUNT(*) FROM pageviews pv WHERE pv.blog_id = b.id AND pv.created_at >= datetime('now', '-30 days')) as pageviews_30d
     FROM blogs b ORDER BY b.created_at DESC`
  ).all();
  return c.json({ blogs: results });
});

// Add a new blog connection. body: { name, source: 'blogger'|'wordpress'|'custom', config: {...} }
blogs.post("/", requireRole("editor"), async (c) => {
  const { name, source, config } = await c.req.json();
  if (!name || !["blogger", "wordpress", "custom"].includes(source)) {
    return c.json({ error: "name and a valid source are required" }, 400);
  }

  const id = crypto.randomUUID();
  const user = c.get("user");
  const webhookToken = source === "custom" ? crypto.randomUUID() : null;

  await c.env.DB.prepare(
    `INSERT INTO blogs (id, name, source, config, webhook_token, owner_id) VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(id, name, source, JSON.stringify(config || {}), webhookToken, user.sub)
    .run();

  const response: any = { id, name, source, webhookToken };
  if (source === "custom") {
    response.snippetInstructions = `Add this to your blog's <head>, right after the <body> tag:
<script>fetch("${new URL(c.req.url).origin}/api/webhook/${id}/${webhookToken}",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({url:location.href,referrer:document.referrer})});</script>`;
  }
  return c.json(response, 201);
});

// Get one blog with its recent posts
blogs.get("/:id", async (c) => {
  const id = c.req.param("id");
  const blog = await c.env.DB.prepare(`SELECT * FROM blogs WHERE id = ?`).bind(id).first();
  if (!blog) return c.json({ error: "Not found" }, 404);

  const { results: posts } = await c.env.DB.prepare(
    `SELECT id, title, url, published_at FROM posts WHERE blog_id = ? ORDER BY published_at DESC LIMIT 50`
  )
    .bind(id)
    .all();

  const { results: dailyViews } = await c.env.DB.prepare(
    `SELECT date(created_at) as day, COUNT(*) as views FROM pageviews
     WHERE blog_id = ? AND created_at >= datetime('now', '-30 days')
     GROUP BY day ORDER BY day ASC`
  )
    .bind(id)
    .all();

  const config = JSON.parse(blog.config as string);
  return c.json({
    blog: { ...blog, config: undefined, source: blog.source, webhookUrl: blog.webhook_token ? `/api/webhook/${blog.id}/${blog.webhook_token}` : undefined },
    posts,
    dailyViews,
  });
});

// Manually trigger a sync for one blog (Blogger/WordPress only)
blogs.post("/:id/sync", requireRole("editor"), async (c) => {
  const id = c.req.param("id");
  const blog = await c.env.DB.prepare(`SELECT * FROM blogs WHERE id = ?`).bind(id).first();
  if (!blog) return c.json({ error: "Not found" }, 404);
  if (blog.source === "custom") return c.json({ error: "Custom blogs sync automatically via webhook, not on demand" }, 400);

  try {
    await syncBlog(c.env.DB, blog);
    return c.json({ ok: true });
  } catch (err: any) {
    return c.json({ error: err.message }, 502);
  }
});

blogs.delete("/:id", requireRole("admin"), async (c) => {
  const id = c.req.param("id");
  await c.env.DB.prepare(`DELETE FROM pageviews WHERE blog_id = ?`).bind(id).run();
  await c.env.DB.prepare(`DELETE FROM posts WHERE blog_id = ?`).bind(id).run();
  await c.env.DB.prepare(`DELETE FROM blogs WHERE id = ?`).bind(id).run();
  return c.json({ ok: true });
});

export default blogs;

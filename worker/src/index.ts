import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "./types";
import authRoutes from "./routes/auth";
import blogRoutes from "./routes/blogs";
import webhookRoutes from "./routes/webhook";
import { syncAllBlogs } from "./integrations/sync";

const app = new Hono<{ Bindings: Env }>();

app.use("*", async (c, next) => {
  const allowed = c.env.ALLOWED_ORIGINS.split(",").map((s) => s.trim());
  return cors({ origin: allowed, allowHeaders: ["Content-Type", "Authorization"] })(c, next);
});

app.get("/api/health", (c) => c.json({ ok: true, time: new Date().toISOString() }));

app.route("/api/auth", authRoutes);
app.route("/api/blogs", blogRoutes);
app.route("/api/webhook", webhookRoutes);

app.notFound((c) => c.json({ error: "Not found" }, 404));
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "Internal server error" }, 500);
});

export default {
  fetch: app.fetch,
  // Runs on the cron schedule set in wrangler.toml — pulls fresh posts
  // from every connected Blogger/WordPress blog automatically.
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(syncAllBlogs(env));
  },
};

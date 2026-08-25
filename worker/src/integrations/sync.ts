import type { Env } from "../types";
import { fetchBloggerPosts } from "./blogger";
import { fetchWordPressPosts } from "./wordpress";

export async function syncBlog(db: D1Database, blog: any) {
  const config = JSON.parse(blog.config);
  let posts;

  if (blog.source === "blogger") {
    posts = await fetchBloggerPosts(config);
  } else if (blog.source === "wordpress") {
    posts = await fetchWordPressPosts(config);
  } else {
    return; // 'custom' blogs don't have a pull-based sync — they push via webhook
  }

  for (const p of posts) {
    await db
      .prepare(
        `INSERT INTO posts (id, blog_id, external_id, title, url, published_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(blog_id, external_id) DO UPDATE SET
           title = excluded.title, url = excluded.url, published_at = excluded.published_at, synced_at = datetime('now')`
      )
      .bind(crypto.randomUUID(), blog.id, p.externalId, p.title, p.url, p.publishedAt)
      .run();
  }
}

export async function syncAllBlogs(env: Env) {
  const { results } = await env.DB.prepare(
    `SELECT * FROM blogs WHERE source IN ('blogger', 'wordpress')`
  ).all();
  for (const blog of results || []) {
    try {
      await syncBlog(env.DB, blog);
    } catch (err) {
      console.error(`Sync failed for blog ${blog.id}:`, err);
    }
  }
}

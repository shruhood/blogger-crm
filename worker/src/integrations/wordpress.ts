// Pulls recent posts from any self-hosted WordPress site's public REST API.
// config shape: { "baseUrl": "https://example.com" }  (no trailing slash)
// No auth needed for public sites — WP exposes /wp-json/wp/v2/posts by default.

import type { FetchedPost } from "./blogger";

export async function fetchWordPressPosts(config: { baseUrl: string }): Promise<FetchedPost[]> {
  const url = `${config.baseUrl.replace(/\/$/, "")}/wp-json/wp/v2/posts?per_page=20&_fields=id,link,title,date`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`WordPress API error: ${res.status} ${await res.text()}`);
  const items: any[] = await res.json();
  return items.map((p) => ({
    externalId: String(p.id),
    title: p.title?.rendered || "(untitled)",
    url: p.link,
    publishedAt: p.date,
  }));
}

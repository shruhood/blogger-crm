// Pulls recent posts from a Blogger.com blog via the public Blogger API v3.
// config shape: { "apiKey": "***", "blogId": "..." }
// Get an API key at https://console.cloud.google.com (enable "Blogger API v3").
// Get your blogId from Blogger dashboard > Settings, or via the API's "byurl" lookup.

export interface FetchedPost {
  externalId: string;
  title: string;
  url: string;
  publishedAt: string;
}

// Returns the Blogger name/title for a given blogId, used to pre-fill the display name.
export async function fetchBloggerTitle(apiKey: string, blogId: string): Promise<string | null> {
  const url = `https://www.googleapis.com/blogger/v3/blogs/${blogId}?key=${apiKey}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data: any = await res.json();
    return data.name || null;
  } catch {
    return null;
  }
}

// Auto-resolves a Blogger blogId from a site URL (no API key needed — uses the
// public Atom feed). Accepts a homepage, a /feeds/posts/default URL, or a blogspot host.
// Returns the numeric blogId or null if it can't be found.
export async function resolveBloggerBlogId(siteUrl: string): Promise<string | null> {
  let base: string;
  try {
    const u = new URL(siteUrl.trim());
    base = `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }

  // Try the public Atom feed first (no key required).
  const candidates = [
    `${base}/feeds/posts/default?max-results=1`,
    `${base}/feeds/posts/default`,
  ];
  for (const feed of candidates) {
    try {
      const res = await fetch(feed);
      if (!res.ok) continue;
      const xml = await res.text();
      const m = xml.match(/blog-(\d+)/);
      if (m) return m[1];
    } catch {
      // try next candidate
    }
  }
  return null;
}

export async function fetchBloggerPosts(config: { apiKey: string; blogId: string }): Promise<FetchedPost[]> {
  const url = `https://www.googleapis.com/blogger/v3/blogs/${config.blogId}/posts?key=${config.apiKey}&maxResults=20&fetchBodies=false`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Blogger API error: ${res.status} ${await res.text()}`);
  const data: any = await res.json();
  const items = data.items || [];
  return items.map((p: any) => ({
    externalId: p.id,
    title: p.title,
    url: p.url,
    publishedAt: p.published,
  }));
}

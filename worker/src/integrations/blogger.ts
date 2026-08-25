// Pulls recent posts from a Blogger.com blog via the public Blogger API v3.
// config shape: { "apiKey": "...", "blogId": "..." }
// Get an API key at https://console.cloud.google.com (enable "Blogger API v3").
// Get your blogId from Blogger dashboard > Settings, or via the API's "byurl" lookup.

export interface FetchedPost {
  externalId: string;
  title: string;
  url: string;
  publishedAt: string;
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

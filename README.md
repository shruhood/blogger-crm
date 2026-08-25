# Blogger CRM — Cloudflare Free-Tier Stack

A multi-blog content/analytics dashboard: Worker API + D1 database (backend),
Cloudflare Pages (frontend). No paid tier required.

**What it does**
- Connect multiple blogs: Blogger.com, self-hosted WordPress, or any custom site (via a small tracking snippet)
- Auto-pulls posts hourly from Blogger/WordPress (Cron Trigger)
- Collects pageviews from custom sites via a webhook
- Dashboard: per-blog post list + 30-day pageview chart
- Multi-user login with roles: **admin** (manage users/blogs/delete), **editor** (add/sync blogs), **viewer** (read-only)

**Free tier limits to know**
- Workers: 100,000 requests/day
- D1: 5GB storage, 5M rows read/day, 100k rows written/day
- Pages: unlimited static requests, 500 builds/month
- Cron Triggers: included free, this project uses 1 (hourly)

This project comfortably fits inside the free tier for a small-to-medium set of blogs.

---

## 1. Prerequisites

```bash
npm install -g wrangler
wrangler login
```

## 2. Set up the Worker API

```bash
cd worker
npm install
```

Create the D1 database:

```bash
npm run db:create
```

This prints a `database_id` — copy it into `wrangler.toml` (`database_id = "..."`).

Generate a JWT secret and put it in `wrangler.toml` too:

```bash
openssl rand -hex 32
```

Initialize the schema (local dev DB, then the real remote one):

```bash
npm run db:init
npm run db:init:remote
```

Update `ALLOWED_ORIGINS` in `wrangler.toml` once you know your Pages URL (step 3).

Deploy:

```bash
npm run deploy
```

Wrangler prints your Worker URL, e.g. `https://blogger-crm-api.yourname.workers.dev` — copy it.

## 3. Set up the Pages frontend

Open `pages/index.html` and set:

```js
window.API_BASE = "https://blogger-crm-api.yourname.workers.dev";
```

Deploy the `pages/` folder to Cloudflare Pages — easiest via dashboard:
1. Cloudflare dashboard → Workers & Pages → Create → Pages → **Direct upload**
2. Upload the `pages/` folder (or connect a git repo pointing at that folder)
3. No build command needed — it's static files

Or via CLI:

```bash
cd pages
wrangler pages deploy . --project-name=blogger-crm
```

Copy the resulting `*.pages.dev` URL back into `worker/wrangler.toml`'s
`ALLOWED_ORIGINS`, then re-run `npm run deploy` in `worker/`.

## 4. First login

Visit your Pages URL → "First time? Create admin account" → this becomes the
one and only way to self-register. After that, new teammates are added via
the "Invite user" button (admin only).

## 5. Connecting blogs

- **Blogger.com**: create an API key at console.cloud.google.com (enable "Blogger API v3"), grab your blog ID from Blogger's dashboard settings URL.
- **WordPress**: just needs the site's base URL — uses the public `/wp-json/wp/v2/posts` endpoint, no auth.
- **Custom site**: after adding, you'll get a `<script>` snippet — paste it into your site's template to start logging pageviews.

## Extending it

- `worker/src/integrations/` — add a new file here (e.g. `medium.ts`) and wire it into `sync.ts` to support another platform
- `worker/src/db/schema.sql` — add tables/columns, then re-run the `db:init*` scripts
- `pages/assets/app.js` — plain JS, no build step; edit and redeploy

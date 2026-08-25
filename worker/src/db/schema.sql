-- Users of the CRM dashboard (your team, not blog readers)
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer', -- 'admin' | 'editor' | 'viewer'
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Each connected blog site
CREATE TABLE IF NOT EXISTS blogs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  source TEXT NOT NULL,          -- 'blogger' | 'wordpress' | 'custom'
  config TEXT NOT NULL,          -- JSON, shape depends on source (see integrations/)
  webhook_token TEXT,            -- used by 'custom' source to authenticate snippet POSTs
  owner_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (owner_id) REFERENCES users(id)
);

-- Posts synced in from Blogger / WordPress, or logged manually
CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,
  blog_id TEXT NOT NULL,
  external_id TEXT,
  title TEXT,
  url TEXT,
  published_at TEXT,
  synced_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (blog_id) REFERENCES blogs(id),
  UNIQUE (blog_id, external_id)
);

-- Raw pageview events, from the tracking snippet (or any source that calls the webhook)
CREATE TABLE IF NOT EXISTS pageviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  blog_id TEXT NOT NULL,
  url TEXT,
  referrer TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (blog_id) REFERENCES blogs(id)
);

CREATE INDEX IF NOT EXISTS idx_pageviews_blog_time ON pageviews(blog_id, created_at);
CREATE INDEX IF NOT EXISTS idx_posts_blog ON posts(blog_id);

-- Shareable, one-time invite links used by the /join self-signup flow.
CREATE TABLE IF NOT EXISTS invites (
  token TEXT PRIMARY KEY,
  email TEXT,                 -- optional: lock the link to one email address
  role TEXT NOT NULL DEFAULT 'editor',  -- role the new user receives
  created_by TEXT NOT NULL,
  expires_at TEXT NOT NULL,   -- ISO timestamp
  used_at TEXT,               -- null until consumed
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_invites_used ON invites(used_at);

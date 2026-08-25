// Blogger CRM — tiny vanilla-JS SPA. No framework, no build step:
// just static files Cloudflare Pages can serve directly on the free tier.

const state = {
  token: localStorage.getItem("bcrm_token") || null,
  user: JSON.parse(localStorage.getItem("bcrm_user") || "null"),
  view: "loading",
  blogs: [],
  activeBlog: null,
  error: null,
};

const app = document.getElementById("app");

async function api(path, opts = {}) {
  const res = await fetch(`${window.API_BASE}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
      ...(opts.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function setToken(token, user) {
  state.token = token;
  state.user = user;
  localStorage.setItem("bcrm_token", token);
  localStorage.setItem("bcrm_user", JSON.stringify(user));
}

function logout() {
  state.token = null;
  state.user = null;
  localStorage.removeItem("bcrm_token");
  localStorage.removeItem("bcrm_user");
  render("login");
}

// ---------- Views ----------

function renderLogin(isRegister) {
  app.innerHTML = `
    <div class="center-screen">
      <form class="card" id="authForm">
        <h1>${isRegister ? "Create admin account" : "Sign in"}</h1>
        <p class="sub">${isRegister ? "First-time setup — this account becomes the admin." : "Blogger CRM dashboard"}</p>
        ${state.error ? `<div class="error">${state.error}</div>` : ""}
        <input type="email" name="email" placeholder="Email" required />
        <input type="password" name="password" placeholder="Password" required minlength="8" />
        <button type="submit">${isRegister ? "Create account" : "Sign in"}</button>
        <p style="text-align:center;margin-top:14px;">
          <button type="button" class="link-btn" id="toggleAuth">
            ${isRegister ? "Already set up? Sign in" : "First time? Create admin account"}
          </button>
        </p>
      </form>
    </div>`;

  document.getElementById("toggleAuth").onclick = () => renderLogin(!isRegister);
  document.getElementById("authForm").onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = { email: fd.get("email"), password: fd.get("password") };
    try {
      const data = await api(isRegister ? "/api/auth/register" : "/api/auth/login", {
        method: "POST",
        body: JSON.stringify(body),
      });
      setToken(data.token, data.user);
      state.error = null;
      render("dashboard");
    } catch (err) {
      state.error = err.message;
      renderLogin(isRegister);
    }
  };
}

function topbar() {
  return `
    <div class="topbar">
      <div class="brand">📊 Blogger CRM</div>
      <div class="right">
        <span class="role-badge">${state.user.role}</span>
        <span>${state.user.email}</span>
        <button class="secondary" style="width:auto;padding:6px 12px;" id="logoutBtn">Log out</button>
      </div>
    </div>`;
}

async function renderDashboard() {
  app.innerHTML = topbar() + `<div class="container"><div class="empty">Loading blogs…</div></div>`;
  wireTopbar();

  try {
    const data = await api("/api/blogs");
    state.blogs = data.blogs;
  } catch (err) {
    if (err.message.includes("token")) return logout();
    app.querySelector(".container").innerHTML = `<div class="error">${err.message}</div>`;
    return;
  }

  const canEdit = state.user.role === "editor" || state.user.role === "admin";

  app.innerHTML =
    topbar() +
    `<div class="container">
      <div class="row">
        <h2>Your blogs</h2>
        <div style="display:flex;gap:8px;">
          ${state.user.role === "admin" ? `<button class="secondary" style="width:auto;padding:8px 14px;" id="inviteBtn">Invite user</button>` : ""}
          ${canEdit ? `<button style="width:auto;padding:8px 14px;" id="addBlogBtn">+ Add blog</button>` : ""}
        </div>
      </div>
      ${
        state.blogs.length === 0
          ? `<div class="empty">No blogs connected yet. Add your first one to start pulling in posts &amp; pageviews.</div>`
          : `<div class="grid">${state.blogs.map(blogCardHtml).join("")}</div>`
      }
    </div>`;

  wireTopbar();
  document.querySelectorAll(".blog-card").forEach((el) => {
    el.onclick = () => renderBlogDetail(el.dataset.id);
  });
  const addBtn = document.getElementById("addBlogBtn");
  if (addBtn) addBtn.onclick = () => renderAddBlogModal();
  const inviteBtn = document.getElementById("inviteBtn");
  if (inviteBtn) inviteBtn.onclick = () => renderInviteModal();
}

function blogCardHtml(b) {
  const sourceLabel = { blogger: "Blogger", wordpress: "WordPress", custom: "Custom / snippet" }[b.source];
  return `
    <div class="blog-card" data-id="${b.id}">
      <div class="name">${b.name}</div>
      <span class="source-tag">${sourceLabel}</span>
      <div class="stats">
        <span><b>${b.post_count}</b> posts</span>
        <span><b>${b.pageviews_30d}</b> views/30d</span>
      </div>
    </div>`;
}

async function renderBlogDetail(id) {
  app.innerHTML = topbar() + `<div class="container"><div class="empty">Loading…</div></div>`;
  wireTopbar();

  const data = await api(`/api/blogs/${id}`);
  const { blog, posts, dailyViews } = data;
  const canEdit = state.user.role === "editor" || state.user.role === "admin";
  const maxViews = Math.max(1, ...dailyViews.map((d) => d.views));

  app.innerHTML =
    topbar() +
    `<div class="container">
      <button class="back-btn" id="backBtn">← Back to blogs</button>
      <div class="row">
        <h2>${blog.name}</h2>
        <div style="display:flex;gap:8px;">
          ${
            blog.source !== "custom" && canEdit
              ? `<button class="secondary" style="width:auto;padding:8px 14px;" id="syncBtn">Sync now</button>`
              : ""
          }
          ${state.user.role === "admin" ? `<button class="danger" style="width:auto;padding:8px 14px;" id="deleteBtn">Delete</button>` : ""}
        </div>
      </div>

      ${
        blog.webhookUrl
          ? `<div class="snippet-box">Webhook endpoint (already installed via your snippet):<br/>${window.API_BASE}${blog.webhookUrl}</div>`
          : ""
      }

      <h3>Pageviews — last 30 days</h3>
      ${
        dailyViews.length
          ? `<div class="chart-bars">${dailyViews
              .map((d) => `<div class="chart-bar" style="height:${(d.views / maxViews) * 100}%" title="${d.day}: ${d.views}"></div>`)
              .join("")}</div>`
          : `<div class="empty">No pageview data yet.</div>`
      }

      <h3>Recent posts</h3>
      ${
        posts.length
          ? `<table>
              <thead><tr><th>Title</th><th>Published</th></tr></thead>
              <tbody>
                ${posts
                  .map(
                    (p) =>
                      `<tr><td><a href="${p.url}" target="_blank" rel="noopener">${p.title || "(untitled)"}</a></td><td>${new Date(
                        p.published_at
                      ).toLocaleDateString()}</td></tr>`
                  )
                  .join("")}
              </tbody>
            </table>`
          : `<div class="empty">No posts synced yet.</div>`
      }
    </div>`;

  wireTopbar();
  document.getElementById("backBtn").onclick = () => renderDashboard();
  const syncBtn = document.getElementById("syncBtn");
  if (syncBtn)
    syncBtn.onclick = async () => {
      syncBtn.disabled = true;
      syncBtn.textContent = "Syncing…";
      try {
        await api(`/api/blogs/${id}/sync`, { method: "POST" });
        renderBlogDetail(id);
      } catch (err) {
        alert(err.message);
        syncBtn.disabled = false;
        syncBtn.textContent = "Sync now";
      }
    };
  const deleteBtn = document.getElementById("deleteBtn");
  if (deleteBtn)
    deleteBtn.onclick = async () => {
      if (!confirm(`Delete "${blog.name}" and all its data? This can't be undone.`)) return;
      await api(`/api/blogs/${id}`, { method: "DELETE" });
      renderDashboard();
    };
}

function renderAddBlogModal() {
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal">
      <h3>Add a blog</h3>
      <form id="addBlogForm">
        <input name="name" placeholder="Display name (e.g. My Travel Blog)" required />
        <select name="source" id="sourceSelect">
          <option value="blogger">Blogger.com</option>
          <option value="wordpress">WordPress (self-hosted)</option>
          <option value="custom">Custom site (tracking snippet)</option>
        </select>
        <div id="sourceFields"></div>
        <div class="error" id="modalError" style="display:none;"></div>
        <button type="submit">Add blog</button>
        <button type="button" class="secondary" id="cancelBtn" style="margin-top:8px;">Cancel</button>
      </form>
    </div>`;
  document.body.appendChild(backdrop);

  const fieldsFor = {
    blogger: `<input name="url" placeholder="Your Blogger site URL (e.g. https://mysite.blogspot.com)" required />
               <button type="button" class="secondary" id="resolveBtn" style="width:auto;padding:8px 12px;margin-bottom:6px;">Auto-detect blog ID</button>
               <input name="apiKey" placeholder="Google Blogger API key" required />
               <input name="blogId" placeholder="Blogger blog ID (auto-filled)" required />`,
    wordpress: `<input name="baseUrl" placeholder="https://yourblog.com" required />`,
    custom: `<p class="sub" style="margin-bottom:12px;">You'll get a tracking snippet to paste into your site after adding it.</p>`,
  };
  const sourceSelect = backdrop.querySelector("#sourceSelect");
  const fieldsDiv = backdrop.querySelector("#sourceFields");
  const updateFields = () => (fieldsDiv.innerHTML = fieldsFor[sourceSelect.value]);
  updateFields();
  sourceSelect.onchange = updateFields;

  const resolveBtn = backdrop.querySelector("#resolveBtn");
  if (resolveBtn) {
    resolveBtn.onclick = async () => {
      const url = backdrop.querySelector('input[name="url"]').value;
      if (!url) return alert("Enter your Blogger site URL first.");
      resolveBtn.disabled = true;
      resolveBtn.textContent = "Detecting…";
      try {
        const r = await api("/api/blogs/resolve", { method: "POST", body: JSON.stringify({ url }) });
        backdrop.querySelector('input[name="blogId"]').value = r.blogId;
        resolveBtn.textContent = "Detected!";
      } catch (err) {
        resolveBtn.textContent = "Auto-detect";
        alert(err.message);
      }
      resolveBtn.disabled = false;
    };
  }

  backdrop.querySelector("#cancelBtn").onclick = () => backdrop.remove();

  backdrop.querySelector("#addBlogForm").onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const source = fd.get("source");
    const name = fd.get("name");
    let config = {};
    if (source === "blogger") {
      // Prefer an explicitly entered blogId; otherwise resolve from the URL.
      let blogId = fd.get("blogId");
      if (!blogId && fd.get("url")) {
        const r = await api("/api/blogs/resolve", { method: "POST", body: JSON.stringify({ url: fd.get("url") }) });
        blogId = r.blogId;
      }
      config = { apiKey: fd.get("apiKey"), blogId, url: fd.get("url") || "" };
    }
    if (source === "wordpress") config = { baseUrl: fd.get("baseUrl") };

    try {
      const result = await api("/api/blogs", { method: "POST", body: JSON.stringify({ name, source, config }) });
      backdrop.remove();
      if (result.snippetInstructions) {
        alert("Blog added! Paste this snippet into your site:\n\n" + result.snippetInstructions);
      }
      renderDashboard();
    } catch (err) {
      const errEl = backdrop.querySelector("#modalError");
      errEl.textContent = err.message;
      errEl.style.display = "block";
    }
  };
}

function renderInviteModal() {
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal">
      <h3>Invite a teammate</h3>
      <p class="sub">Option A — shareable signup link (recommended): send the link, they set their own password and are added automatically.</p>
      <div style="display:flex;gap:8px;margin-bottom:6px;">
        <input id="inviteLinkOut" readonly placeholder="Create a link below" style="flex:1;" />
        <button type="button" class="secondary" id="copyLinkBtn" style="width:auto;padding:8px 12px;">Copy</button>
      </div>
      <button type="button" id="genLinkBtn" style="width:auto;padding:8px 14px;margin-bottom:14px;">+ Create invite link</button>
      <hr style="border-color:rgba(255,255,255,.1);margin:14px 0;" />
      <p class="sub">Option B — manual invite (temporary password):</p>
      <form id="inviteForm">
        <input name="email" type="email" placeholder="Email" required />
        <input name="password" type="password" placeholder="Temporary password (min 8 chars)" required minlength="8" />
        <select name="role">
          <option value="viewer">Viewer — read-only</option>
          <option value="editor">Editor — manage blogs</option>
          <option value="admin">Admin — full access</option>
        </select>
        <div class="error" id="inviteError" style="display:none;"></div>
        <button type="submit">Send invite</button>
        <button type="button" class="secondary" id="cancelInvite" style="margin-top:8px;">Cancel</button>
      </form>
    </div>`;
  document.body.appendChild(backdrop);
  backdrop.querySelector("#cancelInvite").onclick = () => backdrop.remove();

  backdrop.querySelector("#genLinkBtn").onclick = async () => {
    try {
      const role = backdrop.querySelector('select[name="role"]').value || "editor";
      const data = await api("/api/auth/invite-link", { method: "POST", body: JSON.stringify({ role }) });
      const link = `${location.origin}/#/join?token=${data.token}`;
      backdrop.querySelector("#inviteLinkOut").value = link;
      alert("Invite link ready — share it. It can be used once and expires in 7 days.");
    } catch (err) {
      const errEl = backdrop.querySelector("#inviteError");
      errEl.textContent = err.message;
      errEl.style.display = "block";
    }
  };
  backdrop.querySelector("#copyLinkBtn").onclick = () => {
    const v = backdrop.querySelector("#inviteLinkOut").value;
    if (v) { navigator.clipboard?.writeText(v); backdrop.querySelector("#copyLinkBtn").textContent = "Copied!"; }
  };

  backdrop.querySelector("#inviteForm").onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api("/api/auth/invite", {
        method: "POST",
        body: JSON.stringify({ email: fd.get("email"), password: fd.get("password"), role: fd.get("role") }),
      });
      backdrop.remove();
      alert("User invited. Share their email + temporary password with them.");
    } catch (err) {
      const errEl = backdrop.querySelector("#inviteError");
      errEl.textContent = err.message;
      errEl.style.display = "block";
    }
  };
}

// ---------- Join (self-signup via shareable link) ----------
function renderJoin() {
  // Token is in the URL hash (e.g. #/join?token=...), so static Pages serves
  // the SPA without needing server-side rewrites.
  const hash = location.hash.replace(/^#/, "") || location.search;
  const params = new URLSearchParams(hash.startsWith("/") ? hash.slice(hash.indexOf("?") + 1) : hash);
  const token = params.get("token");
  app.innerHTML = `
    <div class="center-screen">
      <form class="card" id="joinForm">
        <h1>Join Blogger CRM</h1>
        <p class="sub" id="joinSub">Set up your account via the invite link.</p>
        ${state.error ? `<div class="error">${state.error}</div>` : ""}
        <input type="email" name="email" placeholder="Email" required />
        <input type="password" name="password" placeholder="Choose a password (min 8 chars)" required minlength="8" />
        <label style="display:flex;align-items:center;gap:8px;margin:6px 0 2px;font-size:13px;opacity:.85;">
          <input type="checkbox" name="connectBlog" checked /> Also connect my Blogger site now
        </label>
        <div id="blogFields">
          <input name="blogUrl" placeholder="Your Blogger site URL (e.g. https://mysite.blogspot.com)" />
          <input name="apiKey" placeholder="Google Blogger API key" />
          <p class="sub" style="margin-top:4px;">We auto-detect your blog ID from the URL. Get an API key at Google Cloud console → enable "Blogger API v3".</p>
        </div>
        <button type="submit">Create account</button>
      </form>
    </div>`;

  const blogFields = document.getElementById("blogFields");
  const connectBox = document.querySelector('input[name="connectBlog"]');
  const toggleBlog = () => (blogFields.style.display = connectBox.checked ? "block" : "none");
  connectBox.onchange = toggleBlog;
  toggleBlog();

  if (token) {
    api(`/api/auth/invite/${token}`)
      .then((d) => { if (d.email) document.querySelector('input[name="email"]').value = d.email; })
      .catch(() => { document.getElementById("joinSub").textContent = "This invite link is invalid or expired."; });
  } else {
    document.getElementById("joinSub").textContent = "Missing invite token in the link.";
  }

  document.getElementById("joinForm").onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const blog = connectBox.checked
      ? { url: fd.get("blogUrl"), apiKey: fd.get("apiKey") }
      : null;
    try {
      const data = await api("/api/auth/join", {
        method: "POST",
        body: JSON.stringify({ token, email: fd.get("email"), password: fd.get("password"), blog }),
      });
      setToken(data.token, data.user);
      state.error = null;
      alert("Welcome! Your account is ready" + (data.blog ? " and your Blogger site was connected." : "."));
      render("dashboard");
    } catch (err) {
      state.error = err.message;
      renderJoin();
    }
  };
}

function wireTopbar() {
  const btn = document.getElementById("logoutBtn");
  if (btn) btn.onclick = logout;
}

function render(view) {
  state.view = view;
  if (view === "login") renderLogin(false);
  if (view === "dashboard") renderDashboard();
  if (view === "join") renderJoin();
}

// ---------- Boot ----------
const _bootHash = location.hash.replace(/^#/, "");
if (_bootHash.startsWith("/join")) {
  render("join");
} else if (state.token && state.user) {
  render("dashboard");
} else {
  render("login");
}

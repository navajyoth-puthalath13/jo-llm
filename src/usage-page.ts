// The private usage page: /usage (HTML), /usage/app.css, /usage/app.js.
// Static files with no data in them. The script asks for the admin token, keeps it in
// sessionStorage for this tab only, and reads /usage/data with it. Everything is rendered with
// textContent, never innerHTML.

export const USAGE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Jo usage</title>
<link rel="stylesheet" href="/usage/app.css">
</head>
<body>
<main>
  <header>
    <div>
      <h1>Jo usage</h1>
      <p class="muted" id="updated">Loading…</p>
    </div>
    <div class="actions">
      <button id="refresh" type="button">Refresh</button>
      <button id="signout" type="button" class="ghost">Sign out</button>
    </div>
  </header>

  <form id="login" hidden>
    <label for="token">Admin token</label>
    <input id="token" type="password" autocomplete="current-password" required>
    <button type="submit">Open</button>
    <p class="muted">Kept for this tab only. Set it with <code>npx wrangler secret put ADMIN_TOKEN</code>.</p>
    <p class="error" id="login-error" hidden></p>
  </form>

  <div id="content" hidden></div>

  <p class="muted foot">
    Counted by Jo's Worker. Tests run from a laptop (<code>npm run eval</code>, <code>npm run ask</code> on localhost)
    use the same keys but aren't counted here; "Check Groq now" asks Groq directly.
  </p>
</main>
<script src="/usage/app.js"></script>
</body>
</html>`;

export const USAGE_CSS = `
:root {
  --bg: #161616; --card: #1f1f1f; --line: #2e2e2e; --text: #ececec; --muted: #8d8d8d;
  --track: #333; --blue: #4f86e0; --amber: #e0a43a; --red: #e05a52; --green: #4caf6e;
  color-scheme: dark;
}
* { box-sizing: border-box; }
[hidden] { display: none !important; }
body { margin: 0; background: var(--bg); color: var(--text);
  font: 15px/1.45 -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif; }
main { max-width: 760px; margin: 0 auto; padding: 32px 16px 48px; }
header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 20px; }
h1 { font-size: 24px; margin: 0 0 4px; font-weight: 600; }
h2 { font-size: 17px; margin: 0; font-weight: 600; }
.muted { color: var(--muted); margin: 0; font-size: 13px; }
.actions { display: flex; gap: 8px; }
button { background: #2b2b2b; color: var(--text); border: 1px solid #3a3a3a; border-radius: 10px;
  padding: 7px 14px; font: inherit; font-size: 14px; cursor: pointer; }
button:hover { background: #333; }
button.ghost { background: transparent; }
button:disabled { opacity: .5; cursor: default; }
.card { background: var(--card); border: 1px solid var(--line); border-radius: 18px; padding: 20px 22px; margin-bottom: 14px; }
.card-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; margin-bottom: 14px; }
.tag { font-size: 12px; color: var(--muted); }
.badges { display: flex; gap: 6px; flex-wrap: wrap; }
.badge { font-size: 12px; border-radius: 999px; padding: 2px 10px; border: 1px solid var(--line); color: var(--muted); }
.badge.on { color: var(--green); border-color: #2f5a3d; }
.badge.off { color: var(--red); border-color: #5a2f2f; }
.badge.test { color: var(--amber); border-color: #5a4a2a; }
.meter { margin: 0 0 16px; }
.meter:last-child { margin-bottom: 0; }
.row { display: flex; justify-content: space-between; gap: 12px; }
.row .label { font-size: 15px; }
.row .value { color: var(--muted); font-size: 14px; white-space: nowrap; }
.bar { height: 8px; background: var(--track); border-radius: 999px; margin: 8px 0 6px; overflow: hidden; }
.fill { height: 100%; background: var(--blue); border-radius: 999px; }
.fill.warn { background: var(--amber); } .fill.full { background: var(--red); }
.sub { color: var(--muted); font-size: 13px; }
.kv { display: grid; grid-template-columns: 1fr auto; gap: 8px 16px; font-size: 14px; }
.kv dt { color: var(--muted); } .kv dd { margin: 0; text-align: right; }
.alert { margin-top: 12px; padding: 10px 12px; border-radius: 10px; background: #2a2222; border: 1px solid #4a2f2f; font-size: 13px; }
.probe { margin-top: 12px; padding: 10px 12px; border-radius: 10px; background: #1d2430; border: 1px solid #2c3a52; font-size: 13px; }
form { background: var(--card); border: 1px solid var(--line); border-radius: 18px; padding: 22px; display: grid; gap: 10px; }
input { background: #141414; color: var(--text); border: 1px solid #3a3a3a; border-radius: 10px; padding: 10px 12px; font: inherit; }
.error { color: var(--red); font-size: 13px; margin: 0; }
code { font-size: 12px; background: #262626; padding: 1px 5px; border-radius: 5px; }
.foot { margin-top: 18px; }
@media (max-width: 520px) { header { flex-direction: column; } .card { padding: 16px; } }
`;

export const USAGE_JS = `(() => {
  "use strict";
  const KEY = "jo-usage-token";
  const $ = (id) => document.getElementById(id);
  const store = {
    get() { try { return sessionStorage.getItem(KEY) || ""; } catch { return ""; } },
    set(v) { try { sessionStorage.setItem(KEY, v); } catch {} },
    clear() { try { sessionStorage.removeItem(KEY); } catch {} },
  };
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const fmt = (n) => Number(n || 0).toLocaleString("en-US");
  const dur = (ms) => {
    if (ms == null || ms < 0) return "";
    const m = Math.round(ms / 60000), h = Math.floor(m / 60);
    return h ? h + " hr " + (m % 60) + " min" : m + " min";
  };
  const ago = (t) => { const s = Math.round((Date.now() - t) / 1000); return s < 60 ? s + "s ago" : s < 3600 ? Math.round(s / 60) + " min ago" : Math.round(s / 3600) + " hr ago"; };
  const NAMES = {
    "groq:openai/gpt-oss-120b": ["Groq gpt-oss-120b", "Answers, first choice"],
    "groq:openai/gpt-oss-20b": ["Groq gpt-oss-20b", "Routing and buttons"],
    "gemini:gemini-3.6-flash": ["Gemini 3.6 Flash", "Answers, backup"],
    "gemini:gemini-3.5-flash-lite": ["Gemini 3.5 Flash-Lite", "Routing and buttons, backup"],
  };

  function meter(label, used, limit, sub) {
    const box = el("div", "meter");
    const row = el("div", "row");
    row.append(el("span", "label", label));
    const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : null;
    row.append(el("span", "value", limit ? pct + "% used · " + fmt(used) + " / " + fmt(limit) : fmt(used)));
    box.append(row);
    if (limit) {
      const bar = el("div", "bar"), fill = el("div", "fill" + (pct >= 90 ? " full" : pct >= 60 ? " warn" : ""));
      fill.style.width = pct + "%";
      bar.append(fill);
      box.append(bar);
    }
    if (sub) box.append(el("div", "sub", sub));
    return box;
  }

  function card(title, tag) {
    const c = el("section", "card");
    const head = el("div", "card-head");
    head.append(el("h2", null, title));
    if (tag) head.append(el("span", "tag", tag));
    c.append(head);
    return c;
  }

  function render(d) {
    const root = $("content");
    root.replaceChildren();
    const resets = d.resets;

    // Jo
    const jo = card("Jo", "navajyoth.com");
    const badges = el("div", "badges");
    badges.append(el("span", "badge " + (d.jo.enabled ? "on" : "off"), d.jo.enabled ? "● On" : "● Off" + (d.jo.forceOff ? " (forced)" : "")));
    if (d.jo.testMode) badges.append(el("span", "badge test", "Test mode"));
    badges.append(el("span", "badge", "Reasoning: " + d.jo.answerReasoning));
    jo.append(badges);
    jo.append(el("div", "sub", "Answer chain: " + d.jo.models.map((m) => (NAMES[m] || [m])[0]).join(" → ")));
    root.append(jo);

    // Jo's own limits
    const lim = card("Jo's limits", d.jo.testMode ? "test mode" : "production");
    lim.append(meter("Questions today (all visitors)", d.stats.jo.budgetUsed, d.jo.limits.globalDailyModelCalls,
      "Resets in " + dur(resets.utcMidnightInMs) + " (midnight UTC). Cached answers don't count."));
    lim.append(meter("Busiest visitor today", d.stats.jo.busiestVisitor, d.jo.limits.daily,
      fmt(d.stats.jo.visitorsToday) + " visitor" + (d.stats.jo.visitorsToday === 1 ? "" : "s") + " today. Each gets " +
      fmt(d.jo.limits.burst) + " questions in a burst, then 1 every " + d.jo.limits.refillSeconds + "s."));
    root.append(lim);

    // Providers: answer chain first, then the rest
    const order = [...d.jo.models, ...d.jo.utilityModels.filter((m) => !d.jo.models.includes(m))];
    const byName = Object.fromEntries(d.stats.providers.map((p) => [p.provider, p]));
    const probes = Object.fromEntries((d.probe || []).map((p) => [p.model, p]));
    for (const name of order) {
      const p = byName[name] || { last24h: {}, today: {}, limits: null };
      const [title, role] = NAMES[name] || [name, ""];
      const c = card(title, role);
      const L = p.limits || {};
      if (L.window === "rolling-24h") {
        // Prefer the provider's own count when it reported one recently (a probe, or a refusal).
        let used = p.last24h.tokens;
        let source = "Counted by Jo only; laptop tests aren't included.";
        const pr0 = probes[name];
        const ex = p.lastLimit && /tokens per day: used ([\\d,]+) of/.exec(p.lastLimit.detail || "");
        if (pr0 && pr0.dailyUsed != null) {
          used = pr0.dailyUsed;
          source = "Groq's own count, just now.";
        } else if (ex && Date.now() - p.lastLimit.at < 2 * 3600000) {
          used = Math.max(used, Number(ex[1].replace(/,/g, "")));
          source = "Groq's own count, reported " + ago(p.lastLimit.at) + ".";
        }
        c.append(meter("Tokens, last 24 hours", used, L.tokensPerDay,
          source + " Rolling window: tokens free up 24 hours after they're used."));
        c.append(meter("Requests, last 24 hours", p.last24h.requests, L.requestsPerDay,
          fmt(p.last24h.limited) + " refused with \\"limit reached\\" in the last 24 hours."));
      } else {
        // If the provider refused for its daily limit since today's reset, the day is used up,
        // whatever Jo itself counted (laptop tests share the same key).
        const dayStart = d.now - (24 * 3600000 - resets.utcMidnightInMs);
        const fullToday = p.lastLimit && p.lastLimit.at >= dayStart && /per day/.test(p.lastLimit.detail || "");
        const used = fullToday && L.requestsPerDay ? L.requestsPerDay : p.today.requests;
        c.append(meter("Requests today", used, L.requestsPerDay,
          (fullToday ? "Google says today's limit is used up. " : "Counted by Jo only. ") +
          "Resets in " + dur(resets.utcMidnightInMs) + " (midnight UTC)." +
          (L.requestsPerMinute ? " Also " + L.requestsPerMinute + " per minute." : "")));
        if (p.today.tokens) c.append(el("div", "sub", fmt(p.today.tokens) + " tokens today."));
      }
      if (p.lastLimit) {
        c.append(el("div", "alert", "Limit hit " + ago(p.lastLimit.at) + (p.lastLimit.detail ? ": " + p.lastLimit.detail : "") + "."));
      }
      const pr = probes[name];
      if (pr) {
        const lines = [];
        if (pr.dailyUsed != null) lines.push("Groq says: " + fmt(pr.dailyUsed) + " of " + fmt(pr.dailyLimit) + " daily tokens used" + (pr.dailyRetryIn ? "; next question fits in about " + pr.dailyRetryIn : "") + ".");
        else if (pr.dailyAtLeastLeft) lines.push("Groq says: at least " + fmt(pr.dailyAtLeastLeft) + " daily tokens left (about " + Math.floor(pr.dailyAtLeastLeft / 2700) + "+ questions).");
        if (pr.requestsLeft != null) lines.push("Requests left today: " + fmt(pr.requestsLeft) + " of " + fmt(pr.requestsLimit) + ".");
        if (pr.minuteTokensLeft != null) lines.push("This minute: " + fmt(pr.minuteTokensLeft) + " of " + fmt(pr.minuteTokensLimit) + " tokens.");
        if (!lines.length && pr.detail) lines.push("Groq says: " + pr.detail);
        if (!lines.length) lines.push("Groq answered HTTP " + pr.status + ".");
        const box = el("div", "probe");
        lines.forEach((l) => box.append(el("div", null, l)));
        c.append(box);
      }
      if (name.startsWith("groq:")) {
        const b = el("button", null, "Check Groq now");
        b.type = "button";
        b.style.marginTop = "12px";
        b.addEventListener("click", () => load(true, b));
        c.append(b);
      }
      root.append(c);
    }

    $("updated").textContent = "Updated " + new Date(d.now).toLocaleTimeString() + " · refreshes every 30s";
  }

  async function load(probe, btn) {
    const token = store.get();
    if (!token) return showLogin();
    if (btn) { btn.disabled = true; btn.textContent = "Checking…"; }
    try {
      const res = await fetch("/usage/data" + (probe ? "?probe=1" : ""), { headers: { Authorization: "Bearer " + token }, cache: "no-store" });
      if (res.status === 401) { store.clear(); return showLogin("That token didn't work."); }
      if (!res.ok) throw new Error("HTTP " + res.status);
      $("login").hidden = true;
      $("content").hidden = false;
      render(await res.json());
    } catch (e) {
      $("updated").textContent = "Couldn't load: " + e.message;
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = "Check Groq now"; }
    }
  }

  function showLogin(msg) {
    $("content").hidden = true;
    $("login").hidden = false;
    $("updated").textContent = "Sign in to see live numbers.";
    const err = $("login-error");
    err.hidden = !msg;
    err.textContent = msg || "";
  }

  $("login").addEventListener("submit", (e) => { e.preventDefault(); store.set($("token").value.trim()); $("token").value = ""; load(false); });
  $("refresh").addEventListener("click", () => load(false));
  $("signout").addEventListener("click", () => { store.clear(); showLogin(); });
  setInterval(() => { if (!document.hidden && store.get()) load(false); }, 30000);
  load(false);
})();`;

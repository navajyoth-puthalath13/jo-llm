// The private usage page: /usage (HTML), /usage/app.css, /usage/app.js.
// Static files with no data in them. The script asks for the admin token, keeps it in
// sessionStorage for this tab only, and reads /usage/data with it. Everything is rendered with
// textContent, never innerHTML.
//
// Layout follows the Claude usage panel: one card per provider (Jo, Groq, Gemini), and inside it
// compact rows of label · "N% used" · bar · one grey line.

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
    <h1>Jo usage</h1>
    <div class="actions">
      <button id="refresh" type="button">Refresh</button>
      <button id="signout" type="button" class="ghost">Sign out</button>
    </div>
  </header>
  <div class="status" id="status"><span class="muted" id="updated">Loading…</span></div>

  <form id="login" hidden>
    <label for="token">Admin token</label>
    <input id="token" type="password" autocomplete="current-password" required>
    <button type="submit">Open</button>
    <p class="muted">Kept for this tab only.</p>
    <p class="error" id="login-error" hidden></p>
  </form>

  <div id="content" hidden></div>

  <p class="muted foot">Counted by Jo's Worker. Tests from a laptop use the same keys but aren't counted; when a provider reports its own numbers, those are shown instead.</p>
</main>
<script src="/usage/app.js"></script>
</body>
</html>`;

export const USAGE_CSS = `
:root {
  --bg: #141414; --card: #1e1e1e; --line: #2c2c2c; --text: #ededed; --muted: #8c8c8c;
  --track: #333; --blue: #4f86e0; --amber: #e0a43a; --red: #e05a52; --green: #4caf6e;
  color-scheme: dark;
}
* { box-sizing: border-box; }
[hidden] { display: none !important; }
body { margin: 0; background: var(--bg); color: var(--text);
  font: 15px/1.4 -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif; }
main { max-width: 600px; margin: 0 auto; padding: 32px 16px 48px; }
header { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
h1 { font-size: 22px; margin: 0; font-weight: 600; }
.muted { color: var(--muted); font-size: 13px; margin: 0; }
.status { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 10px 0 18px; }
.pill { font-size: 12px; border-radius: 999px; padding: 2px 10px; border: 1px solid var(--line); color: var(--muted); }
.pill.on { color: var(--green); border-color: #2f5a3d; }
.pill.off { color: var(--red); border-color: #5a2f2f; }
.pill.test { color: var(--amber); border-color: #5a4a2a; }
.actions { display: flex; gap: 8px; }
button { background: #2a2a2a; color: var(--text); border: 1px solid #383838; border-radius: 10px;
  padding: 6px 12px; font: inherit; font-size: 13px; cursor: pointer; }
button:hover { background: #333; }
button.ghost { background: transparent; }
button:disabled { opacity: .5; cursor: default; }
.card { background: var(--card); border: 1px solid var(--line); border-radius: 16px; padding: 18px 20px; margin-bottom: 12px; }
.card-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 14px; }
.card-head h2 { font-size: 16px; margin: 0; font-weight: 600; }
.model { font-size: 13px; color: var(--muted); margin: 16px 0 10px; padding-top: 14px; border-top: 1px solid var(--line); }
.card-head + .model { margin-top: 0; padding-top: 0; border-top: 0; }
.model b { color: var(--text); font-weight: 600; }
.meter { margin-bottom: 14px; }
.row { display: flex; justify-content: space-between; gap: 12px; }
.label { font-weight: 600; font-size: 15px; }
.value { color: var(--muted); font-size: 14px; white-space: nowrap; }
.bar { height: 9px; background: var(--track); border-radius: 999px; margin: 7px 0 5px; overflow: hidden; }
.fill { height: 100%; background: var(--blue); border-radius: 999px; }
.fill.warn { background: var(--amber); } .fill.full { background: var(--red); }
.sub { color: var(--muted); font-size: 13px; }
.note { margin: -4px 0 14px; padding: 8px 10px; border-radius: 10px; font-size: 13px; }
.note.limit { background: #2a2121; border: 1px solid #4a2f2f; }
.note.live { background: #1c2330; border: 1px solid #2c3a52; }
form { background: var(--card); border: 1px solid var(--line); border-radius: 16px; padding: 20px; display: grid; gap: 10px; }
input { background: #121212; color: var(--text); border: 1px solid #383838; border-radius: 10px; padding: 10px 12px; font: inherit; }
.error { color: var(--red); font-size: 13px; margin: 0; }
.foot { margin-top: 16px; }
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
  const MODELS = {
    "groq:openai/gpt-oss-120b": ["gpt-oss-120b", "answers"],
    "groq:openai/gpt-oss-20b": ["gpt-oss-20b", "routing and buttons"],
    "gemini:gemini-3.6-flash": ["3.6 Flash", "backup answers"],
    "gemini:gemini-3.5-flash-lite": ["3.5 Flash-Lite", "backup routing"],
  };
  let probes = {};

  // One row: label, "N% used", bar, grey line. Without a limit: label and the number only.
  function meter(label, used, limit, sub) {
    const box = el("div", "meter");
    const row = el("div", "row");
    row.append(el("span", "label", label));
    if (limit) {
      const pct = Math.min(100, Math.round((used / limit) * 100));
      row.append(el("span", "value", pct + "% used"));
      box.append(row);
      const bar = el("div", "bar"), fill = el("div", "fill" + (pct >= 90 ? " full" : pct >= 60 ? " warn" : ""));
      fill.style.width = pct + "%";
      bar.append(fill);
      box.append(bar);
    } else {
      row.append(el("span", "value", fmt(used)));
      box.append(row);
    }
    if (sub) box.append(el("div", "sub", sub));
    return box;
  }

  function card(title, action) {
    const c = el("section", "card");
    const head = el("div", "card-head");
    head.append(el("h2", null, title));
    if (action) head.append(action);
    c.append(head);
    return c;
  }

  function modelHeading(name) {
    const [short, role] = MODELS[name] || [name, ""];
    const h = el("div", "model");
    h.append(el("b", null, short));
    if (role) h.append(document.createTextNode(" · " + role));
    return h;
  }

  function groqModel(c, name, p) {
    const L = p.limits || {};
    c.append(modelHeading(name));
    let used = p.last24h.tokens;
    let how = "counted by Jo";
    const probe = probes[name];
    const ex = p.lastLimit && /tokens per day: used ([\\d,]+) of/.exec(p.lastLimit.detail || "");
    if (probe && probe.dailyUsed != null) { used = probe.dailyUsed; how = "Groq's count, just now"; }
    else if (ex && Date.now() - p.lastLimit.at < 2 * 3600000) { used = Math.max(used, Number(ex[1].replace(/,/g, ""))); how = "Groq's count, " + ago(p.lastLimit.at); }
    c.append(meter("Daily tokens", used, L.tokensPerDay, fmt(used) + " of " + fmt(L.tokensPerDay) + " · " + how + " · rolling 24 hr"));
    c.append(meter("Daily requests", p.last24h.requests, L.requestsPerDay,
      fmt(p.last24h.requests) + " of " + fmt(L.requestsPerDay) + (p.last24h.limited ? " · " + fmt(p.last24h.limited) + " refused" : "")));
    if (probe) {
      const bits = [];
      if (probe.dailyUsed != null) bits.push(fmt(probe.dailyLimit - probe.dailyUsed) + " tokens left today" + (probe.dailyRetryIn ? ", next answer fits in " + probe.dailyRetryIn : ""));
      else if (probe.dailyAtLeastLeft) bits.push("at least " + fmt(probe.dailyAtLeastLeft) + " tokens left today");
      if (probe.requestsLeft != null) bits.push(fmt(probe.requestsLeft) + " of " + fmt(probe.requestsLimit) + " requests left");
      if (probe.minuteTokensLeft != null) bits.push(fmt(probe.minuteTokensLeft) + " of " + fmt(probe.minuteTokensLimit) + " tokens this minute");
      if (!bits.length) bits.push(probe.detail || "Groq answered HTTP " + probe.status);
      c.append(el("div", "note live", "Groq now: " + bits.join(" · ")));
    } else if (p.lastLimit) {
      c.append(el("div", "note limit", "Limit hit " + ago(p.lastLimit.at) + (p.lastLimit.detail ? ": " + p.lastLimit.detail : "")));
    }
  }

  function geminiModel(c, name, p, d) {
    const L = p.limits || {};
    c.append(modelHeading(name));
    const dayStart = d.now - (24 * 3600000 - d.resets.utcMidnightInMs);
    const fullToday = p.lastLimit && p.lastLimit.at >= dayStart && /per day/.test(p.lastLimit.detail || "");
    const used = fullToday && L.requestsPerDay ? L.requestsPerDay : p.today.requests;
    const resets = "resets in " + dur(d.resets.utcMidnightInMs);
    if (L.requestsPerDay) {
      c.append(meter("Daily requests", used, L.requestsPerDay,
        fmt(used) + " of " + fmt(L.requestsPerDay) + " · " + (fullToday ? "Google says used up · " : "") + resets));
    } else {
      c.append(meter("Requests today", used, 0, (L.requestsPerMinute ? L.requestsPerMinute + " per minute · " : "") + resets));
    }
    if (p.lastLimit && !fullToday) c.append(el("div", "note limit", "Limit hit " + ago(p.lastLimit.at) + (p.lastLimit.detail ? ": " + p.lastLimit.detail : "")));
  }

  function render(d) {
    const root = $("content");
    root.replaceChildren();

    const status = $("status");
    status.replaceChildren();
    status.append(el("span", "pill " + (d.jo.enabled ? "on" : "off"), d.jo.enabled ? "● On" : "● Off" + (d.jo.forceOff ? " (forced)" : "")));
    if (d.jo.testMode) status.append(el("span", "pill test", "Test mode"));
    const updated = el("span", "muted", "Updated " + new Date(d.now).toLocaleTimeString() + " · every 30s");
    updated.id = "updated";
    status.append(updated);

    // Jo
    const jo = card("Jo");
    jo.append(meter("Questions today", d.stats.jo.budgetUsed, d.jo.limits.globalDailyModelCalls,
      fmt(d.stats.jo.budgetUsed) + " of " + fmt(d.jo.limits.globalDailyModelCalls) + " · resets in " + dur(d.resets.utcMidnightInMs) + " · cached answers are free"));
    jo.append(meter("Busiest visitor", d.stats.jo.busiestVisitor, d.jo.limits.daily,
      fmt(d.stats.jo.busiestVisitor) + " of " + fmt(d.jo.limits.daily) + " · " + fmt(d.stats.jo.visitorsToday) + " visitor" + (d.stats.jo.visitorsToday === 1 ? "" : "s") + " today"));
    jo.append(el("div", "sub", "Answers: " + d.jo.models.map((m) => (MODELS[m] || [m])[0]).join(" → ") + " · reasoning " + d.jo.answerReasoning));
    root.append(jo);

    const all = [...d.jo.models, ...d.jo.utilityModels.filter((m) => !d.jo.models.includes(m))];
    const byName = Object.fromEntries(d.stats.providers.map((p) => [p.provider, p]));
    const get = (n) => byName[n] || { last24h: { tokens: 0, requests: 0, limited: 0 }, today: { requests: 0, tokens: 0 }, limits: {} };

    // Groq: every Groq model in one card
    const groq = all.filter((n) => n.startsWith("groq:"));
    if (groq.length) {
      const btn = el("button", null, "Check now");
      btn.type = "button";
      btn.addEventListener("click", () => load(true, btn));
      const c = card("Groq", btn);
      groq.forEach((n) => groqModel(c, n, get(n)));
      root.append(c);
    }

    // Gemini: every Gemini model in one card
    const gemini = all.filter((n) => n.startsWith("gemini:"));
    if (gemini.length) {
      const c = card("Gemini");
      gemini.forEach((n) => geminiModel(c, n, get(n), d));
      root.append(c);
    }
  }

  async function load(probe, btn) {
    const token = store.get();
    if (!token) return showLogin();
    if (btn) { btn.disabled = true; btn.textContent = "Checking…"; }
    try {
      const res = await fetch("/usage/data" + (probe ? "?probe=1" : ""), { headers: { Authorization: "Bearer " + token }, cache: "no-store" });
      if (res.status === 401) { store.clear(); return showLogin("That token didn't work."); }
      if (!res.ok) throw new Error("HTTP " + res.status);
      const d = await res.json();
      if (d.probe) probes = Object.fromEntries(d.probe.map((p) => [p.model, p]));
      $("login").hidden = true;
      $("content").hidden = false;
      render(d);
    } catch (e) {
      const u = $("updated");
      if (u) u.textContent = "Couldn't load: " + e.message;
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = "Check now"; }
    }
  }

  function showLogin(msg) {
    $("content").hidden = true;
    $("login").hidden = false;
    const err = $("login-error");
    err.hidden = !msg;
    err.textContent = msg || "";
  }

  $("login").addEventListener("submit", (e) => { e.preventDefault(); store.set($("token").value.trim()); $("token").value = ""; load(false); });
  $("refresh").addEventListener("click", () => load(false));
  $("signout").addEventListener("click", () => { store.clear(); probes = {}; showLogin(); });
  setInterval(() => { if (!document.hidden && store.get()) load(false); }, 30000);
  load(false);
})();`;

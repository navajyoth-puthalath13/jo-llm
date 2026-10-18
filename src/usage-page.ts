// The private usage page: /usage (HTML), /usage/app.css, /usage/app.js.
// Static files with no data in them. The script asks for the admin token, keeps it in
// sessionStorage for this tab only, and reads /usage/data with it. Everything is rendered with
// textContent, never innerHTML.
//
// Layout follows the Claude usage panel: a one-line headline (is Jo answering, and with what), then
// a Visitors card, then one card per model, each with rows: name · reset time · coloured % · bar. Exact counts are in each row's tooltip.

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

  <p class="muted foot">Hover a bar for the exact count. Groq frees tokens gradually over 24 hours; Gemini and visitor limits reset at midnight UTC. Jo uses Gemini only when Groq is maxed out.</p>
</main>
<script src="/usage/app.js"></script>
</body>
</html>`;

export const USAGE_CSS = `
:root {
  --bg: #141414; --card: #1e1e1e; --line: #2c2c2c; --text: #ededed; --muted: #8c8c8c;
  --track: #333; --blue: #4f86e0; --amber: #e0a43a; --red: #e05a52; --green: #4caf6e;
  --jo: #4caf6e; --groq: #f07a45; --gemini: #9b87f5;
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
.card h2 { font-size: 16px; margin: 0 0 14px; font-weight: 600; }
.card h2 .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--tone); margin-right: 8px; vertical-align: middle; }
.card.jo { --tone: var(--jo); } .card.groq { --tone: var(--groq); } .card.gemini { --tone: var(--gemini); }
.card .meter:last-child { margin-bottom: 2px; }
.meter { margin-bottom: 14px; --tone: var(--blue); display: grid; grid-template-columns: 1fr auto auto;
  grid-template-areas: "label when pct" "bar bar bar"; align-items: baseline; column-gap: 10px; }
.meter > .label { grid-area: label; } .meter > .when { grid-area: when; } .meter > .pct { grid-area: pct; } .meter > .bar { grid-area: bar; }
.meter.jo { --tone: var(--jo); } .meter.groq { --tone: var(--groq); } .meter.gemini { --tone: var(--gemini); }
.meter.warn { --tone: var(--amber); } .meter.full { --tone: var(--red); }
.label { font-size: 15px; min-width: 0; }
.when { color: var(--muted); font-size: 14px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.when.back { color: #f2a39d; } .when.ok { color: #8fd3a4; }
.pct { color: var(--tone); font-size: 15px; font-weight: 600; font-variant-numeric: tabular-nums; min-width: 40px; text-align: right; }
.bar { height: 10px; border-radius: 999px; margin-top: 7px; overflow: hidden; background: color-mix(in srgb, var(--tone) 18%, #1a1a1a); }
.fill { height: 100%; background: var(--tone); border-radius: 999px; transition: width .4s ease; }
.headline { border-radius: 14px; padding: 12px 16px; margin-bottom: 12px; font-size: 15px; border: 1px solid; }
.headline.good { background: #1b2a20; border-color: #2f5a3d; color: #b6e6c4; }
.headline.warn { background: #2c2618; border-color: #5a4a2a; color: #f0d48a; }
.headline.bad { background: #2d1d1d; border-color: #5a2f2f; color: #f2b8b2; }
form { background: var(--card); border: 1px solid var(--line); border-radius: 16px; padding: 20px; display: grid; gap: 10px; }
input { background: #121212; color: var(--text); border: 1px solid #383838; border-radius: 10px; padding: 10px 12px; font: inherit; }
.error { color: var(--red); font-size: 13px; margin: 0; }
.foot { margin-top: 16px; }
.seg { display: inline-flex; border: 1px solid var(--line); border-radius: 999px; overflow: hidden; }
.seg button { border: 0; border-radius: 0; background: transparent; color: var(--muted); padding: 3px 12px; font-size: 12px; }
.seg button.active { background: #2f2f2f; color: var(--text); }
.seg button.active.test { color: var(--amber); }
@media (max-width: 520px) {
  main { padding: 20px 16px 40px; }
  header h1 { font-size: 20px; }
  .card { padding: 16px; border-radius: 14px; }
  .headline { font-size: 14px; padding: 11px 14px; }
  .meter { grid-template-columns: 1fr auto; grid-template-areas: "label pct" "bar bar" "when when"; }
  .meter > .when { font-size: 13px; margin-top: 6px; white-space: normal; }
  .status { gap: 8px; }
  .status #updated { flex-basis: 100%; }
}
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
    "gemini:gemini-3.6-flash": ["Gemini 3.6 Flash", "backup answers"],
    "gemini:gemini-3.5-flash-lite": ["Gemini 3.5 Flash-Lite", "backup routing"],
  };
  let probes = {};
  let probesAt = 0;

  // "7m46s", "14h18m53s", "51.84s" → milliseconds
  const parseWait = (s) => {
    const m = /^(?:(\\d+)h)?(?:(\\d+)m)?(?:([\\d.]+)s)?$/.exec(String(s || "").trim());
    if (!m || !(m[1] || m[2] || m[3])) return null;
    return ((+(m[1] || 0)) * 3600 + (+(m[2] || 0)) * 60 + (+(m[3] || 0))) * 1000;
  };
  const clock = (ms) => {
    const t = Math.max(0, Math.round(ms / 1000));
    const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
    const two = (n) => String(n).padStart(2, "0");
    return (h ? h + ":" + two(m) : String(m)) + ":" + two(sec);
  };

  // Live countdown text: "Resets in 12 hr 34 min" (kind "reset") or "Back in 2 hr 10 min" (kind "back").
  function countdown(at, kind) {
    const n = el("span", "when");
    n.dataset.at = String(at);
    n.dataset.kind = kind;
    paint(n);
    return n;
  }
  const hm = (ms) => {
    const m = Math.max(1, Math.ceil(ms / 60000)), h = Math.floor(m / 60);
    return h ? h + " hr " + (m % 60) + " min" : m + " min";
  };
  function paint(n) {
    const left = Number(n.dataset.at) - Date.now();
    if (n.dataset.kind === "back") {
      n.className = "when " + (left > 0 ? "back" : "ok");
      n.textContent = left > 0 ? "Maxed out · back in " + hm(left) : "Available again";
    } else {
      n.textContent = left > 0 ? "Resets in " + hm(left) : "Resetting now";
    }
  }
  setInterval(() => document.querySelectorAll("[data-at]").forEach(paint), 1000);

  const isDaily = (p) => /per day/.test((p.lastLimit && p.lastLimit.detail) || "");

  /** Groq: { pct, backAt }. backAt is set only while Groq is refusing for the day. */
  function groqState(name, p) {
    const L = p.limits || {};
    const probe = probes[name];
    const now = Date.now();
    let backAt = null;
    if (probe && probe.dailyRetryIn) {
      const w = parseWait(probe.dailyRetryIn);
      if (w != null) backAt = probesAt + w;
    } else if (p.lastLimit && isDaily(p) && !(probe && probe.status === 200 && probesAt > p.lastLimit.at)) {
      const m = /retry in ([\\dhms.]+)/.exec(p.lastLimit.detail || "");
      const w = m && parseWait(m[1]);
      if (w != null) backAt = p.lastLimit.at + w;
    }
    if (backAt != null && backAt <= now) backAt = null;
    if (backAt) return { pct: 100, backAt, title: "Groq is refusing new answers until then" };
    // Exact count when Groq gave one (it only does when nearly full); otherwise what Jo counted.
    let used = p.last24h.tokens;
    if (probe && probe.dailyUsed != null) used = probe.dailyUsed;
    else {
      const ex = p.lastLimit && /used ([\\d,]+) of/.exec(p.lastLimit.detail || "");
      if (ex && now - p.lastLimit.at < 2 * 3600000 && !(probe && probesAt > p.lastLimit.at)) used = Number(ex[1].replace(/,/g, ""));
    }
    return { pct: L.tokensPerDay ? (used / L.tokensPerDay) * 100 : 0, backAt: null, title: fmt(used) + " of " + fmt(L.tokensPerDay) + " tokens in the last 24 hr" };
  }

  /** Gemini: daily requests, reset at midnight UTC. */
  function geminiState(name, p, d) {
    const L = p.limits || {};
    const midnight = d.now + d.resets.utcMidnightInMs;
    const dayStart = midnight - 24 * 3600000;
    const check = (d.geminiProbe || []).find((g) => g.model === name);
    const maxed = check ? check.status === 429 : !!(p.lastLimit && p.lastLimit.at >= dayStart && isDaily(p));
    if (maxed) return { pct: 100, backAt: midnight, title: "Google is refusing new answers until midnight UTC" };
    const used = p.today.requests;
    return { pct: L.requestsPerDay ? (used / L.requestsPerDay) * 100 : 0, backAt: null, resetAt: midnight, title: fmt(used) + " of " + fmt(L.requestsPerDay) + " requests today" };
  }

  // One row, Claude-panel style: name on the left; reset time and coloured % on the right; a bar.
  function row(name, tag, pctExact, right, title, tone) {
    const pct = Math.min(100, Math.round(pctExact));
    const box = el("div", "meter " + tone + (pct >= 90 ? " full" : pct >= 60 ? " warn" : ""));
    if (title) box.title = title;
    // Flat children so CSS can lay them out per screen: one line on desktop, and on a phone
    // name + % on top, the bar, then the reset time underneath.
    const label = el("span", "label");
    if (tag) label.append(el("span", "tag", tag + " "));
    label.append(document.createTextNode(name));
    const pctEl = el("span", "pct", pctExact > 0 && pctExact < 1 ? "<1%" : pct + "%");
    const bar = el("div", "bar"), fill = el("div", "fill");
    fill.style.width = (pctExact > 0 ? Math.max(1.5, Math.min(100, pctExact)) : 0) + "%";
    bar.append(fill);
    box.append(label);
    if (right) box.append(right);
    box.append(pctEl, bar);
    return box;
  }

  function render(d) {
    const root = $("content");
    root.replaceChildren();

    const status = $("status");
    status.replaceChildren();
    status.append(el("span", "pill " + (d.jo.enabled ? "on" : "off"), d.jo.enabled ? "● On" : "● Off" + (d.jo.forceOff ? " (forced)" : "")));
    const seg = el("span", "seg");
    for (const m of ["normal", "test"]) {
      const b = el("button", (d.jo.mode === m ? "active" : "") + (m === "test" ? " test" : ""), m === "normal" ? "Normal" : "Test mode");
      b.type = "button";
      b.title = m === "normal" ? "Normal visitor limits" : "Lift Jo's own limits while you test";
      if (d.jo.mode !== m) b.addEventListener("click", () => setMode(m));
      seg.append(b);
    }
    status.append(seg);
    const updated = el("span", "muted", "Updated " + new Date(d.now).toLocaleTimeString());
    updated.id = "updated";
    status.append(updated);

    const byName = Object.fromEntries(d.stats.providers.map((p) => [p.provider, p]));
    const get = (n) => byName[n] || { last24h: { tokens: 0, requests: 0, limited: 0 }, today: { requests: 0, tokens: 0 }, limits: {} };
    const midnight = d.now + d.resets.utcMidnightInMs;
    const all = [...d.jo.models, ...d.jo.utilityModels.filter((m) => !d.jo.models.includes(m))];
    const state = {};
    for (const n of all) state[n] = n.startsWith("groq:") ? groqState(n, get(n)) : geminiState(n, get(n), d);
    const short = (n) => (MODELS[n] || [n])[0];

    // Headline: is Jo answering, and with what.
    const L = d.jo.limits;
    const live = d.jo.models.filter((n) => !state[n].backAt);
    const maxed = d.jo.models.filter((n) => state[n].backAt);
    let text, tone;
    const backIn = (n) => short(n) + " back in " + hm(state[n].backAt - Date.now());
    if (!d.jo.enabled) { text = "Jo is switched off."; tone = "bad"; }
    else if (d.stats.jo.budgetUsed >= L.globalDailyModelCalls) { text = "Today's visitor limit is reached. Jo is resting until it resets."; tone = "bad"; }
    else if (!live.length) {
      // Soonest first, so the first name is the one Jo will use next.
      const next = [...maxed].sort((a, b) => state[a].backAt - state[b].backAt);
      text = "Every answer model is maxed out, so visitors see “busy”. Next up: " + next.map(backIn).join(" · ") + "."; tone = "bad";
    } else if (maxed.length) {
      text = "Jo is answering with " + short(live[0]) + ". Maxed out: " + maxed.map(backIn).join(" · ") + "."; tone = "warn";
    } else { text = "All good. Jo is answering with " + short(live[0]) + "."; tone = "good"; }
    root.append(el("div", "headline " + tone, text));

    // Three cards: Visitors (Jo's own limits), Groq (both models), Gemini.
    const card = (title, cls) => {
      const c = el("section", "card " + cls);
      const h = el("h2");
      h.append(el("span", "dot"), document.createTextNode(title));
      c.append(h);
      root.append(c);
      return c;
    };
    const visitors = card("Visitors", "jo");
    visitors.append(row("All questions today", "", L.globalDailyModelCalls ? (d.stats.jo.budgetUsed / L.globalDailyModelCalls) * 100 : 0,
      countdown(midnight, "reset"), fmt(d.stats.jo.budgetUsed) + " of " + fmt(L.globalDailyModelCalls) + " questions", "jo"));
    visitors.append(row("Busiest visitor", "", L.daily ? (d.stats.jo.busiestVisitor / L.daily) * 100 : 0,
      countdown(midnight, "reset"), fmt(d.stats.jo.busiestVisitor) + " of " + fmt(L.daily) + " questions · " + fmt(d.stats.jo.visitorsToday) + " visitor(s) today", "jo"));

    // One card per model: Groq gpt-oss-120b, Groq gpt-oss-20b, Gemini 3.6 Flash.
    // Groq cards first, then Gemini. Gemini models without a daily limit (Flash-Lite is per minute
    // only) have nothing to fill.
    const groqFirst = [...all.filter((x) => x.startsWith("groq:")), ...all.filter((x) => !x.startsWith("groq:") && (get(x).limits || {}).requestsPerDay)];
    for (const n of groqFirst) {
      const provider = n.split(":")[0];
      const s = state[n];
      const right = s.backAt ? countdown(s.backAt, "back") : s.resetAt ? countdown(s.resetAt, "reset") : el("span", "when", "Rolling 24 hr");
      const c = card((provider === "groq" ? "Groq · " : "") + short(n), provider);
      c.append(row(provider === "groq" ? "Daily tokens" : "Daily requests", "", s.pct, right, s.title, provider));
    }
  }

  async function load(probe, btn) {
    const token = store.get();
    if (!token) return showLogin();
    if (btn) { btn.disabled = true; btn.textContent = "Checking…"; }
    try {
      const res = await fetch("/usage/data" + (probe ? "?probe=" + probe : ""), { headers: { Authorization: "Bearer " + token }, cache: "no-store" });
      if (res.status === 401) { store.clear(); return showLogin("That token didn't work."); }
      if (!res.ok) throw new Error("HTTP " + res.status);
      const d = await res.json();
      if (d.probe) { probes = Object.fromEntries(d.probe.map((p) => [p.model, p])); probesAt = Date.now(); }
      $("login").hidden = true;
      $("content").hidden = false;
      render(d);
    } catch (e) {
      const u = $("updated");
      if (u) u.textContent = "Couldn't load: " + e.message;
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = "Refresh"; }
      if (probe === "groq") checkedOnce = true;
    }
  }

  async function setMode(mode) {
    const u = $("updated");
    if (u) u.textContent = "Switching to " + (mode === "test" ? "test mode" : "normal") + "… takes up to a minute";
    try {
      const res = await fetch("/usage/mode", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + store.get() },
        body: JSON.stringify({ mode }),
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      setTimeout(() => load(false), 35000);
    } catch (e) {
      if (u) u.textContent = "Couldn't switch: " + e.message;
    }
  }

  function showLogin(msg) {
    $("content").hidden = true;
    $("login").hidden = false;
    const err = $("login-error");
    err.hidden = !msg;
    err.textContent = msg || "";
  }

  // Show the numbers straight away, then ask Groq directly in the background so its numbers are
  // true from the start (the check takes a few seconds).
  let checkedOnce = false;
  const first = async () => {
    await load(false);
    if (!checkedOnce && store.get()) await load("groq");
  };
  $("login").addEventListener("submit", (e) => { e.preventDefault(); store.set($("token").value.trim()); $("token").value = ""; first(); });
  $("refresh").addEventListener("click", (e) => load("groq", e.currentTarget));
  $("signout").addEventListener("click", () => { store.clear(); probes = {}; showLogin(); });
  setInterval(() => { if (!document.hidden && store.get()) load(false); }, 30000);
  first();
})();`;

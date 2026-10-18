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

  <p class="muted foot">Counted by Jo's Worker, plus laptop tests when <code>.dev.vars</code> forwards them. When a provider reports its own numbers, those are shown instead.</p>
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
.card-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 14px; }
.card-head h2 { font-size: 16px; margin: 0; font-weight: 600; }
.model { font-size: 13px; color: var(--muted); margin: 16px 0 10px; padding-top: 14px; border-top: 1px solid var(--line); }
.card-head + .model { margin-top: 0; padding-top: 0; border-top: 0; }
.model b { color: var(--text); font-weight: 600; }
.meter { margin-bottom: 16px; --tone: var(--accent, var(--blue)); }
.meter.warn { --tone: var(--amber); } .meter.full { --tone: var(--red); }
.row { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
.label { font-size: 15px; }
.right { display: inline-flex; align-items: baseline; gap: 10px; white-space: nowrap; }
.when { color: var(--muted); font-size: 13px; font-variant-numeric: tabular-nums; }
.when.back { color: #f2a39d; } .when.ok { color: #8fd3a4; }
.pct { color: var(--tone); font-size: 15px; font-weight: 600; font-variant-numeric: tabular-nums; min-width: 42px; text-align: right; }
.value { color: var(--muted); font-size: 14px; white-space: nowrap; }
.bar { height: 10px; border-radius: 999px; margin: 8px 0 6px; overflow: hidden;
  background: color-mix(in srgb, var(--tone) 18%, #1a1a1a); }
.fill { height: 100%; background: var(--tone); border-radius: 999px; transition: width .4s ease; }
.card.jo { --accent: var(--jo); border-left: 3px solid var(--jo); }
.card.groq { --accent: var(--groq); border-left: 3px solid var(--groq); }
.card.gemini { --accent: var(--gemini); border-left: 3px solid var(--gemini); }
.card-head h2 .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--accent, var(--muted)); margin-right: 8px; vertical-align: middle; }
.resets .name .dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; margin-right: 8px; vertical-align: middle; }

.sub { color: var(--muted); font-size: 13px; }
.note { margin: -4px 0 14px; padding: 8px 10px; border-radius: 10px; font-size: 13px; }
.note.limit { background: #2a2121; border: 1px solid #4a2f2f; }
.note.live { background: #1c2330; border: 1px solid #2c3a52; }
form { background: var(--card); border: 1px solid var(--line); border-radius: 16px; padding: 20px; display: grid; gap: 10px; }
input { background: #121212; color: var(--text); border: 1px solid #383838; border-radius: 10px; padding: 10px 12px; font: inherit; }
.error { color: var(--red); font-size: 13px; margin: 0; }
.foot { margin-top: 16px; }
.card > .sub { margin-top: 6px; }
.seg { display: inline-flex; border: 1px solid var(--line); border-radius: 999px; overflow: hidden; }
.seg button { border: 0; border-radius: 0; background: transparent; color: var(--muted); padding: 3px 12px; font-size: 12px; }
.seg button.active { background: #2f2f2f; color: var(--text); }
.seg button.active.test { color: var(--amber); }
.bar.unknown { background: repeating-linear-gradient(45deg, color-mix(in srgb, var(--tone) 10%, #1d1d1d) 0 6px, color-mix(in srgb, var(--tone) 20%, #1d1d1d) 6px 12px); }
.subrow { display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; }
.chip { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; border-radius: 999px; padding: 3px 10px;
  background: #262626; border: 1px solid #353535; color: var(--text); white-space: nowrap; font-variant-numeric: tabular-nums; }
.chip .k { color: var(--muted); }
.chip.red { background: #2d1d1d; border-color: #5a2f2f; color: #f2a39d; }
.chip.green { background: #1b2a20; border-color: #2f5a3d; color: #8fd3a4; }
.chip.amber { background: #2c2618; border-color: #5a4a2a; color: #f0c674; }
.resets { display: grid; gap: 8px; }
.resets .line { display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; }
.resets .name { font-size: 14px; }
.resets .name span { color: var(--muted); }
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

  // A live countdown chip. kind "reset": ↻ until a fixed reset. kind "back": red until the
  // provider lets us in again, then green "Available".
  function chip(at, kind, label) {
    const c = el("span", "chip");
    c.dataset.at = String(at);
    c.dataset.kind = kind;
    c.dataset.label = label || "";
    paint(c);
    return c;
  }
  function staticChip(text, cls) {
    return el("span", "chip" + (cls ? " " + cls : ""), text);
  }
  // Inline countdown for a bar's header, like "Resets in 2 hr 29 min" in the Claude panel.
  function countdown(at, kind, label) {
    const n = el("span", "when");
    n.dataset.at = String(at);
    n.dataset.kind = kind;
    n.dataset.label = label || "";
    n.dataset.inline = "1";
    paint(n);
    return n;
  }
  function paint(c) {
    if (c.dataset.inline) {
      const left = Number(c.dataset.at) - Date.now();
      if (c.dataset.kind === "back") {
        c.className = "when " + (left > 0 ? "back" : "ok");
        c.textContent = left > 0 ? (c.dataset.label || "Back in") + " " + clock(left) : "Available now";
      } else {
        c.className = "when";
        c.textContent = (c.dataset.label || "Resets in") + " " + (left > 0 ? clock(left) : "now");
      }
      return;
    }
    const left = Number(c.dataset.at) - Date.now();
    const label = c.dataset.label;
    c.replaceChildren();
    if (c.dataset.kind === "back") {
      if (left > 0) {
        c.className = "chip red";
        c.append(el("span", "k", (label || "Back in")), document.createTextNode(clock(left)));
      } else {
        c.className = "chip green";
        c.textContent = "Available";
      }
    } else {
      c.className = "chip" + (left < 3600000 ? " amber" : "");
      c.append(el("span", "k", label || "↻"), document.createTextNode(left > 0 ? clock(left) : "now"));
    }
  }
  setInterval(() => document.querySelectorAll("[data-at]").forEach(paint), 1000);

  /** When a Groq model lets Jo in again, if it said (probe or last refusal); else null. */
  function groqBackAt(name, p) {
    const probe = probes[name];
    if (probe && probe.dailyRetryIn) {
      const w = parseWait(probe.dailyRetryIn);
      if (w != null) return probesAt + w;
    }
    const m = p.lastLimit && /retry in ([\\dhms.]+)/.exec(p.lastLimit.detail || "");
    const w = m && parseWait(m[1]);
    return w != null ? p.lastLimit.at + w : null;
  }

  // One meter, Claude-panel style: label on the left; reset countdown and coloured % on the right;
  // a thick bar in the provider's colour (amber from 60%, red from 90%); one grey detail line.
  function meter(label, used, limit, sub, right) {
    const pctExact = limit ? (used / limit) * 100 : 0;
    const pct = Math.min(100, Math.round(pctExact));
    const box = el("div", "meter" + (pct >= 90 ? " full" : pct >= 60 ? " warn" : ""));
    const row = el("div", "row");
    row.append(el("span", "label", label));
    const r = el("span", "right");
    if (right) r.append(typeof right === "string" ? el("span", "when", right) : right);
    if (limit) r.append(el("span", "pct", used > 0 && pctExact < 1 ? "<1%" : pct + "%"));
    else r.append(el("span", "value", fmt(used)));
    row.append(r);
    box.append(row);
    if (limit) {
      const bar = el("div", "bar"), fill = el("div", "fill");
      // Anything used stays visible: at least a sliver, never an empty-looking bar.
      fill.style.width = (used > 0 ? Math.max(1.5, pctExact) : 0) + "%";
      bar.append(fill);
      box.append(bar);
    }
    if (sub) box.append(el("div", "sub", sub));
    return box;
  }

  function card(title, action, cls) {
    const c = el("section", "card" + (cls ? " " + cls : ""));
    const head = el("div", "card-head");
    const h = el("h2");
    if (cls) h.append(el("span", "dot"));
    h.append(document.createTextNode(title));
    head.append(h);
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
    const probe = probes[name];
    const ex = p.lastLimit && /tokens per day: used ([\\d,]+) of/.exec(p.lastLimit.detail || "");
    const backAt = groqBackAt(name, p);
    const tokenRight = () => (backAt ? countdown(backAt, "back", "Back in") : "Rolling 24 hr");
    // Groq only says its exact daily count when it's nearly out (its refusal carries it). Show the
    // exact number when we have it; otherwise say so, instead of a precise-looking guess.
    if (probe && probe.dailyUsed != null) {
      c.append(meter("Daily tokens", probe.dailyUsed, L.tokensPerDay, fmt(probe.dailyUsed) + " of " + fmt(L.tokensPerDay) + " · Groq's count, just now", tokenRight()));
    } else if (ex && Date.now() - p.lastLimit.at < 2 * 3600000 && !(probe && probe.dailyAtLeastLeft && probesAt > p.lastLimit.at)) {
      // An old refusal's count, unless a newer check says there's room again.
      const used = Number(ex[1].replace(/,/g, ""));
      c.append(meter("Daily tokens", used, L.tokensPerDay, fmt(used) + " of " + fmt(L.tokensPerDay) + " · Groq's count, " + ago(p.lastLimit.at), tokenRight()));
    } else {
      // Groq didn't give its exact count: show what Jo saw as a minimum, on a hatched bar.
      const seen = p.last24h.tokens;
      const box = meter("Daily tokens", seen, L.tokensPerDay,
        (probe && probe.dailyAtLeastLeft ? "Groq says at least " + fmt(probe.dailyAtLeastLeft) + " left · " : "") +
        "Groq shows its exact count only when nearly full · Jo saw " + fmt(seen) + " in 24 hr", tokenRight());
      box.querySelector(".bar").classList.add("unknown");
      const pctEl = box.querySelector(".pct");
      if (pctEl) pctEl.textContent = "≥" + pctEl.textContent.replace("<", "");
      c.append(box);
    }
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
    const resetAt = d.now + d.resets.utcMidnightInMs;
    const resetRight = fullToday ? countdown(resetAt, "back", "Back in") : countdown(resetAt, "reset");
    if (L.requestsPerDay) {
      c.append(meter("Daily requests", used, L.requestsPerDay,
        fmt(used) + " of " + fmt(L.requestsPerDay) + (fullToday ? " · Google says used up" : ""), resetRight));
    } else {
      c.append(meter("Requests today", used, 0, L.requestsPerMinute ? L.requestsPerMinute + " per minute" : "", resetRight));
    }
    if (p.lastLimit && !fullToday) c.append(el("div", "note limit", "Limit hit " + ago(p.lastLimit.at) + (p.lastLimit.detail ? ": " + p.lastLimit.detail : "")));
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
    const updated = el("span", "muted", "Updated " + new Date(d.now).toLocaleTimeString() + " · every 30s");
    updated.id = "updated";
    status.append(updated);

    const all = [...d.jo.models, ...d.jo.utilityModels.filter((m) => !d.jo.models.includes(m))];
    const byName = Object.fromEntries(d.stats.providers.map((p) => [p.provider, p]));
    const get = (n) => byName[n] || { last24h: { tokens: 0, requests: 0, limited: 0 }, today: { requests: 0, tokens: 0 }, limits: {} };
    const midnight = d.now + d.resets.utcMidnightInMs;

    // Next resets: every countdown in one place.
    const strip = card("Next resets");
    const list = el("div", "resets");
    const line = (dotColor, name, role, ch) => {
      const l = el("div", "line");
      const n = el("span", "name");
      const dot = el("span", "dot");
      dot.style.background = "var(" + dotColor + ")";
      n.append(dot, document.createTextNode(name + " "), el("span", null, role));
      l.append(n, ch);
      list.append(l);
    };
    line("--jo", "Jo", "questions from all visitors", chip(midnight, "reset", "↻ resets in"));
    for (const n of all.filter((x) => x.startsWith("groq:"))) {
      const at = groqBackAt(n, get(n));
      line("--groq", "Groq " + (MODELS[n] || [n])[0], (MODELS[n] || ["", ""])[1],
        at ? chip(at, "back", "Back in") : staticChip("Rolling 24 hr · no fixed reset"));
    }
    for (const n of all.filter((x) => x.startsWith("gemini:"))) {
      const p = get(n);
      const dayStart = d.now - (24 * 3600000 - d.resets.utcMidnightInMs);
      const usedUp = p.lastLimit && p.lastLimit.at >= dayStart && /per day/.test(p.lastLimit.detail || "");
      line("--gemini", "Gemini " + (MODELS[n] || [n])[0], (MODELS[n] || ["", ""])[1],
        usedUp ? chip(midnight, "back", "Used up · back in") : chip(midnight, "reset", "↻ resets in"));
    }
    strip.append(list);
    root.append(strip);

    // Jo: the limits your site puts on visitors (separate from the providers' own limits).
    const L = d.jo.limits;
    const jo = card("Jo · visitor limits", null, "jo");
    jo.append(meter("All visitors today", d.stats.jo.budgetUsed, L.globalDailyModelCalls,
      fmt(d.stats.jo.budgetUsed) + " of " + fmt(L.globalDailyModelCalls) + " questions · cached answers are free",
      countdown(midnight, "reset")));
    jo.append(meter("Per visitor", d.stats.jo.busiestVisitor, L.daily,
      "Busiest visitor: " + fmt(d.stats.jo.busiestVisitor) + " of " + fmt(L.daily) + " · " + fmt(d.stats.jo.visitorsToday) + " visitor" + (d.stats.jo.visitorsToday === 1 ? "" : "s") + " today",
      countdown(midnight, "reset")));
    jo.append(el("div", "sub", "Each visitor: " + fmt(L.burst) + " questions at once, then 1 more every " + L.refillSeconds + "s, up to " + fmt(L.daily) + " a day."));
    jo.append(el("div", "sub", "Answers: " + d.jo.models.map((m) => (MODELS[m] || [m])[0]).join(" → ") + " · reasoning " + d.jo.answerReasoning));
    root.append(jo);

    // Groq: every Groq model in one card
    const groq = all.filter((n) => n.startsWith("groq:"));
    if (groq.length) {
      const btn = el("button", null, "Check now");
      btn.type = "button";
      btn.addEventListener("click", () => load("groq", btn));
      const c = card("Groq", btn, "groq");
      groq.forEach((n) => groqModel(c, n, get(n)));
      root.append(c);
    }

    // Gemini: every Gemini model in one card
    const gemini = all.filter((n) => n.startsWith("gemini:"));
    if (gemini.length) {
      const btn = el("button", null, "Check now");
      btn.type = "button";
      btn.title = "Asks Google directly. Free when the day is used up; otherwise uses 1 of the 20 daily requests.";
      btn.addEventListener("click", () => load("gemini", btn));
      const c = card("Gemini", btn, "gemini");
      gemini.forEach((n) => geminiModel(c, n, get(n), d));
      if (d.geminiProbe) {
        const lines = d.geminiProbe.map((g) => (MODELS[g.model] || [g.model])[0] + ": " +
          (g.status === 429 ? "Google says the limit is reached" + (g.detail ? " (" + g.detail + ")" : "") :
           g.status === 200 ? "still available (this check used 1 request)" : "couldn't check (HTTP " + g.status + ")"));
        c.append(el("div", "note live", "Google now: " + lines.join(" · ")));
      }
      root.append(c);
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
      if (btn) { btn.disabled = false; btn.textContent = "Check now"; }
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
  $("refresh").addEventListener("click", () => load(false));
  $("signout").addEventListener("click", () => { store.clear(); probes = {}; showLogin(); });
  setInterval(() => { if (!document.hidden && store.get()) load(false); }, 30000);
  first();
})();`;

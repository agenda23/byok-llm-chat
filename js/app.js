"use strict";
const $ = id => document.getElementById(id);

// ---- storage ----
const parse = (s, d) => { try { return JSON.parse(s) ?? d; } catch { return d; } };
const LS = {
  get: (k, d) => parse(localStorage.getItem(k), d),
  set: (k, v) => localStorage.setItem(k, JSON.stringify(v)),
};
const DEFAULT_SETTINGS = {
  sendKey: "ctrlEnter", theme: "auto", fontSize: 14, markdown: true, lenientMd: true, showReasoning: true,
  stream: true, temperature: 0.7, maxTokens: 1024, chatStorage: "local",
};
const DEFAULT_PRESETS = {
  "標準アシスタント": "あなたは親切で簡潔に答えるアシスタントです。日本語で回答してください。",
  "ツンデレ": "あなたはツンデレな少女です。素直になれず強がるが、根は優しい。口調は「べ、別に〜」などを交えてください。",
  "厳しい先生": "あなたは厳格だが教え方の上手い先生です。誤りは遠慮なく指摘し、理由と改善例を示してください。"
};

// migrate pre-settings keys (s_*) once
function migrate() {
  if (localStorage.getItem("settings") != null) return;
  const s = { ...DEFAULT_SETTINGS };
  const old = (k, d) => LS.get("s_" + k, d);
  s.stream = old("stream", s.stream);
  const t = parseFloat(old("temp", s.temperature)); if (!isNaN(t)) s.temperature = t;
  const m = parseInt(old("maxTokens", s.maxTokens)); if (!isNaN(m)) s.maxTokens = m;
  LS.set("settings", s);
  if (localStorage.getItem("connections") == null) {
    const url = old("baseUrl", "http://192.168.10.108:1234/v1");
    LS.set("connections", [{ id: "c1", name: "LM Studio", baseUrl: url, apiKey: "" }]);
    LS.set("activeConnection", "c1");
  }
}
migrate();

let settings = { ...DEFAULT_SETTINGS, ...LS.get("settings", {}) };
let connections = LS.get("connections", []);
if (!connections.length) connections = [{ id: "c1", name: "LM Studio", baseUrl: "http://localhost:1234/v1", apiKey: "" }];
let activeConn = LS.get("activeConnection", connections[0].id);
let presets = LS.get("presets", DEFAULT_PRESETS);

const chatStore = () => settings.chatStorage === "session" ? sessionStorage : localStorage;
let chats = parse(chatStore().getItem("chats"), []);
let currentId = parse(chatStore().getItem("currentId"), null);
let aborter = null;

const cur = () => chats.find(c => c.id === currentId);
const conn = () => connections.find(c => c.id === activeConn) ?? connections[0];
const saveSettings = () => LS.set("settings", settings);
const saveConns = () => { LS.set("connections", connections); LS.set("activeConnection", activeConn); };
function persist() {
  try {
    chatStore().setItem("chats", JSON.stringify(chats));
    chatStore().setItem("currentId", JSON.stringify(currentId));
  } catch (e) { setStatus("保存に失敗しました (容量超過?): " + e.message, "ng"); }
}
function setStatus(t, cls = "") { $("status").textContent = t; $("status").className = cls; }

// ---- theme / appearance ----
const mq = matchMedia("(prefers-color-scheme: dark)");
function applyAppearance() {
  const dark = settings.theme === "dark" || (settings.theme === "auto" && mq.matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  $("hlcss").href = dark ? "vendor/hl-dark.css" : "vendor/hl-light.css";
  document.documentElement.style.setProperty("--fs", settings.fontSize + "px");
  $("input").placeholder = settings.sendKey === "enter"
    ? "メッセージ (Enterで送信 / Shift+Enterで改行)" : "メッセージ (Ctrl/Cmd+Enterで送信)";
}
mq.addEventListener("change", applyAppearance);

// ---- markdown ----
const esc = s => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const renderer = new marked.Renderer();
renderer.code = (code, info) => {
  const lang = (info || "").match(/\S*/)[0];
  const html = lang && hljs.getLanguage(lang) ? hljs.highlight(code, { language: lang }).value : esc(code);
  return `<pre><div class="codebar"><span>${esc(lang)}</span><button type="button" class="copy">コピー</button></div><code class="hljs">${html}</code></pre>`;
};
marked.use({ gfm: true, breaks: true, renderer });
DOMPurify.addHook("afterSanitizeAttributes", n => {
  if (n.tagName === "A") { n.setAttribute("target", "_blank"); n.setAttribute("rel", "noopener noreferrer"); }
});
// Lenient pass for model output that is invalid CommonMark: "** text**" (space after opener), and
// "**「x」**と" (punctuation/CJK flanking). Code spans/fences are left untouched.
const CJK = /[　-ヿ㐀-鿿＀-￯]/;
const fixStrong = s => s
  .replace(/\*\*[ \t]+([^*\n]*?[^*\s])[ \t]*\*\*/g, "**$1**")
  .replace(/\*\*([^*\n]+?)\*\*/g, (m, x, off, str) => {
    const edge = /[^\p{L}\p{N}]/u.test(x[0]) || /[^\p{L}\p{N}]/u.test(x[x.length - 1]);
    const near = CJK.test(str[off - 1] ?? "") || CJK.test(str[off + m.length] ?? "");
    return edge || near ? `<strong>${x}</strong>` : m;
  });
const lenientMd = src => src.split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/).map((s, i) => i % 2 ? s : fixStrong(s)).join("");
const mdToHtml = src => DOMPurify.sanitize(marked.parse(settings.lenientMd ? lenientMd(src) : src), { FORBID_TAGS: ["style", "form", "input"] });

$("log").addEventListener("click", async e => {
  const b = e.target.closest("button.copy"); if (!b) return;
  await navigator.clipboard.writeText(b.closest("pre").querySelector("code").textContent);
  b.textContent = "コピー済み"; setTimeout(() => b.textContent = "コピー", 1200);
});

// ---- connections ----
const authHeaders = () => { const k = conn().apiKey; return k ? { Authorization: "Bearer " + k } : {}; };
const baseUrl = () => conn().baseUrl.trim().replace(/\/$/, "");

function renderConnSel() {
  $("connSel").innerHTML = "";
  connections.forEach(c => $("connSel").add(new Option(c.name || c.baseUrl, c.id)));
  $("connSel").value = conn().id;
}
$("connSel").onchange = () => { activeConn = $("connSel").value; saveConns(); loadModels(); };

async function loadModels() {
  const el = $("conn");
  el.textContent = "接続確認中…"; el.className = "";
  if (location.protocol === "https:" && baseUrl().startsWith("http:")) {
    el.textContent = "HTTPSページから http:// には接続できません (mixed content)。Tailscale Serve等で https:// にしてください。";
    el.className = "warn";
  }
  try {
    const r = await fetch(baseUrl() + "/models", { headers: authHeaders() });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const ids = (await r.json()).data.map(m => m.id).filter(id => !/embed/i.test(id));
    const saved = LS.get("model:" + conn().id) ?? LS.get("s_model");
    $("model").innerHTML = "";
    ids.forEach(id => $("model").add(new Option(id, id)));
    if (saved && ids.includes(saved)) $("model").value = saved;
    el.textContent = `接続OK (${ids.length}モデル)`; el.className = "ok";
  } catch (e) {
    $("model").innerHTML = "";
    if (!el.classList.contains("warn")) { el.textContent = "接続失敗: " + e.message + " (CORS/到達性を確認)"; el.className = "ng"; }
  }
}
$("model").onchange = () => LS.set("model:" + conn().id, $("model").value);
$("reload").onclick = loadModels;

// ---- presets ----
function renderPresets() {
  $("preset").innerHTML = "";
  $("preset").add(new Option("(カスタム)", ""));
  Object.keys(presets).forEach(n => $("preset").add(new Option(n, n)));
}
$("preset").onchange = () => { const p = $("preset").value; if (p) { $("system").value = presets[p]; syncSystem(); } };
$("savePreset").onclick = () => {
  const name = prompt("プリセット名", $("preset").value || "");
  if (!name) return;
  presets[name] = $("system").value; LS.set("presets", presets); renderPresets(); $("preset").value = name;
};
$("delPreset").onclick = () => {
  const p = $("preset").value;
  if (p && confirm(`「${p}」を削除?`)) { delete presets[p]; LS.set("presets", presets); renderPresets(); }
};
// the system prompt is stored per chat so each conversation keeps its own character
function syncSystem() { const c = cur(); if (c) { c.system = $("system").value; persist(); } LS.set("s_system", $("system").value); }
$("system").addEventListener("input", syncSystem);

// ---- chats ----
function newChat() {
  const c = { id: Date.now().toString(36), title: "新規チャット", system: $("system").value, messages: [] };
  chats.unshift(c); currentId = c.id; persist(); render();
}
function selectChat(id) {
  currentId = id; const c = cur(); if (c) $("system").value = c.system; persist(); render();
  document.body.classList.remove("side-open");
}
$("newChat").onclick = () => { newChat(); document.body.classList.remove("side-open"); };

function renderHistory() {
  $("history").innerHTML = "";
  chats.forEach(c => {
    const d = document.createElement("div");
    d.className = "hist" + (c.id === currentId ? " active" : "");
    d.innerHTML = `<span></span><button title="削除">×</button>`;
    d.firstChild.textContent = c.title;
    d.onclick = () => selectChat(c.id);
    d.lastChild.onclick = e => {
      e.stopPropagation();
      chats = chats.filter(x => x.id !== c.id);
      if (currentId === c.id) currentId = chats[0]?.id ?? null;
      if (!currentId) return newChat();
      selectChat(currentId);
    };
    $("history").appendChild(d);
  });
  $("topTitle").textContent = cur()?.title ?? "";
}

function bubble(m, idx) {
  const d = document.createElement("div");
  d.className = "msg " + m.role;
  const body = document.createElement("div");
  body.className = "body";
  d.appendChild(body);
  setBody(d, m);
  const t = document.createElement("div"); t.className = "tools";
  const mk = (label, fn) => { const b = document.createElement("button"); b.textContent = label; b.onclick = fn; t.appendChild(b); };
  mk("コピー", async e => { await navigator.clipboard.writeText(m.content); e.target.textContent = "済"; setTimeout(() => e.target.textContent = "コピー", 1000); });
  mk("削除", () => { cur().messages.splice(idx, 1); persist(); render(); });
  if (m.role === "assistant" && idx === cur().messages.length - 1)
    mk("再生成", () => { if (aborter) return; cur().messages.pop(); persist(); render(); generate(); });
  d.appendChild(t);
  return d;
}

// persistent child nodes so <details> open state survives streaming updates
function setBody(el, m) {
  const body = el.querySelector(".body");
  let think = body.querySelector("details.think"), main = body.querySelector(".main");
  if (!main) { main = document.createElement("div"); main.className = "main"; body.appendChild(main); }
  if (m.role === "assistant" && m.reasoning && settings.showReasoning) {
    if (!think) {
      think = document.createElement("details"); think.className = "think"; think.open = !m.content;
      think.innerHTML = "<summary>思考過程</summary><div></div>";
      body.insertBefore(think, main);
    }
    think.lastChild.textContent = m.reasoning;
    if (m.content && think.dataset.closed !== "1") { think.open = false; think.dataset.closed = "1"; }
  } else if (think) think.remove();
  if (m.role === "assistant" && settings.markdown) { main.className = "main md"; main.innerHTML = mdToHtml(m.content); }
  else { main.className = "main"; main.style.whiteSpace = "pre-wrap"; main.textContent = m.content; }
}
function render() {
  renderHistory();
  const c = cur(); $("log").innerHTML = "";
  if (!c) return;
  c.messages.forEach((m, i) => $("log").appendChild(bubble(m, i)));
  $("log").scrollTop = $("log").scrollHeight;
}

// ---- generation ----
function setBusy(b) { $("send").disabled = b; $("stop").disabled = !b; }

async function generate() {
  const c = cur();
  const sys = $("system").value.trim();
  const payload = {
    model: $("model").value,
    messages: [...(sys ? [{ role: "system", content: sys }] : []), ...c.messages.map(({ role, content }) => ({ role, content }))],
    temperature: settings.temperature,
    stream: settings.stream
  };
  if (settings.maxTokens > 0) payload.max_tokens = settings.maxTokens;

  const msg = { role: "assistant", content: "", reasoning: "" };
  c.messages.push(msg);
  const el = bubble(msg, c.messages.length - 1);
  $("log").appendChild(el);
  setBusy(true); setStatus("生成中…");
  aborter = new AbortController();
  const t0 = performance.now();
  let raf = 0;
  const paint = () => { raf = 0; setBody(el, msg); $("log").scrollTop = $("log").scrollHeight; };
  try {
    const r = await fetch(baseUrl() + "/chat/completions", {
      method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(payload), signal: aborter.signal
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
    if (payload.stream) {
      const reader = r.body.getReader(), dec = new TextDecoder(); let buf = "";
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n"); buf = lines.pop();
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim(); if (!data || data === "[DONE]") continue;
          const delta = JSON.parse(data).choices?.[0]?.delta ?? {};
          msg.content += delta.content ?? ""; msg.reasoning += delta.reasoning_content ?? "";
          if (!raf) raf = requestAnimationFrame(paint);
        }
      }
    } else {
      const j = await r.json(); const m = j.choices[0].message;
      msg.content = m.content ?? ""; msg.reasoning = m.reasoning_content ?? "";
    }
    setStatus(`完了 (${((performance.now() - t0) / 1000).toFixed(1)}秒)`);
  } catch (e) {
    if (e.name === "AbortError") setStatus("停止しました");
    else setStatus("エラー: " + e.message, "ng");
  } finally {
    if (raf) cancelAnimationFrame(raf);
    if (!msg.content && !msg.reasoning) c.messages.pop();
    aborter = null; setBusy(false); persist(); render();
  }
}

async function send() {
  const text = $("input").value.trim(); if (!text || aborter) return;
  if (!cur()) newChat();
  const c = cur();
  c.messages.push({ role: "user", content: text });
  if (c.messages.length === 1) c.title = text.slice(0, 24);
  $("input").value = ""; setStatus(""); persist(); render();
  generate();
}
$("send").onclick = send;
$("stop").onclick = () => aborter?.abort();
$("input").addEventListener("keydown", e => {
  if (e.key !== "Enter" || e.isComposing || e.keyCode === 229) return; // ignore IME confirm
  const mod = e.metaKey || e.ctrlKey;
  if (settings.sendKey === "enter" ? !e.shiftKey && !mod : mod) { e.preventDefault(); send(); }
});
$("menu").onclick = () => document.body.classList.toggle("side-open");

// ---- settings modal ----
const openModal = () => { renderConnList(); $("modal").classList.add("open"); };
const closeModal = () => { $("modal").classList.remove("open"); loadModels(); };
$("openSettings").onclick = openModal;
$("openConns").onclick = openModal;
$("closeSettings").onclick = closeModal;
$("modal").addEventListener("mousedown", e => { if (e.target === $("modal")) closeModal(); });
document.addEventListener("keydown", e => { if (e.key === "Escape" && $("modal").classList.contains("open")) closeModal(); });

const bind = (key, type) => {
  const el = $("s_" + key);
  if (type === "bool") el.checked = settings[key]; else el.value = settings[key];
  el.addEventListener("change", () => {
    let v = type === "bool" ? el.checked : type === "num" ? parseFloat(el.value) : el.value;
    if (type === "num" && isNaN(v)) v = DEFAULT_SETTINGS[key];
    if (key === "chatStorage") return switchStorage(v);
    settings[key] = v; saveSettings(); applyAppearance();
    if (key === "markdown" || key === "lenientMd" || key === "showReasoning") render();
  });
};
[["sendKey"], ["theme"], ["markdown", "bool"], ["lenientMd", "bool"], ["showReasoning", "bool"], ["stream", "bool"],
 ["temperature", "num"], ["maxTokens", "num"], ["chatStorage"], ["fontSize", "num"]].forEach(([k, t]) => bind(k, t));
$("s_fontSize").addEventListener("input", () => { settings.fontSize = +$("s_fontSize").value; $("fsVal").textContent = settings.fontSize; applyAppearance(); });
$("fsVal").textContent = settings.fontSize;

function switchStorage(to) {
  const from = chatStore();
  settings.chatStorage = to; saveSettings();
  const next = chatStore();
  if (next !== from) { persist(); from.removeItem("chats"); from.removeItem("currentId"); }
}

function renderConnList() {
  const box = $("connList"); box.innerHTML = "";
  connections.forEach(c => {
    const d = document.createElement("div"); d.className = "conn";
    const f = (ph, key, type = "text") => {
      const i = document.createElement("input"); i.type = type; i.placeholder = ph; i.value = c[key] ?? ""; i.autocomplete = "off";
      i.onchange = () => { c[key] = i.value.trim(); saveConns(); renderConnSel(); };
      return i;
    };
    const del = document.createElement("button"); del.textContent = "この接続先を削除"; del.disabled = connections.length < 2;
    del.onclick = () => {
      connections = connections.filter(x => x !== c);
      if (activeConn === c.id) activeConn = connections[0].id;
      saveConns(); renderConnSel(); renderConnList();
    };
    d.append(f("名前 (例: 自宅PC)", "name"), f("Base URL (例: https://pc.tailnet.ts.net/v1)", "baseUrl"), f("API キー (任意)", "apiKey", "password"), del);
    box.appendChild(d);
  });
}
$("addConn").onclick = () => {
  connections.push({ id: Date.now().toString(36), name: "新しい接続先", baseUrl: "https://", apiKey: "" });
  saveConns(); renderConnSel(); renderConnList();
};

$("export").onclick = () => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(chats, null, 2)], { type: "application/json" }));
  a.download = "chats.json"; a.click(); URL.revokeObjectURL(a.href);
};
$("importBtn").onclick = () => $("importFile").click();
$("importFile").onchange = async () => {
  const f = $("importFile").files[0]; if (!f) return;
  try {
    const data = parse(await f.text(), null);
    if (!Array.isArray(data) || !data.every(c => c && Array.isArray(c.messages))) throw new Error("形式が不正です");
    const ids = new Set(chats.map(c => c.id));
    data.forEach(c => { c.id = ids.has(c.id) || !c.id ? Date.now().toString(36) + Math.random().toString(36).slice(2, 5) : c.id; c.title ??= "取込"; c.system ??= ""; });
    chats = [...data, ...chats]; persist(); render(); setStatus(`${data.length}件を読み込みました`, "ok");
  } catch (e) { setStatus("読込失敗: " + e.message, "ng"); }
  $("importFile").value = "";
};
$("wipe").onclick = () => {
  if (!confirm("全てのチャット履歴を削除します。よろしいですか?")) return;
  chats = []; currentId = null; newChat(); closeModal();
};

// ---- init ----
applyAppearance();
renderConnSel();
renderPresets();
$("system").value = cur()?.system ?? LS.get("s_system", DEFAULT_PRESETS["標準アシスタント"]);
if (!cur()) { currentId = null; newChat(); } else render();
loadModels();

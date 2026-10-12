// Chat wiring: sends the conversation to /api/chat, streams the reply,
// and drives the face from mood events plus a few local reactions.

const chat = document.getElementById("chat");
const form = document.getElementById("composer");
const input = document.getElementById("input");
const sendBtn = document.getElementById("send");
const modelSel = document.getElementById("model");
const chipsEl = document.getElementById("chips");
const statusEl = document.getElementById("status");
const statusText = document.getElementById("status-text");

const history = [];
let busy = false;

const GREETINGS = [
  "[[happy]] Oh hey, a human! [[wink]] I'm Bredrin. Mostly eyes, zero hands, plenty of opinions. What's up? [[suggest: Tell me a joke]] [[suggest: What can you do?]] [[suggest: Show me your faces]]",
  "[[excited]] You're here! [[smug]] I've been practising my expressions all day. Go on, say something. [[suggest: Make me laugh]] [[suggest: Roast my to-do list]] [[suggest: Who made you?]]",
];

// ---------- model picker ----------
async function loadModels() {
  const params = new URLSearchParams(location.search);
  let saved = null;
  try { saved = localStorage.getItem("bredrin.model"); } catch {}
  const { models, default: def } = await fetch("/api/models").then((r) => r.json());
  for (const m of models) modelSel.add(new Option(m.label, m.id));
  const want = params.get("model") || saved || def;
  modelSel.value = models.some((m) => m.id === want) ? want : def;
}
modelSel.addEventListener("change", () => {
  try { localStorage.setItem("bredrin.model", modelSel.value); } catch {}
  Face.set("surprised", { hold: 900 });
  input.focus();
});

// ---------- rendering ----------
function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function format(text) {
  return escapeHtml(text.replace(/ {2,}/g, " ")) // mood tags leave double spaces behind
    .replace(/`([^`\n]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?]|$)/g, "$1<em>$2</em>");
}
function addMsg(cls, text = "") {
  const row = document.createElement("div");
  row.className = `row ${cls}`;
  if (cls === "bot") row.innerHTML = '<div class="avatar"></div>';
  const el = document.createElement("div");
  el.className = `msg ${cls}`;
  el.innerHTML = format(text);
  row.appendChild(el);
  chat.appendChild(row);
  chat.scrollTop = chat.scrollHeight;
  el.remove = () => row.remove(); // removing a message takes its row with it
  return el;
}

function setStatus(state) {
  const labels = { online: "Online", listening: "Listening", thinking: "Thinking", responding: "Responding" };
  statusEl.dataset.state = state;
  statusText.textContent = labels[state];
}

function showChips(list) {
  chipsEl.replaceChildren(...list.slice(0, 3).map((t) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip";
    b.textContent = t;
    b.addEventListener("click", () => { if (!busy) send(t); });
    return b;
  }));
  chat.scrollTop = chat.scrollHeight;
}

// Plays a pre-scripted line through the same mood/text pipeline (used for greetings).
async function playScripted(line) {
  const el = addMsg("bot");
  let text = "";
  const suggestions = [];
  const parts = line.split(/(\[\[[^\]]+\]\])/);
  Face.setTalking(true);
  setStatus("responding");
  for (const p of parts) {
    const s = p.match(/^\[\[suggest:\s*(.+)\]\]$/);
    if (s) { suggestions.push(s[1].trim()); continue; }
    const m = p.match(/^\[\[([a-z]+)\]\]$/);
    if (m) { Face.set(m[1]); continue; }
    for (const ch of p) {
      text += ch;
      el.innerHTML = format(text.trimStart());
      await new Promise((r) => setTimeout(r, 18));
    }
  }
  Face.setTalking(false);
  setStatus("online");
  showChips(suggestions);
  setTimeout(() => Face.set(Face.mood, { hold: 2500 }), 0);
  return text.trim();
}

// ---------- sending ----------
async function send(text) {
  busy = true;
  sendBtn.disabled = true;
  history.push({ role: "user", content: text });
  addMsg("me", text);
  showChips([]);

  Face.set("thinking");
  setStatus("thinking");
  const suggestions = [];
  const el = addMsg("bot");
  let reply = "";
  let raw = ""; // reply with [[mood]] tags kept, so the model sees its own habit
  let gotText = false;

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: modelSel.value, messages: history }),
    });
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n\n")) !== -1) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        if (!line.startsWith("data: ")) continue;
        const ev = JSON.parse(line.slice(6));
        if (ev.type === "mood") {
          raw += `[[${ev.mood}]] `;
          Face.set(ev.mood);
        } else if (ev.type === "text") {
          if (!gotText) { gotText = true; Face.setTalking(true); setStatus("responding"); if (Face.mood === "thinking") Face.set("neutral"); }
          reply += ev.text;
          raw += ev.text;
          el.innerHTML = format(reply.trimStart());
          chat.scrollTop = chat.scrollHeight;
        } else if (ev.type === "suggest") {
          raw += ` [[suggest: ${ev.text}]]`;
          suggestions.push(ev.text);
        } else if (ev.type === "error") {
          el.remove();
          addMsg("err", ev.message);
          Face.set("confused", { hold: 3000 });
        }
      }
    }
  } catch (err) {
    el.remove();
    addMsg("err", "Lost connection to the server.");
    Face.set("sad", { hold: 3000 });
  }

  Face.setTalking(false);
  setStatus("online");
  showChips(suggestions);
  if (reply.trim()) {
    history.push({ role: "assistant", content: raw.trim() });
    Face.set(Face.mood, { hold: 3500 }); // linger on the last expression, then relax
  } else {
    el.remove();
    history.pop(); // keep user/assistant alternation intact
  }
  busy = false;
  sendBtn.disabled = false;
  input.focus();
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text || busy) return;
  input.value = "";
  send(text);
});

// ---------- little local reactions ----------
let typingTimer = null;
input.addEventListener("input", () => {
  wake();
  if (busy) return;
  if (Face.mood === "neutral" || Face.mood === "listening") Face.set("listening");
  setStatus("listening");
  clearTimeout(typingTimer);
  typingTimer = setTimeout(() => {
    if (busy) return;
    setStatus("online");
    if (Face.mood === "listening") Face.set("neutral");
  }, 1500);
});

// poke the face: giggles, then gets grumpy if you keep going
let pokes = [];
Face.el.addEventListener("click", () => {
  wake();
  if (busy) return;
  const now = Date.now();
  pokes = pokes.filter((t) => now - t < 2500).concat(now);
  Face.el.classList.add("poked");
  setTimeout(() => Face.el.classList.remove("poked"), 140);
  if (pokes.length >= 5) Face.set("annoyed", { hold: 2200 });
  else if (pokes.length >= 3) Face.set("surprised", { hold: 900 });
  else Face.set("laugh", { hold: 1100 });
});

// doze off when ignored, wake up startled
let lastActivity = Date.now();
function wake() {
  lastActivity = Date.now();
  if (Face.mood === "sleepy") Face.set("surprised", { hold: 900 });
}
["pointerdown", "keydown"].forEach((ev) => document.addEventListener(ev, wake));
setInterval(() => {
  if (!busy && Date.now() - lastActivity > 45000 && Face.mood !== "sleepy") Face.set("sleepy");
}, 3000);

// ---------- boot ----------
(async () => {
  await loadModels();
  input.focus();
  const line = GREETINGS[Math.floor(Math.random() * GREETINGS.length)];
  await playScripted(line);
  history.push({ role: "assistant", content: line });
})();

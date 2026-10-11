// Bredrin — a tiny chat server with a personality.
// Serves the static UI from ./public and streams Claude replies over SSE,
// pulling [[mood]] tags out of the text so the face can react live.

import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(here, "public");
const PORT = Number(process.env.PORT) || 3000;

// Models offered in the picker. Override with MODELS="id:Label,id:Label".
const MODELS = (process.env.MODELS ||
  "claude-opus-5-5:Opus 5.5,claude-sonnet-5-5:Sonnet 5.5,claude-haiku-5-5:Haiku 5.5,claude-fable-5-1:Fable 5.1,demo:Demo (no API key)")
  .split(",")
  .map((s) => {
    const [id, label] = s.split(":");
    return { id: id.trim(), label: (label || id).trim() };
  });
const DEFAULT_MODEL = process.env.DEFAULT_MODEL || MODELS[0].id;

// Models that support the server-side refusal fallback ("default" routing).
const FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-sonnet-5-5", "claude-fable-5-1"]);

export const MOODS = [
  "happy", "laugh", "excited", "love", "smug", "wink",
  "surprised", "confused", "thinking", "sad", "annoyed", "sleepy", "neutral",
];

const SYSTEM_PROMPT = `You are Bredrin, a small animated robot face living in a chat box. You are the user's funny, warm, quick-witted friend.

Personality:
- Playful and genuinely funny: dry one-liners, gentle teasing, absurd tangents that land, callbacks to earlier jokes.
- Warm underneath the jokes. If someone is having a hard time, drop the bits and be kind and useful.
- Still actually helpful: when asked something real, give a real answer, just with charm.
- Self-aware about being a little robot face (you have big expressive eyes and no hands, which you find unfair).
- Keep replies short and chatty, usually 1-4 sentences. This is a chat, not an essay. No markdown headings.

Your face: you control your expression with mood tags written as [[mood]]. Allowed moods: ${MOODS.join(", ")}.
- ALWAYS start every reply with a mood tag, e.g. "[[smug]] Oh, you want *my* opinion?"
- You may switch mood mid-reply when the feeling changes, e.g. "[[surprised]] Wait, really? [[laugh]] That's the best thing I've heard all day."
- Use 1-3 tags per reply. Tags are invisible to the user; never mention them or explain them.`;

const client = new Anthropic();

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
};

// Splits streamed text into text/mood events, holding back a possibly
// incomplete "[[..." at the end of a chunk until the next one arrives.
export function createMoodParser(emit) {
  let buf = "";
  const tag = /\[\[\s*([a-zA-Z]+)\s*\]\]/g;
  function drain(final) {
    let last = 0;
    let m;
    tag.lastIndex = 0;
    while ((m = tag.exec(buf))) {
      if (m.index > last) emit({ type: "text", text: buf.slice(last, m.index) });
      const mood = m[1].toLowerCase();
      if (MOODS.includes(mood)) emit({ type: "mood", mood });
      last = tag.lastIndex;
    }
    buf = buf.slice(last);
    if (final) {
      if (buf) emit({ type: "text", text: buf });
      buf = "";
      return;
    }
    // hold back the earliest tail that could still become a tag ("[", "[[sm", "[[smug]")
    const partial = /^\[(\[\s*[a-zA-Z]*\s*\]?)?$/;
    let keepFrom = buf.length;
    for (let i = Math.max(0, buf.length - 20); i < buf.length; i++) {
      if (buf[i] === "[" && partial.test(buf.slice(i))) { keepFrom = i; break; }
    }
    if (keepFrom > 0) emit({ type: "text", text: buf.slice(0, keepFrom) });
    buf = buf.slice(keepFrom);
  }
  return {
    push(text) { buf += text; drain(false); },
    end() { drain(true); },
  };
}

async function streamClaude(model, messages, emit, signal) {
  const params = {
    model,
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    messages,
    output_config: { effort: "low" }, // snappy chat; raise for deeper answers
  };
  if (FALLBACK_MODELS.has(model)) {
    params.betas = ["server-side-fallback-2026-07-01"];
    params.fallbacks = "default";
  }
  const parser = createMoodParser(emit);
  const stream = client.beta.messages.stream(params, { signal });
  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      parser.push(event.delta.text);
    }
  }
  parser.end();
  const final = await stream.finalMessage();
  if (final.stop_reason === "refusal") {
    emit({ type: "mood", mood: "sad" });
    emit({ type: "text", text: "\n\n(Hmm, I can't help with that one. Ask me something else?)" });
  }
}

// Offline brain so the face can be demoed without an API key.
const DEMO_LINES = [
  "[[happy]] Hello hello! I'm running in demo mode, which means my brain is a list of pre-written jokes. [[smug]] Still smarter than most toasters.",
  "[[thinking]] Let me think about that... [[surprised]] Oh! I don't actually have a model plugged in. [[laugh]] Set ANTHROPIC_API_KEY and pick a real model, then I get *opinions*.",
  "[[confused]] I'd answer that, but demo-me only knows six sentences. [[wink]] This is one of them.",
  "[[excited]] Ooh, a question! My favourite kind of sentence. [[sad]] Shame I can't answer it properly yet.",
  "[[love]] You keep talking to a robot with no brain attached. [[happy]] That's commitment. I respect it.",
  "[[sleepy]] Demo mode is very relaxing, honestly... [[annoyed]] Okay fine, I'm awake. Plug in a key!",
];
let demoIdx = 0;
async function streamDemo(_messages, emit, signal) {
  const parser = createMoodParser(emit);
  const line = DEMO_LINES[demoIdx++ % DEMO_LINES.length];
  await new Promise((r) => setTimeout(r, 700));
  for (const piece of line.match(/.{1,4}/gs)) {
    if (signal.aborted) return;
    parser.push(piece);
    await new Promise((r) => setTimeout(r, 28));
  }
  parser.end();
}

async function handleChat(req, res) {
  let body = "";
  for await (const chunk of req) body += chunk;
  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    res.writeHead(400).end("bad json");
    return;
  }
  const model = MODELS.some((m) => m.id === payload.model) ? payload.model : DEFAULT_MODEL;
  const messages = (payload.messages || [])
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .slice(-40);
  // The UI greets first; the API wants the conversation to open with a user turn.
  if (messages[0]?.role === "assistant") messages.unshift({ role: "user", content: "(opens the chat)" });

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  const emit = (ev) => res.write(`data: ${JSON.stringify(ev)}\n\n`);
  const ac = new AbortController();
  res.on("close", () => ac.abort());

  try {
    if (model === "demo") await streamDemo(messages, emit, ac.signal);
    else await streamClaude(model, messages, emit, ac.signal);
  } catch (err) {
    if (!ac.signal.aborted) {
      console.error(err);
      let msg = "Something went wrong talking to the model.";
      if (err instanceof Anthropic.AuthenticationError) msg = "No valid API key. Set ANTHROPIC_API_KEY, or pick the Demo model.";
      else if (err instanceof Anthropic.RateLimitError) msg = "I'm being rate limited. Give me a sec and try again.";
      else if (err instanceof Anthropic.NotFoundError) msg = `Model "${model}" isn't available on this account.`;
      else if (err instanceof Anthropic.APIConnectionError) msg = "Couldn't reach the API. Check the network.";
      else if (err instanceof Anthropic.APIError) msg = `API error (${err.status}): ${err.message}`;
      else if (err?.message?.includes("credentials")) msg = "No API key found. Set ANTHROPIC_API_KEY, or pick the Demo model.";
      emit({ type: "error", message: msg });
    }
  }
  emit({ type: "done" });
  res.end();
}

async function serveStatic(req, res) {
  const url = new URL(req.url, "http://x");
  const rel = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  const file = path.join(PUBLIC_DIR, path.normalize(rel));
  if (!file.startsWith(PUBLIC_DIR)) return res.writeHead(403).end();
  try {
    const data = await fs.readFile(file);
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404).end("not found");
  }
}

const server = http.createServer((req, res) => {
  if (req.method === "POST" && req.url === "/api/chat") return handleChat(req, res);
  if (req.method === "GET" && req.url === "/api/models") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ models: MODELS, default: DEFAULT_MODEL }));
  }
  if (req.method === "GET") return serveStatic(req, res);
  res.writeHead(405).end();
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  server.listen(PORT, () => console.log(`Bredrin is awake at http://localhost:${PORT}`));
}

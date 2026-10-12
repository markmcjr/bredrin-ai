// Builds a server-less copy of the UI into dist/ for static hosting.
// It only offers the Demo model: /api/* calls are answered in the browser.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEMO_LINES } from "../server.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");

await fs.rm(dist, { recursive: true, force: true });
await fs.cp(path.join(root, "public"), dist, { recursive: true });

const shim = `// Static demo: answers /api/models and /api/chat in the browser.
(() => {
  const LINES = ${JSON.stringify(DEMO_LINES)};
  const MOODS = ${JSON.stringify((await import("../server.js")).MOODS)};
  let i = 0;
  const realFetch = window.fetch.bind(window);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  window.fetch = async (url, opts) => {
    if (url === "/api/models") {
      return new Response(JSON.stringify({ models: [{ id: "demo", label: "Demo" }], default: "demo" }));
    }
    if (url !== "/api/chat") return realFetch(url, opts);
    const line = LINES[i++ % LINES.length];
    const enc = new TextEncoder();
    const body = new ReadableStream({
      async start(ctl) {
        const send = (ev) => ctl.enqueue(enc.encode("data: " + JSON.stringify(ev) + "\\n\\n"));
        await sleep(700);
        for (const part of line.split(/(\\[\\[[^\\]]+\\]\\])/)) {
          const s = part.match(/^\\[\\[\\s*suggest\\s*:\\s*(.+?)\\s*\\]\\]$/);
          const m = part.match(/^\\[\\[\\s*([a-z]+)\\s*\\]\\]$/);
          if (s) send({ type: "suggest", text: s[1] });
          else if (m) { if (MOODS.includes(m[1])) send({ type: "mood", mood: m[1] }); }
          else for (const piece of part.match(/[\\s\\S]{1,4}/g) || []) { send({ type: "text", text: piece }); await sleep(28); }
        }
        send({ type: "done" });
        ctl.close();
      },
    });
    return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
  };
})();
`;
await fs.writeFile(path.join(dist, "static-demo.js"), shim);

// load the shim first, and switch absolute API/asset paths to relative ones
const indexPath = path.join(dist, "index.html");
let html = await fs.readFile(indexPath, "utf8");
html = html.replace('<script src="face.js"></script>', '<script src="static-demo.js"></script>\n  <script src="face.js"></script>');
await fs.writeFile(indexPath, html);
console.log("Static demo written to dist/");

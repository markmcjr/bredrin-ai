import { test } from "node:test";
import assert from "node:assert/strict";
import { createMoodParser } from "../server.js";

function run(chunks) {
  const out = [];
  const p = createMoodParser((e) => out.push(e));
  chunks.forEach((c) => p.push(c));
  p.end();
  // merge adjacent text events for easy comparison
  return out.reduce((acc, e) => {
    const last = acc[acc.length - 1];
    if (e.type === "text" && last?.type === "text") last.text += e.text;
    else acc.push({ ...e });
    return acc;
  }, []);
}

test("extracts moods from a single chunk", () => {
  assert.deepEqual(run(["[[happy]] Hi! [[laugh]] ha"]), [
    { type: "mood", mood: "happy" },
    { type: "text", text: " Hi! " },
    { type: "mood", mood: "laugh" },
    { type: "text", text: " ha" },
  ]);
});

test("handles tags split across chunks", () => {
  assert.deepEqual(run(["Well [", "[sm", "ug]", "] sure"]), [
    { type: "text", text: "Well " },
    { type: "mood", mood: "smug" },
    { type: "text", text: " sure" },
  ]);
});

test("drops unknown moods and keeps ordinary brackets", () => {
  assert.deepEqual(run(["[[banana]]a [link] b"]), [{ type: "text", text: "a [link] b" }]);
});

test("extracts suggestions, even when split across chunks", () => {
  assert.deepEqual(run(["[[happy]] Sure! [[sugg", "est: Tell me", " another]] [[suggest: Stop]]"]), [
    { type: "mood", mood: "happy" },
    { type: "text", text: " Sure! " },
    { type: "suggest", text: "Tell me another" },
    { type: "text", text: " " },
    { type: "suggest", text: "Stop" },
  ]);
});

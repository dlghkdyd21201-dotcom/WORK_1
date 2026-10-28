"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { writeClipboardText } = require("../lib/clipboard.cjs");

test("desktop clipboard receives the complete Korean entry without changing its text", () => {
  const entry =
    "던전 전투 최종 엔트리 (15명)\n" +
    Array.from(
      { length: 15 },
      (_, i) => `${i + 1}. 혈맹원${i + 1} · 기사 · Lv.${90 - i}`,
    ).join("\n");
  const copies = [];
  assert.deepEqual(
    writeClipboardText({ writeText: (value) => copies.push(value) }, entry),
    { copied: true },
  );
  assert.deepEqual(copies, [entry]);
});

test("invalid clipboard payloads never modify the system clipboard", () => {
  let writes = 0;
  for (const value of [null, {}, "", "   ", "a\u0000b", "x".repeat(20001)]) {
    assert.throws(
      () => writeClipboardText({ writeText: () => writes++ }, value),
      /엔트리/,
    );
  }
  assert.equal(writes, 0);
});

"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  normalizeManualRank,
  rankMembers,
  hydrateManualRanks,
} = require("../lib/manual-ranking.cjs");

function deepFreeze(value) {
  for (const child of Object.values(value))
    if (child && typeof child === "object") deepFreeze(child);
  return Object.freeze(value);
}

test("manual rank normalization is nullable and accepts only bounded integers", () => {
  for (const value of [undefined, null])
    assert.equal(normalizeManualRank(value), null);
  for (const value of [1, 15, 5000])
    assert.equal(normalizeManualRank(value), value);
  for (const value of [
    0,
    -1,
    5001,
    1.5,
    "1",
    "",
    true,
    false,
    {},
    [],
    NaN,
    Infinity,
  ])
    assert.throws(() => normalizeManualRank(value));
});

test("ranking retains duplicate assigned ranks, ignores XP, and clones members without mutation", () => {
  const members = deepFreeze([
    {
      id: "rank-2-z",
      name: "하늘",
      level: 200,
      experience: 100,
      manualRank: 2,
      note: "보존",
    },
    { id: "unranked-z", name: "하늘", level: 100, experience: 100 },
    { id: "rank-2-a", name: "가람", level: 1, experience: 0, manualRank: 2 },
    {
      id: "unranked-a-z",
      name: "가람",
      level: 100,
      experience: 100,
      manualRank: null,
    },
    {
      id: "rank-first",
      name: "첫 순위",
      level: 1,
      experience: 0,
      manualRank: 1,
    },
    {
      id: "unranked-a-a",
      name: "가람",
      level: 100,
      experience: 0,
      manualRank: null,
    },
    { id: "unranked-low", name: "가람", level: 99, experience: 100, rank: 1 },
  ]);
  const before = structuredClone(members);
  const ranked = rankMembers(members);
  assert.deepEqual(
    ranked.map(({ id }) => id),
    [
      "rank-first",
      "rank-2-a",
      "rank-2-z",
      "unranked-a-a",
      "unranked-a-z",
      "unranked-z",
      "unranked-low",
    ],
  );
  assert.deepEqual(
    ranked.map(({ rank }) => rank),
    [1, 2, 2, null, null, null, null],
  );
  assert.deepEqual(
    ranked.map(({ manualRank }) => manualRank),
    [1, 2, 2, null, null, null, null],
  );
  assert.deepEqual(members, before);
  assert.equal(ranked.find(({ id }) => id === "rank-2-z").note, "보존");
  for (const member of ranked)
    assert.notEqual(
      member,
      members.find(({ id }) => id === member.id),
    );
});

test("hydration restores exact-ID archive ranks only for members missing their own manualRank", () => {
  const data = deepFreeze({
    members: [
      { id: "restore", name: "복구", level: 1, experience: 0, rank: 4000 },
      { id: "cleared", name: "삭제", manualRank: null },
      { id: "edited", name: "변경", manualRank: 99 },
      {
        id: "different-id",
        name: "같은 이름",
        level: 200,
        experience: 100,
        rank: 1,
      },
      { id: "zero", name: "0 순위", rank: 2 },
      { id: "invalid", name: "유효하지 않은 원본", rank: 3 },
      { id: "string", name: "문자열 원본", rank: 4 },
    ],
    battles: [
      { id: "historic", participants: [{ id: "restore", name: "과거 이름" }] },
    ],
    finalEntry: { members: [{ id: "restore", rank: 1 }] },
    metadata: { retained: [null, "가상 자료"] },
    legacyImport: {
      sourceBackup: {
        data: {
          members: [
            { id: "restore", nickname: "예전 이름", rank: 7 },
            { id: "cleared", rank: 8 },
            { id: "edited", rank: 9 },
            { id: "other-id", nickname: "같은 이름", rank: 10 },
            { id: "zero", rank: 0 },
            { id: "invalid", rank: 5001 },
            { id: "string", rank: "11" },
          ],
        },
      },
      retained: true,
    },
  });
  const before = structuredClone(data);
  const result = hydrateManualRanks(data);
  assert.equal(result.changed, true);
  assert.equal(result.restoredCount, 1);
  assert.deepEqual(
    result.data.members.map(({ manualRank }) => manualRank),
    [7, null, 99, null, null, null, null],
  );
  assert.equal(result.data.members[0].rank, 4000);
  assert.deepEqual(result.data.legacyImport, before.legacyImport);
  assert.deepEqual(result.data.battles, before.battles);
  assert.deepEqual(result.data.finalEntry, before.finalEntry);
  assert.deepEqual(result.data.metadata, before.metadata);
  assert.deepEqual(data, before);
  const repeated = hydrateManualRanks(result.data);
  assert.equal(repeated.changed, false);
  assert.equal(repeated.restoredCount, 0);
  assert.deepEqual(repeated.data, result.data);
});

test("hydration makes old members explicitly unranked without inventing ranks from level, XP or rank", () => {
  const data = {
    members: [
      { id: "old", name: "예전 혈맹원", level: 200, experience: 100, rank: 1 },
      { id: "explicit", name: "이미 미입력", manualRank: null },
    ],
    battles: [],
  };
  const before = structuredClone(data);
  const result = hydrateManualRanks(data);
  assert.equal(result.changed, true);
  assert.equal(result.restoredCount, 0);
  assert.deepEqual(
    result.data.members.map(({ manualRank }) => manualRank),
    [null, null],
  );
  assert.deepEqual(data, before);
  const empty = { members: [] };
  assert.deepEqual(hydrateManualRanks(empty), {
    data: empty,
    restoredCount: 0,
    changed: false,
  });
});

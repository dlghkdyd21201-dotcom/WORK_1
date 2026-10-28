"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { pathToFileURL } = require("node:url");
const path = require("node:path");

const domain = import(pathToFileURL(path.join(__dirname, "../src/domain.js")));

function member(overrides = {}) {
  return {
    id: "member-1",
    name: "검증 기사",
    class: "기사",
    level: 80,
    experience: 25.5,
    role: "혈맹원",
    note: "검증용 자료",
    createdAt: "2026-10-28T01:00:00.000Z",
    updatedAt: "2026-10-28T01:00:00.000Z",
    ...overrides,
  };
}

function battle(overrides = {}) {
  return {
    id: "battle-1",
    dungeon: "검증 던전",
    date: "2026-10-28",
    time: "21:30",
    result: "성공",
    participantIds: ["member-1"],
    participants: [{ id: "member-1", name: "검증 기사", class: "기사" }],
    durationMinutes: 30,
    loot: "기록용 보상",
    note: "검증용 전투",
    createdAt: "2026-10-28T01:00:00.000Z",
    updatedAt: "2026-10-28T01:00:00.000Z",
    ...overrides,
  };
}

test("member editing allows its own name and preserves creation time without mutating input", async () => {
  const { validateMember } = await domain;
  const original = member({ name: "  검증 기사  ", note: " 메모 " });
  const snapshot = structuredClone(original);
  const saved = validateMember(original, [member()], "member-1");
  assert.equal(saved.name, "검증 기사");
  assert.equal(saved.note, "메모");
  assert.equal(saved.createdAt, original.createdAt);
  assert.ok(Number.isFinite(Date.parse(saved.updatedAt)));
  assert.deepEqual(original, snapshot);
});

test("member names reject normalized or case-insensitive duplicates", async () => {
  const { validateMember } = await domain;
  for (const [existing, incoming] of [
    ["길드기사", " 길드기사 "],
    ["GuildKnight", "guildknight"],
    ["한글", "한글".normalize("NFD")],
  ]) {
    assert.throws(
      () =>
        validateMember(member({ id: "other", name: incoming }), [
          member({ name: existing }),
        ]),
      /같은 이름/,
    );
  }
});

test("member form rejects invalid levels, experience and blank identity fields", async () => {
  const { validateMember } = await domain;
  for (const overrides of [
    { id: "" },
    { name: "  " },
    { class: "" },
    { level: 0 },
    { level: 201 },
    { level: 80.5 },
    { level: "80" },
    { experience: -0.1 },
    { experience: 100.1 },
    { experience: NaN },
    { experience: Infinity },
  ])
    assert.throws(() => validateMember(member(overrides)));
  assert.equal(
    validateMember(member({ level: 1, experience: 0 })).experience,
    0,
  );
  assert.equal(
    validateMember(member({ level: 200, experience: 100 })).level,
    200,
  );
});

test("level ranking uses descending level then experience and competition ranks for ties", async () => {
  const { rankMembers } = await domain;
  const entries = [
    member({ id: "low", name: "하위", level: 79, experience: 100 }),
    member({ id: "tie-z", name: "하늘", experience: 70 }),
    member({ id: "second", name: "중간", experience: 60 }),
    member({ id: "tie-a", name: "가람", experience: 70 }),
    member({ id: "first", name: "최상위", level: 81, experience: 0 }),
  ];
  const original = structuredClone(entries);
  const ranked = rankMembers(entries);
  assert.deepEqual(
    ranked.map((entry) => entry.id),
    ["first", "tie-a", "tie-z", "second", "low"],
  );
  assert.deepEqual(
    ranked.map((entry) => entry.rank),
    [1, 2, 2, 4, 5],
  );
  assert.deepEqual(entries, original);
  assert.deepEqual(rankMembers([]), []);
});

test("battle records retain participant snapshots after a member leaves the roster", async () => {
  const { validateBattle } = await domain;
  const original = battle();
  const saved = validateBattle(original, []);
  assert.deepEqual(saved.participants, original.participants);
  assert.deepEqual(saved.participantIds, ["member-1"]);
  assert.equal(saved.createdAt, original.createdAt);
  assert.deepEqual(original, battle());
  assert.throws(
    () => validateBattle(battle({ participants: [] }), []),
    /참여자 정보/,
  );
});

test("battle records require real dates, valid times/results and unique known participants", async () => {
  const { validateBattle } = await domain;
  for (const overrides of [
    { dungeon: "" },
    { date: "2026-02-29" },
    { date: "2026-04-31" },
    { time: "24:00" },
    { time: "12:60" },
    { result: "미정" },
    { participantIds: [] },
    { participantIds: ["member-1", "member-1"] },
    { participantIds: ["unknown"] },
    { durationMinutes: -1 },
    { durationMinutes: 1.5 },
    { durationMinutes: 10081 },
  ])
    assert.throws(() => validateBattle(battle(overrides), [member()]));
  assert.equal(
    validateBattle(battle({ date: "2024-02-29", durationMinutes: "" }), [
      member(),
    ]).durationMinutes,
    0,
  );
});

test("new battle participant snapshots come from registered members", async () => {
  const { validateBattle } = await domain;
  const saved = validateBattle(battle({ participants: [] }), [
    member({ name: "등록 기사", class: "전사" }),
  ]);
  assert.deepEqual(saved.participants, [
    { id: "member-1", name: "등록 기사", class: "전사" },
  ]);
});

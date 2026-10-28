"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  ENTRY_CLASSES,
  resolveAbsentNames,
  selectEntry,
  validateEntrySettings,
} = require("../lib/entry.cjs");

function member(index, overrides = {}) {
  return {
    id: `member-${index}`,
    name: `캐릭터 ${index}`,
    class: "기사",
    level: 120 - index,
    manualRank: index + 1,
    experience: 50,
    ...overrides,
  };
}

test("entry classes expose the exact six-class order and distinguish both fairy classes", () => {
  assert.deepEqual(ENTRY_CLASSES, [
    "군주",
    "기사",
    "요정",
    "요정-똥물",
    "다크엘프",
    "마법사",
  ]);
  assert.ok(Object.isFrozen(ENTRY_CLASSES));
  const members = Array.from({ length: 18 }, (_, index) =>
    member(index, { class: index < 9 ? "요정" : "요정-똥물" }),
  );
  const classQuotas = Object.fromEntries(
    ENTRY_CLASSES.map((className) => [className, 0]),
  );
  classQuotas["요정"] = 7;
  classQuotas["요정-똥물"] = 8;
  const result = selectEntry(members, {
    mode: "class",
    classQuotas,
    absentIds: [],
  });
  assert.equal(
    result.members.filter((entry) => entry.class === "요정").length,
    7,
  );
  assert.equal(
    result.members.filter((entry) => entry.class === "요정-똥물").length,
    8,
  );
  assert.equal(result.vacancies, 0);
});

test("the six UI classes do not restrict existing saved quota classes", () => {
  const settings = {
    mode: "class",
    classQuotas: { 검사: 15 },
    absentIds: [],
  };
  const members = Array.from({ length: 15 }, (_, index) =>
    member(index, { class: "검사" }),
  );
  assert.equal(validateEntrySettings(settings), settings);
  assert.equal(selectEntry(members, settings).members.length, 15);
});

test("absence names accept commas, all newline forms, semicolons and empty separators", () => {
  const members = [
    member(0, { name: "가람" }),
    member(1, { name: "하늘" }),
    member(2, { name: "달빛 기사" }),
  ];
  assert.deepEqual(
    resolveAbsentNames(members, " 하늘,\n\n가람;\r\n달빛 기사,,,;\r\n "),
    {
      matchedMembers: [members[1], members[0], members[2]],
      unmatchedNames: [],
      duplicateNames: [],
    },
  );
});

test("normalized exact names deduplicate NFC, case and whitespace while retaining unknown names", () => {
  const members = [
    member(0, { name: "가람" }),
    member(1, { name: "Hero" }),
    member(2, { name: "Café".normalize("NFD") }),
  ];
  const decomposedKorean = "가람".normalize("NFD");
  const result = resolveAbsentNames(
    members,
    ` 가람, ${decomposedKorean}, HERO, hero, Hero, Café,  없는 이름 , 없는 이름, OTHER, other `,
  );
  assert.deepEqual(result, {
    matchedMembers: members,
    unmatchedNames: ["없는 이름", "OTHER"],
    duplicateNames: [decomposedKorean, "hero", "없는 이름", "other"],
  });
  result.matchedMembers.forEach((entry, index) => {
    assert.equal(entry, members[index]);
  });
});

test("absence names match complete character names rather than partial names, record IDs or classes", () => {
  const members = [
    member(0, { name: "별빛" }),
    member(1, { name: "별빛기사" }),
  ];
  assert.deepEqual(
    resolveAbsentNames(
      members,
      "별, member-0, 기사, 별빛, 별빛기사, 별빛기사님",
    ),
    {
      matchedMembers: members,
      unmatchedNames: ["별", "member-0", "기사", "별빛기사님"],
      duplicateNames: [],
    },
  );
});

test("empty absence text returns no matches and never mutates the roster", () => {
  const members = Object.freeze([
    Object.freeze(member(0, { name: "  Hero  ", note: "보존할 메모" })),
  ]);
  const before = structuredClone(members);
  for (const input of ["", " \t ", ",\n;\r\n,,"]) {
    assert.deepEqual(resolveAbsentNames(members, input), {
      matchedMembers: [],
      unmatchedNames: [],
      duplicateNames: [],
    });
  }
  const result = resolveAbsentNames(members, "hero");
  assert.equal(result.matchedMembers[0], members[0]);
  assert.deepEqual(members, before);
});

test("absence input is bounded and rejects malformed input with a readable error", () => {
  assert.deepEqual(resolveAbsentNames([], " ".repeat(10000)), {
    matchedMembers: [],
    unmatchedNames: [],
    duplicateNames: [],
  });
  const atLimit = resolveAbsentNames([], Array(5000).fill("a").join(","));
  assert.deepEqual(atLimit.unmatchedNames, ["a"]);
  assert.deepEqual(atLimit.duplicateNames, ["a"]);
  assert.throws(() => resolveAbsentNames([], "a".repeat(10001)), /10,000자/);
  assert.throws(
    () => resolveAbsentNames([], Array(5001).fill("a").join(",")),
    /10,000자|5,000개/,
  );
  for (const input of [null, undefined, [], 1])
    assert.throws(() => resolveAbsentNames([], input), /문자열/);
  assert.throws(
    () => resolveAbsentNames(Array(5001).fill(member(0)), ""),
    /혈맹원 목록/,
  );
});

test("matched absence names exclude their IDs and refill a complete top 15 without changing global ranks", () => {
  const members = Array.from({ length: 20 }, (_, index) => member(index));
  const resolved = resolveAbsentNames(
    members,
    "캐릭터 0, 캐릭터 4\n캐릭터 18, 캐릭터 0, 없는 캐릭터",
  );
  const absentIds = resolved.matchedMembers.map((entry) => entry.id);
  const result = selectEntry(members, {
    mode: "ranking",
    classQuotas: {},
    absentIds,
  });
  const expected = members
    .filter((entry) => !absentIds.includes(entry.id))
    .slice(0, 15);
  assert.deepEqual(
    result.members.map((entry) => entry.id),
    expected.map((entry) => entry.id),
  );
  assert.deepEqual(
    result.members.map((entry) => entry.rank),
    expected.map((entry) => members.indexOf(entry) + 1),
  );
  assert.equal(result.excludedCount, 3);
  assert.equal(result.vacancies, 0);
  assert.deepEqual(resolved.unmatchedNames, ["없는 캐릭터"]);
  assert.deepEqual(resolved.duplicateNames, ["캐릭터 0"]);
});

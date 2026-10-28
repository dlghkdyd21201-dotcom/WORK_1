"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  selectEntry,
  formatEntryText,
  validateEntrySettings,
} = require("../lib/entry.cjs");
const { validateDocument } = require("../lib/document.cjs");
const {
  createStore,
  parseBackup,
  FORMAT,
  VERSION,
  StoreError,
} = require("../lib/store.cjs");

const timestamp = "2026-10-28T01:00:00.000Z";
const classes = ["기사", "요정", "마법사"];

function member(index, overrides = {}) {
  return {
    id: `member-${String(index).padStart(2, "0")}`,
    name: `혈맹원 ${String(index).padStart(2, "0")}`,
    class: classes[index % classes.length],
    level: 120 - index,
    experience: 25.5,
    role: "혈맹원",
    note: "보존할 메모",
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

function roster(count = 30) {
  return Array.from({ length: count }, (_, index) => member(index));
}

function settings(overrides = {}) {
  return { mode: "ranking", classQuotas: {}, absentIds: [], ...overrides };
}

function classSettings(overrides = {}) {
  return settings({
    mode: "class",
    classQuotas: { 기사: 6, 요정: 5, 마법사: 4 },
    ...overrides,
  });
}

function snapshot(members, selectedSettings = settings()) {
  return {
    confirmedAt: timestamp,
    settings: structuredClone(selectedSettings),
    members: selectEntry(members, selectedSettings).members.map(
      ({ id, name, class: className, level, experience, rank }) => ({
        id,
        name,
        class: className,
        level,
        experience,
        rank,
      }),
    ),
  };
}

function envelope(data) {
  return {
    format: FORMAT,
    version: VERSION,
    revision: 1,
    updatedAt: timestamp,
    data,
  };
}

function deepFreeze(value) {
  for (const child of Object.values(value))
    if (child && typeof child === "object") deepFreeze(child);
  return Object.freeze(value);
}

test("ranking selects exactly the top 15 in descending level and experience", () => {
  const members = roster(24).reverse();
  const result = selectEntry(members, settings());
  assert.deepEqual(
    result.members.map((entry) => entry.id),
    roster(15).map((entry) => entry.id),
  );
  assert.deepEqual(
    result.members.map((entry) => entry.rank),
    Array.from({ length: 15 }, (_, index) => index + 1),
  );
  assert.equal(result.vacancies, 0);
  assert.equal(result.excludedCount, 0);
  assert.deepEqual(result.shortages, []);
  assert.deepEqual(selectEntry([], settings()), {
    members: [],
    shortages: [],
    vacancies: 15,
    excludedCount: 0,
  });
});

test("ties use Korean name then ID order and retain global competition ranks", async () => {
  const members = [
    member(0, { id: "low", name: "하위", level: 79, experience: 100 }),
    member(1, { id: "tie-z", name: "하늘", level: 80, experience: 70 }),
    member(2, { id: "second", name: "중간", level: 80, experience: 60 }),
    member(3, { id: "tie-a", name: "가람", level: 80, experience: 70 }),
    member(4, { id: "first", name: "최상위", level: 81, experience: 0 }),
  ];
  const { rankMembers } = await import("../src/domain.js");
  const selected = selectEntry(members, settings()).members;
  assert.deepEqual(selected, rankMembers(members));
  assert.deepEqual(
    selected.map((entry) => entry.rank),
    [1, 2, 2, 4, 5],
  );
  const idTies = [member(1), member(0)].map((entry) => ({
    ...entry,
    name: "같은 표시 이름",
    level: 80,
    experience: 50,
  }));
  assert.deepEqual(
    selectEntry(idTies, settings()).members.map((entry) => entry.id),
    ["member-00", "member-01"],
  );
  const tiedBoundary = roster(16).map((entry) => ({
    ...entry,
    level: 80,
    experience: 50,
  }));
  assert.equal(selectEntry(tiedBoundary, settings()).members.length, 15);
  assert.ok(
    selectEntry(tiedBoundary, settings()).members.every(
      (entry) => entry.rank === 1,
    ),
  );
});

test("ranking absences refill from the next eligible members without reranking or counting stale IDs", () => {
  const members = roster(20);
  const absentIds = [
    ...members.slice(0, 5).map((entry) => entry.id),
    "deleted-id",
  ];
  const result = selectEntry(members, settings({ absentIds }));
  assert.deepEqual(
    result.members.map((entry) => entry.id),
    members.slice(5).map((entry) => entry.id),
  );
  assert.deepEqual(
    result.members.map((entry) => entry.rank),
    Array.from({ length: 15 }, (_, index) => index + 6),
  );
  assert.equal(result.excludedCount, 5);
  assert.equal(result.vacancies, 0);
  const fewer = selectEntry(members.slice(0, 8), settings({ absentIds }));
  assert.equal(fewer.members.length, 3);
  assert.equal(fewer.vacancies, 12);
});

test("class selection takes each class's best quota and returns global ranking order", () => {
  const selectedSettings = classSettings({
    classQuotas: { 마법사: 4, 기사: 6, 요정: 5 },
  });
  const result = selectEntry(roster().reverse(), selectedSettings);
  assert.equal(result.members.length, 15);
  for (const [className, quota] of Object.entries(
    selectedSettings.classQuotas,
  )) {
    assert.equal(
      result.members.filter((entry) => entry.class === className).length,
      quota,
    );
    assert.deepEqual(
      result.members
        .filter((entry) => entry.class === className)
        .map((entry) => entry.id),
      roster()
        .filter((entry) => entry.class === className)
        .slice(0, quota)
        .map((entry) => entry.id),
    );
  }
  assert.deepEqual(
    result.members.map((entry) => entry.rank),
    result.members.map((entry) => entry.rank).sort((a, b) => a - b),
  );
  assert.deepEqual(result.shortages, []);
  assert.equal(result.vacancies, 0);
});

test("class absences refill from the same class only and report missing classes", () => {
  const members = roster();
  const replacement = selectEntry(
    members,
    classSettings({ absentIds: ["member-00", "member-02"] }),
  );
  assert.equal(replacement.members.length, 15);
  assert.ok(replacement.members.some((entry) => entry.id === "member-18"));
  assert.ok(replacement.members.some((entry) => entry.id === "member-14"));
  assert.ok(
    replacement.members.every(
      (entry) => !["member-00", "member-02"].includes(entry.id),
    ),
  );
  const missing = selectEntry(
    members,
    classSettings({
      classQuotas: { 기사: 10, "새로운 클래스": 5, 요정: 0 },
    }),
  );
  assert.equal(missing.members.length, 10);
  assert.ok(missing.members.every((entry) => entry.class === "기사"));
  assert.deepEqual(missing.shortages, [
    { class: "새로운 클래스", required: 5, available: 0, missing: 5 },
  ]);
  assert.equal(missing.vacancies, 5);
  const limited = selectEntry(
    members,
    classSettings({
      absentIds: members
        .filter((entry) => entry.class === "마법사")
        .slice(0, 7)
        .map((entry) => entry.id),
    }),
  );
  assert.equal(limited.members.length, 14);
  assert.equal(limited.vacancies, 1);
  assert.equal(limited.excludedCount, 7);
  assert.deepEqual(limited.shortages, [
    { class: "마법사", required: 4, available: 3, missing: 1 },
  ]);
});

test("saved quotas are exact integer totals, including while ranking ignores their proportions", () => {
  for (const candidate of [
    null,
    settings({ mode: "other" }),
    settings({ classQuotas: [] }),
    classSettings({ classQuotas: {} }),
    classSettings({ classQuotas: { 기사: 0 } }),
    classSettings({ classQuotas: { 기사: 14 } }),
    classSettings({ classQuotas: { 기사: 16 } }),
    settings({ classQuotas: { 기사: 1 } }),
    settings({ classQuotas: { 기사: -1 } }),
    settings({ classQuotas: { 기사: 1.5, 요정: 13.5 } }),
    settings({ classQuotas: { 기사: "15" } }),
    settings({ classQuotas: { 기사: NaN } }),
    settings({ classQuotas: { " ": 15 } }),
    settings({ classQuotas: { ["가".repeat(41)]: 15 } }),
    settings({ absentIds: ["duplicate", "duplicate"] }),
    settings({ absentIds: [" padded "] }),
    settings({ absentIds: [null] }),
    settings({
      absentIds: Array.from({ length: 5001 }, (_, index) => `id-${index}`),
    }),
  ])
    assert.throws(() => selectEntry(roster(), candidate));

  const savedQuotas = settings({ classQuotas: { 기사: 15, 요정: 0 } });
  assert.deepEqual(
    selectEntry(roster(), savedQuotas),
    selectEntry(roster(), settings()),
  );
  const allZero = settings({ classQuotas: { 기사: 0 } });
  assert.equal(validateEntrySettings(allZero), allZero);
  assert.deepEqual(
    selectEntry(roster(), allZero),
    selectEntry(roster(), settings()),
  );
  assert.equal(
    selectEntry(
      roster(15).map((entry) => ({ ...entry, class: "가".repeat(40) })),
      classSettings({ classQuotas: { ["가".repeat(40)]: 15 } }),
    ).members.length,
    15,
  );
});

test("selection does not mutate input arrays or objects and preserves full member fields", () => {
  const members = deepFreeze(roster());
  const selectedSettings = deepFreeze(
    classSettings({ absentIds: ["member-00"] }),
  );
  const before = structuredClone({ members, selectedSettings });
  const result = selectEntry(members, selectedSettings);
  assert.deepEqual({ members, selectedSettings }, before);
  const selected = result.members[0];
  const original = members.find((entry) => entry.id === selected.id);
  assert.notEqual(selected, original);
  const { rank, ...retained } = selected;
  assert.deepEqual(retained, original);
  assert.ok(rank > 0);
});

test("copy text contains a Korean header and exactly 15 numbered complete member lines", () => {
  const selected = selectEntry(roster(), settings()).members;
  const before = structuredClone(selected);
  const lines = formatEntryText(selected).split("\n");
  assert.equal(lines.length, 16);
  assert.match(lines[0], /던전.*15명/);
  for (const [index, entry] of selected.entries()) {
    assert.equal(
      lines[index + 1],
      `${index + 1}. ${entry.name} / ${entry.class} / 레벨 ${entry.level} / 경험치 ${entry.experience}%`,
    );
  }
  assert.deepEqual(selected, before);
  for (const entries of [
    [],
    selected.slice(0, 14),
    [...selected, member(99)],
    selected.map(() => selected[0]),
  ])
    assert.throws(() => formatEntryText(entries));
  const multiline = selected.map((entry) => ({ ...entry }));
  multiline[0].name = "첫째\n이름\t표시";
  multiline[0].class = "기사\r\n클래스";
  const multilineText = formatEntryText(multiline);
  assert.equal(multilineText.split("\n").length, 16);
  assert.ok(!multilineText.includes("\t"));
});

test("version 1 documents with no entry fields remain compatible and unchanged", () => {
  const oldData = { members: roster(2), battles: [] };
  const before = structuredClone(oldData);
  assert.equal(validateDocument(oldData), oldData);
  const parsed = parseBackup(JSON.stringify(envelope(oldData)));
  assert.equal(parsed.version, 1);
  assert.deepEqual(parsed.data, before);
  assert.deepEqual(oldData, before);
  assert.ok(!Object.hasOwn(parsed.data, "entrySettings"));
  assert.ok(!Object.hasOwn(parsed.data, "finalEntry"));
});

test("historic final snapshots remain valid after deletion and draft changes without normalization", async (t) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "clan-entry-history-"),
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, "clan.json");
  const data = {
    members: [],
    entrySettings: settings({
      classQuotas: { 기사: 0 },
      absentIds: ["member-00", "removed-id"],
    }),
    finalEntry: snapshot(roster(), classSettings()),
  };
  const before = structuredClone(data);
  assert.equal(validateDocument(data), data);
  assert.deepEqual(data, before);
  const store = createStore({ filePath });
  const saved = await store.save(data, 0);
  assert.deepEqual(saved.data, before);
  assert.deepEqual(await createStore({ filePath }).load(), saved);
});

test("malformed entry imports never replace existing usable native data", async (t) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "clan-entry-import-"),
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, "clan.json");
  const store = createStore({ filePath });
  const baseline = {
    members: roster(),
    entrySettings: settings(),
    finalEntry: snapshot(roster()),
  };
  const saved = await store.save(baseline, 0);
  const previous = await fs.readFile(filePath);
  const mutations = [
    (data) => {
      data.entrySettings = null;
    },
    (data) => {
      data.entrySettings.mode = "unknown";
    },
    (data) => {
      data.entrySettings.classQuotas = { 기사: 14 };
    },
    (data) => {
      data.entrySettings.classQuotas = { 기사: "15" };
    },
    (data) => {
      data.entrySettings.absentIds = ["same", "same"];
    },
    (data) => {
      data.finalEntry = null;
    },
    (data) => {
      data.finalEntry.confirmedAt = "yesterday";
    },
    (data) => {
      data.finalEntry.confirmedAt = "2026-02-30T01:00:00.000Z";
    },
    (data) => {
      data.finalEntry.settings = classSettings({ classQuotas: { 기사: 14 } });
    },
    (data) => {
      data.finalEntry.members.pop();
    },
    (data) => {
      data.finalEntry.members.push(member(99));
    },
    (data) => {
      data.finalEntry.members[1] = structuredClone(data.finalEntry.members[0]);
    },
    (data) => {
      data.finalEntry.members[0].id = " padded ";
    },
    (data) => {
      data.finalEntry.members[0].name = "";
    },
    (data) => {
      data.finalEntry.members[0].class = "";
    },
    (data) => {
      data.finalEntry.members[0].level = 0;
    },
    (data) => {
      data.finalEntry.members[0].experience = 101;
    },
    (data) => {
      data.finalEntry.members[0].rank = 0;
    },
    (data) => {
      data.finalEntry.members[0].rank = 5001;
    },
    (data) => {
      data.finalEntry.members[0].rank = 1.5;
    },
    (data) => {
      data.finalEntry.settings.absentIds = [data.finalEntry.members[0].id];
    },
    (data) => {
      data.finalEntry.settings = classSettings();
    },
  ];
  for (const [index, mutate] of mutations.entries()) {
    const data = structuredClone(baseline);
    mutate(data);
    assert.throws(
      () => validateDocument(data),
      undefined,
      `document case ${index}`,
    );
    await assert.rejects(
      store.importBackup(JSON.stringify(envelope(data)), saved.revision),
      (error) => error instanceof StoreError && error.code === "INVALID_DATA",
      `import case ${index}`,
    );
    assert.deepEqual(
      await fs.readFile(filePath),
      previous,
      `import case ${index} changed file`,
    );
    assert.deepEqual(await store.load(), saved);
  }
});

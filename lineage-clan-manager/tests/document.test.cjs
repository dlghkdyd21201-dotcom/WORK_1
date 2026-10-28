"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  createStore,
  FORMAT,
  VERSION,
  StoreError,
} = require("../lib/store.cjs");

const timestamp = "2026-10-28T01:00:00.000Z";
const person = {
  id: "member-1",
  name: "구성원",
  class: "기사",
  level: 80,
  experience: 50,
  role: "혈맹원",
  note: "",
  createdAt: timestamp,
  updatedAt: timestamp,
};
const event = {
  id: "battle-1",
  dungeon: "기록 던전",
  date: "2026-10-28",
  time: "20:00",
  result: "성공",
  durationMinutes: 45,
  participantIds: [person.id],
  participants: [{ id: person.id, name: person.name, class: person.class }],
  loot: "",
  note: "",
  createdAt: timestamp,
  updatedAt: timestamp,
};

async function fixture(t) {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "clan-document-test-"),
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, "clan.json");
  return { filePath, store: createStore({ filePath }) };
}

const invalid = (error) =>
  error instanceof StoreError && error.code === "INVALID_DATA";

test("malformed domain records in native imports never replace existing usable data", async (t) => {
  const { filePath, store } = await fixture(t);
  const initial = { members: [{ ...person }], battles: [{ ...event }] };
  const saved = await store.save(initial, 0);
  const previous = await fs.readFile(filePath);
  const cases = [
    { members: [{ ...person, class: "" }] },
    { members: [{ ...person, level: 0 }] },
    { members: [{ ...person, experience: 101 }] },
    { members: [{ ...person, manualRank: 0 }] },
    { members: [{ ...person, manualRank: -1 }] },
    { members: [{ ...person, manualRank: 5001 }] },
    { members: [{ ...person, manualRank: 1.5 }] },
    { members: [{ ...person, manualRank: "1" }] },
    { members: [{ ...person, createdAt: "bad timestamp" }] },
    {
      members: [{ ...person }, { ...person, id: "member-2", name: " 구성원 " }],
    },
    { members: [{ ...person }, { ...person, name: "다른 이름" }] },
    { members: [{ ...person }], battles: [null] },
    { members: [{ ...person }], battles: [{ ...event, date: "2026-02-30" }] },
    { members: [{ ...person }], battles: [{ ...event, result: "알 수 없음" }] },
    { members: [{ ...person }], battles: [{ ...event, participants: [] }] },
    {
      members: [{ ...person }],
      battles: [{ ...event, participantIds: ["different-id"] }],
    },
    {
      members: [{ ...person }],
      battles: [
        {
          ...event,
          participants: [{ id: person.id, name: "", class: "기사" }],
        },
      ],
    },
  ];
  for (const [index, data] of cases.entries()) {
    const source = JSON.stringify({
      format: FORMAT,
      version: VERSION,
      revision: 0,
      updatedAt: timestamp,
      data,
    });
    await assert.rejects(
      store.importBackup(source, saved.revision),
      invalid,
      `malformed record ${index}`,
    );
    assert.deepEqual(
      await fs.readFile(filePath),
      previous,
      `malformed record ${index} altered the database`,
    );
    assert.deepEqual(await store.load(), saved);
  }
});

test("version 1 accepts unknown XP and optional manual ranks without changing old records", async (t) => {
  const { filePath, store } = await fixture(t);
  const withoutExperience = { ...person, manualRank: 5000 };
  delete withoutExperience.experience;
  const input = {
    members: [
      withoutExperience,
      { ...person, id: "member-2", name: "순위 미입력", manualRank: null },
      { ...person, id: "member-3", name: "예전 혈맹원" },
    ],
  };
  const before = structuredClone(input);
  const saved = await store.save(input, 0);
  assert.deepEqual(input, before);
  assert.deepEqual(saved.data, before);
  assert.deepEqual(await createStore({ filePath }).load(), saved);
});

test("deleting a roster member keeps the historic battle participants across save and reopen", async (t) => {
  const { filePath, store } = await fixture(t);
  const initial = await store.save(
    { members: [{ ...person }], battles: [{ ...event }] },
    0,
  );
  const removed = await store.save(
    { ...initial.data, members: [] },
    initial.revision,
  );
  const reopened = await createStore({ filePath }).load();
  assert.deepEqual(reopened, removed);
  assert.deepEqual(reopened.data.battles[0].participants, event.participants);
  assert.deepEqual(reopened.data.battles[0].participantIds, [person.id]);
  assert.equal(reopened.data.battles[0].dungeon, event.dungeon);
});

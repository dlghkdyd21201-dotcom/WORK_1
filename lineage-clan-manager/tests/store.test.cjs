"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  FORMAT,
  VERSION,
  MAX_FILE_BYTES,
  StoreError,
  createStore,
  parseBackup,
  readLimited,
  writeBackup,
} = require("../lib/store.cjs");

async function fixture(t) {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "clan-store-test-"),
  );
  const filePath = path.join(directory, "data", "clan-data.json");
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return { directory, filePath, store: createStore({ filePath }) };
}

function sampleData(label = "자료 1") {
  return {
    members: [
      {
        id: "member-test-1",
        name: "테스트 혈맹원",
        class: "기사",
        level: 80,
        experience: 24.5,
        role: "일반",
        note: label,
        createdAt: "2026-10-28T01:00:00.000Z",
        updatedAt: "2026-10-28T01:00:00.000Z",
      },
    ],
    testMetadata: { enabled: true, count: 2, nested: ["한글", null, false] },
  };
}

function backup(data = sampleData(), overrides = {}) {
  return {
    format: FORMAT,
    version: VERSION,
    revision: 0,
    updatedAt: "2026-10-28T01:00:00.000Z",
    data,
    ...overrides,
  };
}

const isInvalid = (error) =>
  error instanceof StoreError && error.code === "INVALID_DATA";
const isConflict = (error) =>
  error instanceof StoreError && error.code === "REVISION_CONFLICT";

test("first load creates an empty versioned file and returned data is isolated", async (t) => {
  const { filePath, store } = await fixture(t);
  const initial = await store.load();
  assert.deepEqual(initial, { data: { members: [] }, revision: 0 });
  const onDisk = JSON.parse(await fs.readFile(filePath, "utf8"));
  assert.equal(onDisk.format, FORMAT);
  assert.equal(onDisk.version, VERSION);
  assert.equal(onDisk.revision, 0);
  assert.ok(Number.isFinite(Date.parse(onDisk.updatedAt)));
  assert.deepEqual(onDisk.data, initial.data);

  initial.data.members.push({ testId: "unsaved" });
  assert.deepEqual(await store.load(), { data: { members: [] }, revision: 0 });
  assert.deepEqual(await createStore({ filePath }).load(), {
    data: { members: [] },
    revision: 0,
  });
});

test("saved Unicode and JSON data survives reopening with increasing revisions", async (t) => {
  const { filePath, store } = await fixture(t);
  await store.load();
  const input = sampleData("혈맹 자료 보존 확인 🎮");
  const saved = await store.save(input, 0);
  assert.deepEqual(saved, { data: input, revision: 1 });
  input.members[0].note = "저장 후 입력 객체 변경";
  saved.data.members[0].note = "반환 객체 변경";

  const reopened = createStore({ filePath });
  const persisted = await reopened.load();
  assert.deepEqual(persisted, {
    data: sampleData("혈맹 자료 보존 확인 🎮"),
    revision: 1,
  });
  const changed = sampleData("수정한 자료");
  const next = await reopened.save(changed, persisted.revision);
  assert.equal(next.revision, 2);
  assert.deepEqual(await createStore({ filePath }).load(), {
    data: changed,
    revision: 2,
  });
});

test("accepted large bounded JSON remains readable after saving and reopening", async (t) => {
  const { filePath, store } = await fixture(t);
  await store.load();
  const data = sampleData();
  data.largeMetadata = Array.from({ length: 3000 }, () => {
    let value = { note: "x".repeat(1450) };
    for (let depth = 0; depth < 24; depth++) value = { child: value };
    return value;
  });
  assert.ok(Buffer.byteLength(JSON.stringify(data)) > 5_000_000);
  const saved = await store.save(data, 0);
  assert.ok((await fs.stat(filePath)).size <= MAX_FILE_BYTES);
  assert.deepEqual(await createStore({ filePath }).load(), saved);
});

test("concurrent duplicate writes commit once and stale reopened writers cannot overwrite", async (t) => {
  const { filePath, store } = await fixture(t);
  await store.load();
  const staleStore = createStore({ filePath });
  const stale = await staleStore.load();
  const results = await Promise.allSettled([
    store.save(sampleData("먼저 요청한 저장"), 0),
    store.save(sampleData("중복 요청한 저장"), 0),
  ]);
  assert.equal(
    results.filter((entry) => entry.status === "fulfilled").length,
    1,
  );
  assert.equal(
    results.filter((entry) => entry.status === "rejected").length,
    1,
  );
  assert.ok(
    isConflict(results.find((entry) => entry.status === "rejected").reason),
  );
  const after = await store.load();
  assert.equal(after.revision, 1);
  assert.equal(after.data.members[0].note, "먼저 요청한 저장");
  const bytes = await fs.readFile(filePath);
  await assert.rejects(
    staleStore.save(sampleData("오래된 화면의 저장"), stale.revision),
    isConflict,
  );
  assert.deepEqual(await fs.readFile(filePath), bytes);
  const valid = await staleStore.save(
    sampleData("새 버전으로 다시 저장"),
    after.revision,
  );
  assert.equal(valid.revision, 2);
});

test("invalid or oversized data never changes saved bytes or revision", async (t) => {
  const { filePath, store } = await fixture(t);
  await store.load();
  const original = await store.save(sampleData(), 0);
  const bytes = await fs.readFile(filePath);
  let tooDeep = { value: true };
  for (let index = 0; index < 40; index++) tooDeep = { child: tooDeep };
  const cycle = {};
  cycle.self = cycle;
  const invalid = [
    null,
    [],
    {},
    { members: {} },
    { members: [null] },
    { members: ["plain text"] },
    { members: [[]] },
    { members: Array.from({ length: 5001 }, () => ({})) },
    { members: [], value: Number.POSITIVE_INFINITY },
    { members: [], value: Number.NaN },
    { members: [], value: undefined },
    { members: [], value: () => true },
    { members: [], value: new Date() },
    { members: [], value: tooDeep },
    { members: [], value: cycle },
    JSON.parse('{"members":[],"__proto__":{"polluted":true}}'),
    JSON.parse('{"members":[],"nested":{"constructor":{}}}'),
    { members: [], note: "가".repeat(2 * 1024 * 1024) },
  ];
  for (const [index, data] of invalid.entries()) {
    await assert.rejects(
      store.save(data, original.revision),
      isInvalid,
      `invalid case ${index}`,
    );
    assert.deepEqual(
      await fs.readFile(filePath),
      bytes,
      `invalid case ${index} changed the file`,
    );
  }
  for (const revision of [-1, 0.5, "1", Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(store.save(sampleData(), revision), isInvalid);
    assert.deepEqual(await fs.readFile(filePath), bytes);
  }
  assert.deepEqual(await store.load(), original);
  const valid = await store.save(
    sampleData("오류 후 정상 저장"),
    original.revision,
  );
  assert.equal(valid.revision, original.revision + 1);
  assert.equal({}.polluted, undefined);
});

test("invalid and oversized backups are rejected without modifying current data", async (t) => {
  const { filePath, store } = await fixture(t);
  await store.load();
  const current = await store.save(sampleData("유지해야 하는 자료"), 0);
  const bytes = await fs.readFile(filePath);
  const invalid = [
    "{not JSON",
    "null",
    "[]",
    JSON.stringify(backup(undefined, { format: "another-program" })),
    JSON.stringify(backup(undefined, { version: 999 })),
    JSON.stringify(backup(undefined, { revision: -1 })),
    JSON.stringify(
      backup(undefined, { revision: Number.MAX_SAFE_INTEGER + 1 }),
    ),
    JSON.stringify(backup(undefined, { revision: "0" })),
    JSON.stringify(backup(undefined, { updatedAt: "not a date" })),
    JSON.stringify(backup({ members: [false] })),
    JSON.stringify(backup({ members: [], note: "가".repeat(2 * 1024 * 1024) })),
    " ".repeat(MAX_FILE_BYTES + 1),
  ];
  for (const [index, source] of invalid.entries()) {
    await assert.rejects(
      store.importBackup(source, current.revision),
      isInvalid,
      `invalid backup ${index}`,
    );
    assert.deepEqual(
      await fs.readFile(filePath),
      bytes,
      `invalid backup ${index} changed the file`,
    );
  }
  assert.deepEqual(await store.load(), current);
});

test("backup roundtrip restores only application data and checks the current revision", async (t) => {
  const { directory, filePath, store } = await fixture(t);
  await store.load();
  const initial = await store.save(sampleData("백업할 자료"), 0);
  const backupPath = path.join(directory, "혈맹관리-백업.json");
  const unrelatedCredential = "fixture-only-private-value-do-not-export-78";
  await fs.writeFile(
    path.join(directory, "machine-credentials.txt"),
    unrelatedCredential,
  );
  await store.exportBackup(backupPath);
  const exportedText = await fs.readFile(backupPath, "utf8");
  const exported = JSON.parse(exportedText);
  assert.deepEqual(Object.keys(exported).sort(), [
    "data",
    "format",
    "revision",
    "updatedAt",
    "version",
  ]);
  assert.deepEqual(exported.data, initial.data);
  assert.ok(!exportedText.includes(unrelatedCredential));
  assert.ok(!exportedText.includes(filePath));
  assert.equal(exported.revision, initial.revision);
  assert.deepEqual(parseBackup(Buffer.from(`\uFEFF${exportedText}`)), exported);

  const changed = await store.save(
    sampleData("나중에 수정한 자료"),
    initial.revision,
  );
  const changedBytes = await fs.readFile(filePath);
  await assert.rejects(
    store.importBackup(exportedText, initial.revision),
    isConflict,
  );
  assert.deepEqual(await fs.readFile(filePath), changedBytes);
  const restored = await store.importBackup(
    Buffer.from(exportedText),
    changed.revision,
  );
  assert.deepEqual(restored.data, initial.data);
  assert.equal(restored.revision, changed.revision + 1);
  assert.deepEqual(await createStore({ filePath }).load(), restored);
  assert.deepEqual(await fs.readFile(backupPath, "utf8"), exportedText);
});

test("export refuses the active data file and validates before replacing a backup", async (t) => {
  const { directory, filePath, store } = await fixture(t);
  await store.load();
  await store.save(sampleData(), 0);
  const currentBytes = await fs.readFile(filePath);
  await assert.rejects(store.exportBackup(filePath), isInvalid);
  await assert.rejects(
    store.exportBackup(
      path.join(path.dirname(filePath), ".", path.basename(filePath)),
    ),
    isInvalid,
  );
  assert.deepEqual(await fs.readFile(filePath), currentBytes);

  const backupPath = path.join(directory, "existing-backup.json");
  const previousBackup = "existing user-selected file contents\n";
  await fs.writeFile(backupPath, previousBackup);
  await assert.rejects(
    writeBackup(backupPath, backup(undefined, { version: 999 })),
    isInvalid,
  );
  assert.equal(await fs.readFile(backupPath, "utf8"), previousBackup);
  await store.exportBackup(backupPath);
  assert.deepEqual(
    parseBackup(await fs.readFile(backupPath)).data,
    sampleData(),
  );
});

test("malformed existing JSON is preserved by every operation until deliberately repaired", async (t) => {
  const { directory, filePath, store } = await fixture(t);
  await store.load();
  const valid = await fs.readFile(filePath);
  const corrupt = Buffer.from(
    '{"format":"lineage-clan-manager","data":\n',
    "utf8",
  );
  await fs.writeFile(filePath, corrupt);
  const reopened = createStore({ filePath });
  const exportPath = path.join(directory, "must-not-be-created.json");
  await assert.rejects(reopened.load(), isInvalid);
  await assert.rejects(reopened.save(sampleData(), 0), isInvalid);
  await assert.rejects(
    reopened.importBackup(JSON.stringify(backup()), 0),
    isInvalid,
  );
  await assert.rejects(reopened.exportBackup(exportPath), isInvalid);
  assert.deepEqual(await fs.readFile(filePath), corrupt);
  await assert.rejects(fs.stat(exportPath), (error) => error.code === "ENOENT");
  await fs.writeFile(filePath, valid);
  assert.deepEqual(await reopened.load(), {
    data: { members: [] },
    revision: 0,
  });
});

test("oversized files are bounded on read and are never replaced with empty data", async (t) => {
  const { filePath, store } = await fixture(t);
  await store.load();
  const file = await fs.open(filePath, "w");
  try {
    await file.truncate(MAX_FILE_BYTES + 1);
  } finally {
    await file.close();
  }
  await assert.rejects(readLimited(filePath), isInvalid);
  await assert.rejects(store.load(), isInvalid);
  await assert.rejects(store.save(sampleData(), 0), isInvalid);
  assert.equal((await fs.stat(filePath)).size, MAX_FILE_BYTES + 1);
});

test("failed disk commit preserves the previous file, cleans temporary data and permits retry", async (t) => {
  const { filePath, store } = await fixture(t);
  await store.load();
  const original = await store.save(sampleData("커밋 전에 보존할 자료"), 0);
  const originalBytes = await fs.readFile(filePath);
  const rename = fs.rename;
  let injected = false;
  fs.rename = async (source, destination) => {
    if (!injected && path.resolve(destination) === path.resolve(filePath)) {
      injected = true;
      const error = new Error("simulated disk commit failure");
      error.code = "EIO";
      throw error;
    }
    return rename(source, destination);
  };
  try {
    await assert.rejects(
      store.save(sampleData("저장되면 안 되는 자료"), original.revision),
      (error) => error.code === "EIO",
    );
  } finally {
    fs.rename = rename;
  }
  assert.equal(injected, true);
  assert.deepEqual(await fs.readFile(filePath), originalBytes);
  assert.deepEqual(await store.load(), original);
  assert.deepEqual((await fs.readdir(path.dirname(filePath))).sort(), [
    path.basename(filePath),
  ]);
  const retried = await store.save(
    sampleData("다시 저장한 자료"),
    original.revision,
  );
  assert.equal(retried.revision, original.revision + 1);
  assert.deepEqual(await createStore({ filePath }).load(), retried);
});

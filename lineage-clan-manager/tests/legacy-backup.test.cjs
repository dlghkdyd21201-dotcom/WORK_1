"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { convertBackup } = require("../lib/legacy-backup.cjs");
const { parseBackup, writeBackup, createStore } = require("../lib/store.cjs");
const { main: convertFile } = require("../scripts/convert-backup.cjs");

// All records in these tests are generated fixtures, never uploaded user data.
function legacyFixture(count = 54) {
  return {
    format: "lineage-clan-manager",
    version: 1,
    revision: 0,
    updatedAt: "2025-01-02T03:04:05.000Z",
    syntheticMetadata: { preserved: true, list: [null, false, "가상 자료"] },
    data: {
      members: Array.from({ length: count }, (_, index) => ({
        id: `synthetic-member-${index + 1}`,
        nickname: `가상 구성원 ${String(index + 1).padStart(2, "0")}`,
        job: index % 9 === 0 ? "요정-똥" : "기사",
        joined: "",
        active: index !== count - 1,
        rank: index === count - 1 ? 0 : 1,
        level: index < 29 ? null : 80 + (index % 20),
      })),
      syntheticUnknownData: { retainedInArchive: [1, 2, 3] },
    },
  };
}

async function directoryFixture(t) {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "clan-convert-test-"),
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

test("legacy conversion preserves every identity and archives the complete original envelope", () => {
  const source = legacyFixture();
  const original = structuredClone(source);
  const { backup, report } = convertBackup(source);
  assert.deepEqual(report, {
    kind: "legacy",
    members: 54,
    missingLevels: 29,
    missingExperience: 54,
    renamedClasses: 6,
    inactiveMembers: 1,
  });
  assert.equal(backup.format, source.format);
  assert.equal(backup.version, 1);
  assert.equal(backup.revision, 0);
  assert.equal(new Date(backup.updatedAt).toISOString(), backup.updatedAt);
  assert.equal(backup.updatedAt, backup.data.legacyImport.importedAt);
  assert.deepEqual(
    backup.data.members.map((member) => member.id),
    source.data.members.map((member) => member.id),
  );
  assert.deepEqual(
    backup.data.members.map((member) => member.name),
    source.data.members.map((member) => member.nickname),
  );
  assert.deepEqual(backup.data.legacyImport.sourceBackup, original);
  assert.deepEqual(source, original);
  assert.notStrictEqual(backup.data.legacyImport.sourceBackup, source);
  backup.data.legacyImport.sourceBackup.data.members[0].nickname =
    "변경한 가상 자료";
  backup.data.legacyImport.sourceBackup.syntheticMetadata.list.push("변경");
  assert.deepEqual(source, original);
  assert.equal(backup.data.members[0].name, original.data.members[0].nickname);
});

test("compatibility defaults are explicit and legacy rank and activity never invent a role or absence", () => {
  const source = legacyFixture();
  const { backup } = convertBackup(source);
  const { members, legacyImport } = backup.data;
  assert.equal(members.filter((member) => member.level === 1).length, 29);
  for (const [index, member] of members.entries()) {
    assert.equal(
      member.level,
      index < 29 ? 1 : source.data.members[index].level,
    );
    assert.equal(member.experience, 0);
    assert.equal(member.role, "미기록");
    assert.match(member.note, /경험치 미기재\(임시0%\)/);
    if (index < 29)
      assert.match(member.note, /원본 레벨 미기재\(임시 Lv\.1, 수정 필요\)/);
    else assert.doesNotMatch(member.note, /원본 레벨 미기재/);
    assert.match(
      member.note,
      new RegExp(`원본 순위: ${source.data.members[index].rank}`),
    );
    assert.equal(Object.hasOwn(member, "createdAt"), false);
    assert.equal(Object.hasOwn(member, "updatedAt"), false);
    assert.doesNotMatch(member.note, /가입일/);
  }
  assert.match(members[53].note, /비활동\(active=false\)/);
  assert.match(members[0].note, /활동\(active=true\)/);
  assert.equal(Object.hasOwn(backup.data, "entrySettings"), false);
  assert.equal(legacyImport.defaults.level.value, 1);
  assert.equal(legacyImport.defaults.level.requiresReview, true);
  assert.equal(legacyImport.defaults.level.count, 29);
  assert.equal(legacyImport.defaults.experience.value, 0);
  assert.equal(legacyImport.defaults.experience.count, 54);
  assert.equal(legacyImport.defaults.role.value, "미기록");
});

test("fairy alias changes only the exact requested class and can be disabled", () => {
  const source = legacyFixture(3);
  source.data.members[1].job = "기존 사용자 클래스";
  source.data.members[2].job = "요정-똥물";
  const changed = convertBackup(source);
  assert.equal(changed.backup.data.members[0].class, "요정-똥물");
  assert.match(changed.backup.data.members[0].note, /요정-똥 → 요정-똥물/);
  assert.equal(changed.report.renamedClasses, 1);
  assert.equal(
    changed.backup.data.legacyImport.sourceBackup.data.members[0].job,
    "요정-똥",
  );
  const kept = convertBackup(source, { normalizeFairyClass: false });
  assert.equal(kept.backup.data.members[0].class, "요정-똥");
  assert.doesNotMatch(kept.backup.data.members[0].note, /클래스 표기 변경/);
  assert.equal(kept.report.renamedClasses, 0);
  assert.equal(
    kept.backup.data.legacyImport.defaults.normalizeFairyClass,
    false,
  );
  for (const result of [changed, kept]) {
    assert.equal(result.backup.data.members[1].class, "기존 사용자 클래스");
    assert.equal(result.backup.data.members[2].class, "요정-똥물");
    assert.deepEqual(result.backup.data.legacyImport.sourceBackup, source);
  }
});

test("numeric legacy activity flags preserve their literal values and count inactivity", () => {
  const source = legacyFixture();
  for (const [index, member] of source.data.members.entries())
    member.active = index === 53 ? 0 : 1;
  const { backup, report } = convertBackup(source);
  assert.equal(report.members, 54);
  assert.equal(report.inactiveMembers, 1);
  assert.match(backup.data.members[0].note, /활동\(active=1\)/);
  assert.match(backup.data.members[53].note, /비활동\(active=0\)/);
  assert.deepEqual(backup.data.legacyImport.sourceBackup, source);
  assert.equal(Object.hasOwn(backup.data, "entrySettings"), false);
  for (const invalid of [-1, 2, "1", "0"]) {
    source.data.members[0].active = invalid;
    assert.throws(() => convertBackup(source));
  }
});

test("known values and joined text are preserved without manufacturing per-member timestamps", () => {
  const source = legacyFixture(1);
  Object.assign(source.data.members[0], {
    level: 200,
    experience: 72.35,
    joined: "2024-05-06",
    rank: 9,
  });
  const { backup, report } = convertBackup(source);
  const member = backup.data.members[0];
  assert.equal(member.level, 200);
  assert.equal(member.experience, 72.35);
  assert.match(member.note, /원본 가입일: 2024-05-06/);
  assert.match(member.note, /원본 순위: 9/);
  assert.equal(Object.hasOwn(member, "createdAt"), false);
  assert.equal(Object.hasOwn(member, "updatedAt"), false);
  assert.equal(report.missingLevels, 0);
  assert.equal(report.missingExperience, 0);
});

test("converted backup passes the real validator, disk writer, import and reopen", async (t) => {
  const directory = await directoryFixture(t);
  const { backup } = convertBackup(legacyFixture());
  assert.deepEqual(parseBackup(JSON.stringify(backup)), backup);
  const output = path.join(directory, "converted.json");
  await writeBackup(output, backup);
  assert.deepEqual(parseBackup(await fs.readFile(output)), backup);
  const filePath = path.join(directory, "application-data.json");
  const store = createStore({ filePath });
  const current = await store.load();
  const imported = await store.importBackup(
    await fs.readFile(output),
    current.revision,
  );
  assert.deepEqual(imported.data, backup.data);
  assert.deepEqual(await createStore({ filePath }).load(), imported);
});

test("native and already-converted inputs pass unchanged without another archive", () => {
  const { backup } = convertBackup(legacyFixture(2));
  backup.revision = 7;
  backup.nativeExtraMetadata = { synthetic: true };
  const before = structuredClone(backup);
  const native = convertBackup(backup, { normalizeFairyClass: false });
  assert.deepEqual(native.backup, before);
  assert.deepEqual(backup, before);
  assert.equal(native.report.kind, "native");
  assert.equal(native.report.members, 2);
  assert.equal(native.report.missingLevels, 0);
  assert.equal(native.report.renamedClasses, 0);
  assert.equal(
    Object.hasOwn(
      native.backup.data.legacyImport.sourceBackup.data,
      "legacyImport",
    ),
    false,
  );
  const empty = { ...legacyFixture(0), revision: 4 };
  assert.deepEqual(convertBackup(empty).backup, empty);
  assert.equal(convertBackup(empty).report.kind, "native");
});

test("malformed, duplicate and out-of-range records are rejected without dropping or changing source data", () => {
  const changes = [
    (source) => {
      delete source.data.members[0].id;
    },
    (source) => {
      source.data.members[0].id = " ";
    },
    (source) => {
      source.data.members[0].nickname = "";
    },
    (source) => {
      source.data.members[0].nickname = "x".repeat(41);
    },
    (source) => {
      source.data.members[0].job = "";
    },
    (source) => {
      source.data.members[0].level = 0;
    },
    (source) => {
      source.data.members[0].level = 201;
    },
    (source) => {
      source.data.members[0].level = 1.5;
    },
    (source) => {
      source.data.members[0].level = "80";
    },
    (source) => {
      source.data.members[0].experience = -1;
    },
    (source) => {
      source.data.members[0].experience = 101;
    },
    (source) => {
      source.data.members[0].experience = "0";
    },
    (source) => {
      source.data.members[0].rank = -1;
    },
    (source) => {
      source.data.members[0].active = "false";
    },
    (source) => {
      source.data.members[0].joined = {};
    },
    (source) => {
      source.data.members[1].id = source.data.members[0].id;
    },
    (source) => {
      source.data.members[1].nickname = ` ${source.data.members[0].nickname} `;
    },
    (source) => {
      source.data.members[0] = null;
    },
    (source) => {
      source.format = "other-format";
    },
    (source) => {
      source.version = 2;
    },
    (source) => {
      source.revision = -1;
    },
    (source) => {
      source.updatedAt = "invalid";
    },
  ];
  for (const [index, change] of changes.entries()) {
    const source = legacyFixture(2);
    change(source);
    const original = structuredClone(source);
    assert.throws(() => convertBackup(source), Error, `case ${index}`);
    assert.deepEqual(source, original, `case ${index} mutated source`);
  }
  for (const source of [
    null,
    [],
    {},
    { ...legacyFixture(1), nonJson: undefined },
  ])
    assert.throws(() => convertBackup(source));
  const unsafe = JSON.parse(JSON.stringify(legacyFixture(1)));
  unsafe.data.unsafe = JSON.parse('{"__proto__":{"polluted":true}}');
  assert.throws(() => convertBackup(unsafe));
  assert.equal({}.polluted, undefined);
  assert.throws(() =>
    convertBackup(legacyFixture(1), { normalizeFairyClass: "false" }),
  );
});

test("CLI accepts UTF-8 BOM, produces validated output and logs only aggregate counts", async (t) => {
  const directory = await directoryFixture(t);
  const source = legacyFixture(3);
  const input = path.join(directory, "synthetic-input.json");
  const output = path.join(directory, "synthetic-output.json");
  const bytes = `\uFEFF${JSON.stringify(source)}`;
  await fs.writeFile(input, bytes);
  const report = await convertFile([input, output, "--keep-original-class"]);
  const summary = JSON.stringify(report);
  assert.equal(report.members, 3);
  assert.equal(report.renamedClasses, 0);
  for (const member of source.data.members)
    assert.ok(!summary.includes(member.nickname));
  assert.ok(!summary.includes(input));
  const converted = parseBackup(await fs.readFile(output));
  assert.equal(converted.data.members[0].class, "요정-똥");
  assert.deepEqual(converted.data.legacyImport.sourceBackup, source);
  assert.equal(await fs.readFile(input, "utf8"), bytes);
  assert.deepEqual((await fs.readdir(directory)).sort(), [
    "synthetic-input.json",
    "synthetic-output.json",
  ]);
});

test("CLI refuses existing destinations and invalid records without overwriting files or leaking input", async (t) => {
  const directory = await directoryFixture(t);
  const input = path.join(directory, "synthetic-input.json");
  const output = path.join(directory, "existing-output.json");
  const source = legacyFixture(1);
  const originalInput = JSON.stringify(source);
  await fs.writeFile(input, originalInput);
  await fs.writeFile(output, "preserve existing contents");
  for (const destination of [output, input]) {
    await assert.rejects(
      convertFile([input, destination]),
      (error) => !error.message.includes(source.data.members[0].nickname),
    );
  }
  assert.equal(await fs.readFile(output, "utf8"), "preserve existing contents");
  assert.equal(await fs.readFile(input, "utf8"), originalInput);
  source.data.members[0].level = 201;
  await fs.writeFile(input, JSON.stringify(source));
  const invalidOutput = path.join(directory, "must-not-exist.json");
  await assert.rejects(
    convertFile([input, invalidOutput]),
    (error) => !error.message.includes(source.data.members[0].nickname),
  );
  await assert.rejects(
    fs.stat(invalidOutput),
    (error) => error.code === "ENOENT",
  );
});

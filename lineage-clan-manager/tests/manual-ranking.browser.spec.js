import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

const KEY = "lineage-clan-manager:data:v1";
const timestamp = "2026-10-28T00:00:00.000Z";
const CLASSES = ["군주", "기사", "요정", "요정-똥물", "다크엘프", "마법사"];

// Every member and archived source record in this suite is synthetic.
function member(index, overrides = {}) {
  return {
    id: `manual-browser-${index}`,
    name: `수기검증${String(index).padStart(2, "0")}`,
    class: CLASSES[(index - 1) % CLASSES.length],
    level: 150 - index,
    experience: 88.125,
    manualRank: index,
    role: "혈맹원",
    note: "합성 브라우저 검증 자료",
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

function envelope(data) {
  return {
    format: "lineage-clan-manager",
    version: 1,
    revision: 0,
    updatedAt: timestamp,
    data,
  };
}

async function seed(page, data) {
  await page.addInitScript(
    ({ key, snapshot }) => {
      if (localStorage.getItem(key) === null) {
        localStorage.setItem(key, JSON.stringify(snapshot));
      }
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (value) => {
            window.__manualEntryCopy = value;
          },
        },
      });
    },
    { key: KEY, snapshot: envelope(data) },
  );
}

async function stored(page) {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)), KEY);
}

async function openRanking(page) {
  await page.getByRole("button", { name: "레벨 랭킹", exact: true }).click();
}

async function openDungeon(page) {
  await page.getByRole("button", { name: "던전 전투", exact: true }).click();
}

async function editMember(page, name) {
  await page.getByRole("button", { name: "혈맹원", exact: true }).click();
  await page.getByRole("button", { name: `${name} 수정`, exact: true }).click();
  return page.getByRole("dialog", { name: "혈맹원 수정", exact: true });
}

async function saveEditor(editor) {
  await editor.getByRole("button", { name: "수정 저장", exact: true }).click();
  await expect(editor).not.toBeVisible();
}

const rankingRows = (page) => page.locator(".ranking-table tbody tr");
const entryTable = (page) =>
  page.getByRole("table", { name: "선발 엔트리", exact: true });
const confirmButton = (page) =>
  page.getByRole("button", { name: "엔트리 확정·저장", exact: true });
const copyButton = (page) =>
  page.getByRole("button", { name: "최종 엔트리 복사", exact: true });
const copyField = (page) =>
  page.getByRole("textbox", { name: "최종 엔트리 전달 문구", exact: true });

async function expectEntry(page, records) {
  await expect(
    entryTable(page).locator("tbody tr td:nth-child(2) strong"),
  ).toHaveText(records.map((record) => record.name));
}

function expectCopy(text, records) {
  expect(text).toContain("15명");
  for (const record of records) {
    expect(text).toContain(record.name);
    expect(text).toContain(record.class);
    expect(text).toContain(`레벨 ${record.level}`);
  }
  expect(text).not.toContain("경험치");
  expect(text).not.toContain("%");
}

test("manual ranks override level and XP, and equal ranks and levels ignore XP", async ({
  page,
}) => {
  const ordered = [
    member(1, { name: "수기선두", level: 1, experience: 0, manualRank: 1 }),
    member(2, { name: "수기차순", level: 2, experience: 0, manualRank: 2 }),
    member(3, { name: "동률가", level: 3, experience: 1, manualRank: 7 }),
    member(4, { name: "동률나", level: 200, experience: 99, manualRank: 7 }),
    member(5, {
      name: "미입력가",
      level: 180,
      experience: 1,
      manualRank: null,
    }),
    member(6, {
      name: "미입력나",
      level: 180,
      experience: 99,
      manualRank: null,
    }),
    ...Array.from({ length: 12 }, (_, index) =>
      member(index + 7, { level: 170 - index, manualRank: null }),
    ),
  ];
  await seed(page, { members: [...ordered].reverse(), battles: [] });
  await page.goto("/");
  await expect(page.locator(".member-table")).not.toContainText(/경험치|%/);
  await openRanking(page);
  await expect(rankingRows(page).locator(".rank-name")).toHaveText(
    ordered.map((record) => record.name),
  );
  await expect(rankingRows(page).locator(".rank-number")).toHaveText([
    "1",
    "2",
    "7",
    "7",
    ...Array(14).fill("미입력"),
  ]);
  await expect(page.locator(".ranking-table")).not.toContainText(/경험치|%/);
  await expect(page.locator(".podium-card")).toHaveCount(3);
  for (const card of await page.locator(".podium-card").all()) {
    await expect(card).not.toContainText(/경험치|%/);
  }
  await openDungeon(page);
  await expectEntry(page, ordered.slice(0, 15));
  await expect(entryTable(page)).not.toContainText(/경험치|%/);
});

test("saving and clearing a rank persists through reload and blank new members stay unranked", async ({
  page,
}) => {
  const first = member(1, { level: 80, manualRank: 10 });
  const second = member(2, { level: 120, manualRank: 20 });
  const unranked = member(3, { level: 150, manualRank: null });
  await seed(page, { members: [first, second, unranked], battles: [] });
  await page.goto("/");
  let editor = await editMember(page, first.name);
  await expect(editor.getByLabel(/^수기 순위/)).toHaveValue("10");
  await expect(editor.getByLabel(/^경험치/)).toHaveCount(0);
  await editor.getByLabel(/^수기 순위/).fill("3");
  await saveEditor(editor);
  await page.reload();
  await openRanking(page);
  await expect(rankingRows(page).locator(".rank-number")).toHaveText([
    "3",
    "20",
    "미입력",
  ]);
  expect(
    (await stored(page)).data.members.find((record) => record.id === first.id),
  ).toMatchObject({ manualRank: 3, experience: first.experience });

  editor = await editMember(page, first.name);
  await editor.getByLabel(/^수기 순위/).fill("");
  await saveEditor(editor);
  await page.reload();
  await openRanking(page);
  await expect(rankingRows(page).locator(".rank-name")).toHaveText([
    second.name,
    unranked.name,
    first.name,
  ]);
  await expect(rankingRows(page).locator(".rank-number")).toHaveText([
    "20",
    "미입력",
    "미입력",
  ]);
  expect(
    (await stored(page)).data.members.find((record) => record.id === first.id)
      .manualRank,
  ).toBeNull();

  await page.getByRole("button", { name: "혈맹원", exact: true }).click();
  await page
    .getByRole("button", { name: "혈맹원 등록", exact: true })
    .first()
    .click();
  const add = page.getByRole("dialog", { name: "혈맹원 등록", exact: true });
  await add.getByPlaceholder("캐릭터명을 입력하세요").fill("신규미입력");
  await add.getByLabel(/^레벨/).fill("199");
  await expect(add.getByLabel(/^수기 순위/)).toHaveValue("");
  await add.getByRole("button", { name: "혈맹원 등록", exact: true }).click();
  await expect(add).not.toBeVisible();
  await page.reload();
  await openRanking(page);
  await expect(rankingRows(page).locator(".rank-name")).toHaveText([
    second.name,
    "신규미입력",
    unranked.name,
    first.name,
  ]);
  expect(
    (await stored(page)).data.members.find(
      (record) => record.name === "신규미입력",
    ).manualRank,
  ).toBeNull();
});

test("final copy omits XP and a changed manual rank requires reconfirmation", async ({
  page,
}) => {
  const records = Array.from({ length: 18 }, (_, index) => member(index + 1));
  await seed(page, { members: records, battles: [] });
  await page.goto("/");
  await openDungeon(page);
  await expectEntry(page, records.slice(0, 15));
  await expect(copyButton(page)).toBeDisabled();
  await confirmButton(page).click();
  await copyButton(page).click();
  expectCopy(
    await page.evaluate(() => window.__manualEntryCopy),
    records.slice(0, 15),
  );
  const confirmed = (await stored(page)).data.finalEntry;
  await page.reload();
  await openDungeon(page);
  await expect(copyButton(page)).toBeEnabled();

  const editor = await editMember(page, records[17].name);
  await editor.getByLabel(/^수기 순위/).fill("1");
  await saveEditor(editor);
  await openDungeon(page);
  const expected = [records[0], records[17], ...records.slice(1, 14)];
  await expectEntry(page, expected);
  await expect(copyButton(page)).toBeDisabled();
  await expect(copyField(page)).toHaveValue("");
  expect((await stored(page)).data.finalEntry).toEqual(confirmed);
  await expect(confirmButton(page)).toBeEnabled();
  await confirmButton(page).click();
  await copyButton(page).click();
  const copied = await page.evaluate(() => window.__manualEntryCopy);
  expectCopy(copied, expected);
  expect(copied.match(/수기검증\d{2}/g)).toEqual(
    expected.map((record) => record.name),
  );
  expect(copied).not.toContain(records[14].name);
});

test("an XP-era final snapshot stays archived but cannot be copied until reconfirmed", async ({
  page,
}) => {
  const records = Array.from({ length: 18 }, (_, index) => member(index + 1));
  const settings = { mode: "ranking", classQuotas: {}, absentIds: [] };
  const oldFinal = {
    confirmedAt: timestamp,
    settings,
    members: records.slice(0, 15).map((record, index) => ({
      id: record.id,
      name: record.name,
      class: record.class,
      level: record.level,
      experience: record.experience,
      rank: index + 1,
    })),
  };
  await seed(page, {
    members: records,
    battles: [],
    entrySettings: settings,
    finalEntry: oldFinal,
  });
  await page.goto("/");
  await openDungeon(page);
  await expectEntry(page, records.slice(0, 15));
  await expect(copyButton(page)).toBeDisabled();
  await expect(copyField(page)).toHaveValue("");
  expect((await stored(page)).data.finalEntry).toEqual(oldFinal);
  await page.reload();
  await openDungeon(page);
  await expect(copyButton(page)).toBeDisabled();
  await confirmButton(page).click();
  await expect(copyButton(page)).toBeEnabled();
  await copyButton(page).click();
  expectCopy(
    await page.evaluate(() => window.__manualEntryCopy),
    records.slice(0, 15),
  );
  expect(
    (await stored(page)).data.finalEntry.members.map(
      (record) => record.manualRank,
    ),
  ).toEqual(Array.from({ length: 15 }, (_, index) => index + 1));
});

test("25 archived source ranks hydrate by ID while explicit null stays unranked", async ({
  page,
}, testInfo) => {
  const restored = Array.from({ length: 25 }, (_, index) => {
    const record = member(index + 1, { level: 25 - index });
    delete record.manualRank;
    return record;
  });
  const explicitNull = member(26, { level: 200, manualRank: null });
  const sourceZero = member(27, { level: 199 });
  delete sourceZero.manualRank;
  const records = [...restored, explicitNull, sourceZero];
  const sourceBackup = envelope({
    members: records.map((record, index) => ({
      id: record.id,
      nickname: index === 0 ? "원본합성명01" : record.name,
      job: record.class,
      rank: index < 25 ? 25 - index : index === 25 ? 1 : 0,
      active: true,
    })),
  });
  const data = {
    members: records,
    battles: [],
    legacyImport: {
      importedAt: timestamp,
      sourceBackup,
      defaults: { source: "synthetic-manual-ranking-browser-test" },
    },
  };
  await seed(page, data);
  await page.goto("/");
  await openRanking(page);
  await expect(rankingRows(page).locator(".rank-name")).toHaveText([
    ...restored.map((record) => record.name).reverse(),
    explicitNull.name,
    sourceZero.name,
  ]);
  await expect(rankingRows(page).locator(".rank-number")).toHaveText([
    ...Array.from({ length: 25 }, (_, index) => String(index + 1)),
    "미입력",
    "미입력",
  ]);
  expect(await stored(page)).toEqual(envelope(data));

  const editor = await editMember(page, restored[24].name);
  await expect(editor.getByLabel(/^수기 순위/)).toHaveValue("1");
  await editor.getByLabel(/^메모/).fill("수기 순위 검토 완료");
  await saveEditor(editor);
  const saved = (await stored(page)).data;
  expect(
    saved.members.filter((record) => record.manualRank !== null),
  ).toHaveLength(25);
  expect(saved.members.slice(0, 25).map((record) => record.manualRank)).toEqual(
    Array.from({ length: 25 }, (_, index) => 25 - index),
  );
  expect(
    saved.members.find((record) => record.id === explicitNull.id).manualRank,
  ).toBeNull();
  expect(
    saved.members.find((record) => record.id === sourceZero.id).manualRank,
  ).toBeNull();
  expect(saved.legacyImport.sourceBackup).toEqual(sourceBackup);

  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "자료 백업", exact: true }).click();
  const path = testInfo.outputPath("synthetic-manual-rank-backup.json");
  await (await downloading).saveAs(path);
  const backup = JSON.parse(await readFile(path, "utf8"));
  expect(backup.data.members.map((record) => record.manualRank)).toEqual(
    saved.members.map((record) => record.manualRank),
  );
  expect(backup.data.legacyImport.sourceBackup).toEqual(sourceBackup);
  await page.reload();
  await openRanking(page);
  await expect(rankingRows(page).locator(".rank-number")).toHaveText([
    ...Array.from({ length: 25 }, (_, index) => String(index + 1)),
    "미입력",
    "미입력",
  ]);
});

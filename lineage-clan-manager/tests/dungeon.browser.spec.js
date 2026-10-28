import { test, expect } from "@playwright/test";

const KEY = "lineage-clan-manager:data:v1";
const CLASSES = ["기사", "요정", "마법사"];
const members = Array.from({ length: 24 }, (_, index) => ({
  id: `entry-member-${index + 1}`,
  name: `검증${String(index + 1).padStart(2, "0")}`,
  class: CLASSES[index % CLASSES.length],
  level: 120 - index,
  experience: index / 10,
  manualRank: null,
  role: "혈맹원",
  note: "",
  createdAt: "2026-10-28T00:00:00.000Z",
  updatedAt: "2026-10-28T00:00:00.000Z",
}));
const oldBattle = {
  id: "entry-legacy-battle",
  dungeon: "이전 버전 보존 검증",
  date: "2026-10-28",
  time: "20:00",
  result: "성공",
  participantIds: [members[0].id],
  participants: [
    { id: members[0].id, name: members[0].name, class: members[0].class },
  ],
  durationMinutes: 0,
  loot: "",
  note: "기존 자료를 변경하지 않습니다.",
  createdAt: "2026-10-28T00:00:00.000Z",
  updatedAt: "2026-10-28T00:00:00.000Z",
};

async function seed(page, roster = members) {
  await page.addInitScript(
    ({ key, records, battle }) => {
      if (localStorage.getItem(key) === null) {
        localStorage.setItem(
          key,
          JSON.stringify({
            format: "lineage-clan-manager",
            version: 1,
            revision: 0,
            updatedAt: "2026-10-28T00:00:00.000Z",
            data: {
              members: records,
              battles: [battle],
              legacyMetadata: { preserved: true },
            },
          }),
        );
      }
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (value) => {
            window.__copiedEntryText = value;
          },
        },
      });
    },
    { key: KEY, records: roster, battle: oldBattle },
  );
}

async function openDungeon(page) {
  await page.goto("/");
  await page.getByRole("button", { name: "던전 전투", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "던전 전투", exact: true }),
  ).toBeVisible();
}

const entryTable = (page) =>
  page.getByRole("table", { name: "선발 엔트리", exact: true });
async function selectedNames(page) {
  return entryTable(page)
    .locator("tbody tr")
    .evaluateAll((rows) =>
      rows
        .map((row) => row.textContent.match(/검증\d{2}/)?.[0])
        .filter(Boolean),
    );
}
async function expectNames(page, names) {
  await expect.poll(() => selectedNames(page)).toEqual(names);
}
async function setClassQuotas(page) {
  await page.getByRole("radio", { name: /^클래스별 지정 인원/ }).click();
  await page
    .getByRole("spinbutton", { name: "기사 인원", exact: true })
    .fill("6");
  await page
    .getByRole("spinbutton", { name: "요정 인원", exact: true })
    .fill("5");
  await page
    .getByRole("spinbutton", { name: "마법사 인원", exact: true })
    .fill("4");
  await page
    .getByRole("button", { name: "클래스별 인원 저장", exact: true })
    .click();
}

test("ranking selects the best fifteen, excludes absentees and copies only a current confirmed entry", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await seed(page);
  await openDungeon(page);
  await expectNames(
    page,
    members.slice(0, 15).map((member) => member.name),
  );
  const confirm = page.getByRole("button", {
    name: "엔트리 확정·저장",
    exact: true,
  });
  const copy = page.getByRole("button", {
    name: "최종 엔트리 복사",
    exact: true,
  });
  await expect(copy).toBeDisabled();
  await page
    .getByRole("checkbox", { name: "검증01 불참", exact: true })
    .check();
  const expected = members.slice(1, 16).map((member) => member.name);
  await expectNames(page, expected);
  await confirm.click();
  await expect(copy).toBeEnabled();
  await copy.click();
  const copied = await page.evaluate(() => window.__copiedEntryText);
  expect(copied).toContain("15명");
  expect(copied.match(/검증\d{2}/g)).toEqual(expected);
  expect(copied).not.toContain("검증01");
  expect(copied).toContain("기사");
  expect(copied).toContain(String(members[1].level));
  expect(copied).not.toContain("경험치");
  expect(copied).not.toContain("%");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "/tmp/lineage-entry-final.png",
    fullPage: true,
  });
  await page.reload();
  await page.getByRole("button", { name: "던전 전투", exact: true }).click();
  await expect(
    page.getByRole("checkbox", { name: "검증01 불참", exact: true }),
  ).toBeChecked();
  await expectNames(page, expected);
  await expect(copy).toBeEnabled();
  await page
    .getByRole("checkbox", { name: "검증02 불참", exact: true })
    .check();
  await expectNames(
    page,
    members.slice(2, 17).map((member) => member.name),
  );
  await expect(copy).toBeDisabled();
  const data = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)).data,
    KEY,
  );
  expect(data.members).toEqual(members);
  expect(data.battles).toEqual([oldBattle]);
  expect(data.legacyMetadata).toEqual({ preserved: true });
  expect(errors).toEqual([]);
});

test("saved class quotas choose each class by rank and survive reload", async ({
  page,
}) => {
  await seed(page);
  await openDungeon(page);
  await setClassQuotas(page);
  const indices = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 15];
  const expected = indices.map((index) => members[index].name);
  await expectNames(page, expected);
  await page.reload();
  await page.getByRole("button", { name: "던전 전투", exact: true }).click();
  await expect(
    page.getByRole("spinbutton", { name: "기사 인원", exact: true }),
  ).toHaveValue("6");
  await expect(
    page.getByRole("spinbutton", { name: "요정 인원", exact: true }),
  ).toHaveValue("5");
  await expect(
    page.getByRole("spinbutton", { name: "마법사 인원", exact: true }),
  ).toHaveValue("4");
  await expectNames(page, expected);
  await page
    .getByRole("button", { name: "엔트리 확정·저장", exact: true })
    .click();
  await page
    .getByRole("button", { name: "최종 엔트리 복사", exact: true })
    .click();
  const copied = await page.evaluate(() => window.__copiedEntryText);
  expect(copied.match(/검증\d{2}/g)).toEqual(expected);
});

test("class shortages never fill the wrong class or allow an incomplete final entry", async ({
  page,
}) => {
  await seed(page);
  await openDungeon(page);
  await setClassQuotas(page);
  for (const index of [2, 5, 8, 11, 14]) {
    await page
      .getByRole("checkbox", {
        name: `${members[index].name} 불참`,
        exact: true,
      })
      .check();
  }
  await expect.poll(() => selectedNames(page)).toHaveLength(14);
  await expect(
    page.getByRole("button", { name: "엔트리 확정·저장", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "최종 엔트리 복사", exact: true }),
  ).toBeDisabled();
  const selected = await selectedNames(page);
  const chosenMembers = selected.map((name) =>
    members.find((member) => member.name === name),
  );
  expect(
    chosenMembers.filter((member) => member.class === "기사"),
  ).toHaveLength(6);
  expect(
    chosenMembers.filter((member) => member.class === "요정"),
  ).toHaveLength(5);
  expect(
    chosenMembers.filter((member) => member.class === "마법사"),
  ).toHaveLength(3);
  await expect(
    page.getByText(/마법사.*부족|부족.*마법사/).first(),
  ).toBeVisible();
});

test("fewer than fifteen eligible members cannot be confirmed as a full entry", async ({
  page,
}) => {
  await seed(page, members.slice(0, 14));
  await openDungeon(page);
  await expectNames(
    page,
    members.slice(0, 14).map((member) => member.name),
  );
  await expect(
    page.getByRole("button", { name: "엔트리 확정·저장", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "최종 엔트리 복사", exact: true }),
  ).toBeDisabled();
});

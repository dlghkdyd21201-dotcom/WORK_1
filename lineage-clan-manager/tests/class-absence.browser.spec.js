import { test, expect } from "@playwright/test";

const KEY = "lineage-clan-manager:data:v1";
const CLASSES = ["군주", "기사", "요정", "요정-똥물", "다크엘프", "마법사"];
const timestamp = "2026-10-28T00:00:00.000Z";
const members = [
  "전사",
  ...Array.from({ length: 4 }, () => CLASSES).flat(),
].map((className, index) => ({
  id: `six-class-member-${index + 1}`,
  name: `${className}검증${String(index).padStart(2, "0")}`,
  class: className,
  level: 150 - index,
  experience: index / 10,
  role: "혈맹원",
  note: "합성 브라우저 검증 자료",
  createdAt: timestamp,
  updatedAt: timestamp,
}));

async function seed(page, entrySettings) {
  await page.addInitScript(
    ({ key, records, settings, createdAt }) => {
      if (localStorage.getItem(key) === null) {
        localStorage.setItem(
          key,
          JSON.stringify({
            format: "lineage-clan-manager",
            version: 1,
            revision: 0,
            updatedAt: createdAt,
            data: {
              members: records,
              battles: [],
              legacyMetadata: { source: "six-class-browser-fixture" },
              ...(settings ? { entrySettings: settings } : {}),
            },
          }),
        );
      }
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (value) => {
            window.__copiedSixClassEntry = value;
          },
        },
      });
    },
    {
      key: KEY,
      records: members,
      settings: entrySettings,
      createdAt: timestamp,
    },
  );
}

async function openDungeon(page, reload = false) {
  if (reload) await page.reload();
  else await page.goto("/");
  await page.getByRole("button", { name: "던전 전투", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "던전 전투", exact: true }),
  ).toBeVisible();
}

const quotaInput = (page, className) =>
  page.getByRole("spinbutton", { name: `${className} 인원`, exact: true });
const absenceInput = (page) =>
  page.getByRole("textbox", { name: "불참자 아이디 입력", exact: true });
const absenceCheckbox = (page, member) =>
  page.getByRole("checkbox", { name: `${member.name} 불참`, exact: true });
const confirmButton = (page) =>
  page.getByRole("button", { name: "엔트리 확정·저장", exact: true });
const copyButton = (page) =>
  page.getByRole("button", { name: "최종 엔트리 복사", exact: true });
const entryTable = (page) =>
  page.getByRole("table", { name: "선발 엔트리", exact: true });

async function selectedNames(page) {
  return entryTable(page)
    .locator("tbody tr td:nth-child(2) strong")
    .allTextContents();
}

async function expectSelected(page, expected) {
  await expect.poll(() => selectedNames(page)).toEqual(expected);
}

async function storedData(page) {
  return page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)).data,
    KEY,
  );
}

async function submitAbsences(page, names) {
  await absenceInput(page).fill(names);
  await page
    .getByRole("button", { name: "불참자로 추가", exact: true })
    .click();
}

async function expectSixQuotaInputs(page) {
  const inputs = page.getByRole("spinbutton");
  await expect(inputs).toHaveCount(6);
  expect(
    await inputs.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("aria-label")),
    ),
  ).toEqual(CLASSES.map((className) => `${className} 인원`));
}

test("the six fixed class quotas separately select 요정 and 요정-똥물 by rank", async ({
  page,
}) => {
  await seed(page);
  await openDungeon(page);
  await page
    .getByRole("radio", { name: "클래스별 지정 인원", exact: true })
    .click();
  await expectSixQuotaInputs(page);

  const quotas = {
    군주: 2,
    기사: 3,
    요정: 4,
    "요정-똥물": 1,
    다크엘프: 2,
    마법사: 3,
  };
  for (const [className, count] of Object.entries(quotas)) {
    await quotaInput(page, className).fill(String(count));
  }
  await page
    .getByRole("button", { name: "클래스별 인원 저장", exact: true })
    .click();

  const used = {};
  const expectedMembers = members.filter((member) => {
    used[member.class] = (used[member.class] || 0) + 1;
    return used[member.class] <= (quotas[member.class] || 0);
  });
  await expectSelected(
    page,
    expectedMembers.map((member) => member.name),
  );
  const selectedClasses = await entryTable(page)
    .locator("tbody tr td:nth-child(3)")
    .allTextContents();
  for (const [className, count] of Object.entries(quotas)) {
    expect(selectedClasses.filter((value) => value === className)).toHaveLength(
      count,
    );
  }
  expect(await selectedNames(page)).not.toContain(members[0].name);
  await expect(confirmButton(page)).toBeEnabled();

  await openDungeon(page, true);
  await expectSixQuotaInputs(page);
  for (const [className, count] of Object.entries(quotas)) {
    await expect(quotaInput(page, className)).toHaveValue(String(count));
  }
  await expectSelected(
    page,
    expectedMembers.map((member) => member.name),
  );
  expect((await storedData(page)).members).toEqual(members);
});

test("typed exact IDs merge checkbox absences, report unknown IDs and invalidate the confirmed entry", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await seed(page);
  await openDungeon(page);
  await expectSelected(
    page,
    members.slice(0, 15).map((member) => member.name),
  );

  await absenceCheckbox(page, members[1]).check();
  await confirmButton(page).click();
  await expect(copyButton(page)).toBeEnabled();
  await copyButton(page).click();
  const previousCopy = await page.evaluate(() => window.__copiedSixClassEntry);
  expect(previousCopy).toContain(members[2].name);

  const unknown = "등록되지않은아이디";
  const partial = members[4].name.slice(0, -1);
  await submitAbsences(
    page,
    ` ${members[2].name}, ${members[3].name}\n${members[2].name}, ${members[1].name}\n${unknown}, ${partial}`,
  );
  const absentMembers = [members[1], members[2], members[3]];
  const expected = members
    .filter(
      (member) => !absentMembers.some((absent) => absent.id === member.id),
    )
    .slice(0, 15)
    .map((member) => member.name);
  await expectSelected(page, expected);
  for (const member of absentMembers) {
    await expect(absenceCheckbox(page, member)).toBeChecked();
  }
  await expect(absenceCheckbox(page, members[4])).not.toBeChecked();
  const feedback = page.getByRole("status").filter({ hasText: unknown });
  await expect(feedback).toBeVisible();
  await expect(feedback).toContainText(partial);
  await expect(page.locator(".entry-absence-summary")).toContainText(
    "불참 3명",
  );
  await expect(copyButton(page)).toBeDisabled();
  await expect(
    page.getByRole("textbox", { name: "최종 엔트리 전달 문구", exact: true }),
  ).toHaveValue("");
  const saved = await storedData(page);
  expect([...saved.entrySettings.absentIds].sort()).toEqual(
    absentMembers.map((member) => member.id).sort(),
  );
  expect(saved.members).toEqual(members);
  expect(saved.legacyMetadata).toEqual({ source: "six-class-browser-fixture" });

  await openDungeon(page, true);
  for (const member of absentMembers) {
    await expect(absenceCheckbox(page, member)).toBeChecked();
  }
  await expect(absenceCheckbox(page, members[4])).not.toBeChecked();
  await expectSelected(page, expected);
  await expect(copyButton(page)).toBeDisabled();

  await confirmButton(page).click();
  await copyButton(page).click();
  const copied = await page.evaluate(() => window.__copiedSixClassEntry);
  expect(copied).toContain("15명");
  for (const name of expected) expect(copied).toContain(name);
  for (const member of absentMembers) expect(copied).not.toContain(member.name);
  expect(errors).toEqual([]);
});

test("legacy unsupported quotas stay in stored data until a valid six-class replacement is saved", async ({
  page,
}) => {
  const oldSettings = {
    mode: "class",
    classQuotas: { 전사: 5, 기사: 10 },
    absentIds: [],
  };
  await seed(page, oldSettings);
  await openDungeon(page);
  await expectSixQuotaInputs(page);
  await expect(page.locator(".entry-quota-heading")).toContainText(
    "합계 10 / 15명",
  );
  await expectSelected(page, []);
  await expect(confirmButton(page)).toBeDisabled();
  await expect(copyButton(page)).toBeDisabled();
  expect((await storedData(page)).entrySettings).toEqual(oldSettings);

  await submitAbsences(page, members[3].name);
  await expect(absenceCheckbox(page, members[3])).toBeChecked();
  await expect
    .poll(async () => (await storedData(page)).entrySettings)
    .toEqual({
      ...oldSettings,
      absentIds: [members[3].id],
    });

  await openDungeon(page, true);
  await expectSixQuotaInputs(page);
  await expect(page.locator(".entry-quota-heading")).toContainText(
    "합계 10 / 15명",
  );
  await expect(absenceCheckbox(page, members[3])).toBeChecked();
  await expectSelected(page, []);
  const replacement = {
    군주: 2,
    기사: 3,
    요정: 3,
    "요정-똥물": 2,
    다크엘프: 2,
    마법사: 3,
  };
  for (const [className, count] of Object.entries(replacement)) {
    await quotaInput(page, className).fill(String(count));
  }
  await page
    .getByRole("button", { name: "클래스별 인원 저장", exact: true })
    .click();
  await expect
    .poll(async () => (await storedData(page)).entrySettings.classQuotas)
    .toEqual(replacement);
  await expect.poll(() => selectedNames(page)).toHaveLength(15);
  expect(await selectedNames(page)).not.toContain(members[0].name);
  expect(await selectedNames(page)).not.toContain(members[3].name);
  await expect(confirmButton(page)).toBeEnabled();
  expect((await storedData(page)).members).toEqual(members);
});

test("legacy ranking quotas do not prevent confirming and copying the top fifteen", async ({
  page,
}) => {
  const oldSettings = {
    mode: "ranking",
    classQuotas: { 전사: 5, 기사: 10 },
    absentIds: [],
  };
  await seed(page, oldSettings);
  await openDungeon(page);
  const expected = members.slice(0, 15).map((member) => member.name);
  await expectSelected(page, expected);
  await expect(page.getByRole("spinbutton")).toHaveCount(0);
  expect((await storedData(page)).entrySettings).toEqual(oldSettings);
  await expect(confirmButton(page)).toBeEnabled();
  await confirmButton(page).click();
  await expect(copyButton(page)).toBeEnabled();
  await copyButton(page).click();
  const copied = await page.evaluate(() => window.__copiedSixClassEntry);
  for (const name of expected) expect(copied).toContain(name);
  expect(copied).toContain("15명");
  const saved = await storedData(page);
  expect(saved.entrySettings).toEqual({
    mode: "ranking",
    classQuotas: {},
    absentIds: [],
  });
  expect(saved.finalEntry.settings).toEqual(saved.entrySettings);
  await openDungeon(page, true);
  await expectSelected(page, expected);
  await expect(copyButton(page)).toBeEnabled();
});

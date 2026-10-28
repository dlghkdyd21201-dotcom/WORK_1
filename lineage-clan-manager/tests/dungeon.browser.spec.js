import { test, expect } from "@playwright/test";

const KEY = "lineage-clan-manager:data:v1";
const member = {
  id: "dungeon-fixture-member",
  name: "기록검증기사",
  class: "기사",
  level: 80,
  experience: 12.5,
  role: "혈맹원",
  note: "",
  createdAt: "2026-10-28T00:00:00.000Z",
  updatedAt: "2026-10-28T00:00:00.000Z",
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    ({ key, fixture }) => {
      if (!localStorage.getItem(key)) {
        localStorage.setItem(
          key,
          JSON.stringify({
            format: "lineage-clan-manager",
            version: 1,
            revision: 0,
            updatedAt: "2026-10-28T00:00:00.000Z",
            data: { members: [fixture], battles: [] },
          }),
        );
      }
    },
    { key: KEY, fixture: member },
  );
});

test("battle records persist and retain participant names after a member is removed", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByRole("button", { name: "던전 전투", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "던전 전투", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "전투 기록 추가", exact: true })
    .first()
    .click();
  const editor = page.getByRole("dialog", {
    name: "새 전투 기록",
    exact: true,
  });
  await expect(editor).toBeVisible();
  await editor
    .getByPlaceholder("전투를 진행한 던전 이름")
    .fill("오만의 탑 검증");
  await editor.getByLabel("전투 날짜", { exact: true }).fill("2026-10-28");
  await editor.getByLabel("전투 시각", { exact: true }).fill("20:30");
  await editor.getByRole("checkbox", { name: /기록검증기사/ }).check();
  await editor
    .getByPlaceholder("획득한 아이템과 수량을 기록하세요.")
    .fill("검증 보상 1개");
  await editor
    .getByRole("button", { name: "전투 기록 저장", exact: true })
    .click();
  await expect(editor).not.toBeVisible();
  await expect(
    page.getByRole("heading", { name: "오만의 탑 검증", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .locator(".dungeon-participant-tags")
      .getByText("기록검증기사", { exact: true }),
  ).toBeVisible();

  await page.reload();
  await page.getByRole("button", { name: "던전 전투", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "오만의 탑 검증", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "혈맹원", exact: true }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "기록검증기사 삭제", exact: true })
    .click();
  await page.getByRole("button", { name: "던전 전투", exact: true }).click();
  await expect(
    page
      .locator(".dungeon-participant-tags")
      .getByText("기록검증기사", { exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("오만의 탑 검증 전투 기록 수정", { exact: true })
    .click();
  const edit = page.getByRole("dialog", {
    name: "전투 기록 수정",
    exact: true,
  });
  await expect(
    edit.getByRole("checkbox", { name: /기록검증기사/ }),
  ).toBeChecked();
  await expect(
    edit.getByText("기사 · 현재 명단에 없음", { exact: true }),
  ).toBeVisible();
  await edit
    .getByRole("button", { name: "전투 기록 저장", exact: true })
    .click();
  await expect(edit).not.toBeVisible();
  expect(errors).toEqual([]);
});

test("a battle requires participation and can be edited and deleted", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "던전 전투", exact: true }).click();
  await page
    .getByRole("button", { name: "전투 기록 추가", exact: true })
    .first()
    .click();
  const editor = page.getByRole("dialog", {
    name: "새 전투 기록",
    exact: true,
  });
  await editor
    .getByPlaceholder("전투를 진행한 던전 이름")
    .fill("기란 감옥 검증");
  await editor
    .getByRole("button", { name: "전투 기록 저장", exact: true })
    .click();
  await expect(editor.getByRole("alert")).toContainText("참여자");
  await editor.getByRole("checkbox", { name: /기록검증기사/ }).check();
  await editor
    .getByRole("combobox", { name: "전투 결과", exact: true })
    .selectOption("실패");
  await editor
    .getByRole("button", { name: "전투 기록 저장", exact: true })
    .click();
  await expect(editor).not.toBeVisible();
  await page
    .getByLabel("기란 감옥 검증 전투 기록 수정", { exact: true })
    .click();
  const edit = page.getByRole("dialog", {
    name: "전투 기록 수정",
    exact: true,
  });
  await edit
    .getByRole("combobox", { name: "전투 결과", exact: true })
    .selectOption("성공");
  await edit
    .getByRole("button", { name: "전투 기록 저장", exact: true })
    .click();
  await expect(edit).not.toBeVisible();
  await expect(page.locator(".dungeon-result")).toHaveText("성공");
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByLabel("기란 감옥 검증 전투 기록 삭제", { exact: true })
    .click();
  await expect(
    page.getByText("첫 번째 전투를 기록해 보세요.", { exact: true }),
  ).toBeVisible();
});

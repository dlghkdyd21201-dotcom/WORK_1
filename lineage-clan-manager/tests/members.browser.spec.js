import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

const KEY = "lineage-clan-manager:data:v1";

function member(id, name, level, experience = 0, className = "기사") {
  return {
    id,
    name,
    class: className,
    level,
    experience,
    role: "혈맹원",
    note: "",
    createdAt: "2026-10-28T00:00:00.000Z",
    updatedAt: "2026-10-28T00:00:00.000Z",
  };
}

async function seed(page, members) {
  await page.addInitScript(
    ({ key, records }) => {
      if (localStorage.getItem(key) === null) {
        localStorage.setItem(
          key,
          JSON.stringify({
            format: "lineage-clan-manager",
            version: 1,
            revision: 0,
            updatedAt: "2026-10-28T00:00:00.000Z",
            data: { members: records, battles: [] },
          }),
        );
      }
    },
    { key: KEY, records: members },
  );
}

async function addMember(page, name, level, experience = 0) {
  await page
    .getByRole("button", { name: "혈맹원 등록", exact: true })
    .first()
    .click();
  const editor = page.getByRole("dialog", { name: "혈맹원 등록", exact: true });
  await editor.getByPlaceholder("캐릭터명을 입력하세요").fill(name);
  await editor.getByLabel(/^레벨/).fill(String(level));
  await editor.getByLabel(/^경험치/).fill(String(experience));
  await editor
    .getByRole("button", { name: "혈맹원 등록", exact: true })
    .click();
  await expect(editor).not.toBeVisible();
}

test("empty app provides exactly three menus and renders at desktop and mobile sizes", async ({
  page,
}, testInfo) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "혈맹원", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "주 메뉴" }).getByRole("button"),
  ).toHaveCount(3);
  await expect(
    page.getByText("아직 등록된 혈맹원이 없습니다", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "레벨 랭킹", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "레벨 랭킹", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "던전 전투", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "던전 전투", exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "혈맹원", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "혈맹원", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "/tmp/lineage-final-mobile.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("member create, duplicate validation, edit, search and delete persist through reload", async ({
  page,
}) => {
  await page.goto("/");
  await addMember(page, "성장검증기사", 78, 42.125);
  await expect(
    page.getByRole("button", { name: "성장검증기사 수정", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "혈맹원 등록", exact: true })
    .first()
    .click();
  const duplicate = page.getByRole("dialog", {
    name: "혈맹원 등록",
    exact: true,
  });
  await duplicate
    .getByPlaceholder("캐릭터명을 입력하세요")
    .fill("성장검증기사");
  await duplicate
    .getByRole("button", { name: "혈맹원 등록", exact: true })
    .click();
  await expect(duplicate.getByRole("alert")).toContainText("이미 등록");
  await duplicate.getByRole("button", { name: "취소", exact: true }).click();

  await page
    .getByRole("button", { name: "성장검증기사 수정", exact: true })
    .click();
  const editor = page.getByRole("dialog", { name: "혈맹원 수정", exact: true });
  await editor.getByLabel(/^레벨/).fill("79");
  await editor.getByLabel(/^경험치/).fill("1.5");
  await editor.getByRole("button", { name: "수정 저장", exact: true }).click();
  await expect(editor).not.toBeVisible();
  await page.reload();
  const row = page.locator("tbody tr").filter({ hasText: "성장검증기사" });
  await expect(row).toContainText("79");
  await page
    .getByRole("textbox", { name: "혈맹원 검색", exact: true })
    .fill("존재하지않는검증인물");
  await expect(
    page.getByRole("button", { name: "성장검증기사 수정", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("textbox", { name: "혈맹원 검색", exact: true })
    .fill("성장검증");
  await expect(
    page.getByRole("button", { name: "성장검증기사 수정", exact: true }),
  ).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "성장검증기사 삭제", exact: true })
    .click();
  await page.reload();
  await expect(
    page.getByText("아직 등록된 혈맹원이 없습니다", { exact: true }),
  ).toBeVisible();
});

test("ranking reflects level and experience ties and immediately updates after editing", async ({
  page,
}, testInfo) => {
  await seed(page, [
    member("r1", "공동검증가", 90, 25),
    member("r2", "공동검증나", 90, 25),
    member("r3", "추월검증", 89, 99),
  ]);
  await page.goto("/");
  await page.getByRole("button", { name: "레벨 랭킹", exact: true }).click();
  const rows = page.locator(".ranking-table tbody tr");
  await expect(rows.locator(".rank-number")).toHaveText(["1", "1", "3"]);
  await expect(rows.locator(".rank-name")).toHaveText([
    "공동검증가",
    "공동검증나",
    "추월검증",
  ]);
  await page
    .getByRole("button", { name: "추월검증 정보 수정", exact: true })
    .click();
  const editor = page.getByRole("dialog", { name: "혈맹원 수정", exact: true });
  await editor.getByLabel(/^레벨/).fill("90");
  await editor.getByLabel(/^경험치/).fill("26");
  await editor.getByRole("button", { name: "수정 저장", exact: true }).click();
  await expect(editor).not.toBeVisible();
  await expect(rows.locator(".rank-number")).toHaveText(["1", "2", "2"]);
  await expect(rows.first().locator(".rank-name")).toHaveText("추월검증");
  await page.reload();
  await page.getByRole("button", { name: "레벨 랭킹", exact: true }).click();
  await expect(rows.first().locator(".rank-name")).toHaveText("추월검증");
  await page.screenshot({
    path: "/tmp/lineage-final-desktop.png",
    fullPage: true,
  });
});

test("backup download and restore roundtrip browser data without retaining removed edits", async ({
  page,
}, testInfo) => {
  await seed(page, [member("b1", "백업검증요정", 81, 12, "요정")]);
  await page.goto("/");
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "자료 백업", exact: true }).click();
  const file = await downloaded;
  const backupPath = testInfo.outputPath("clan-fixture-backup.json");
  await file.saveAs(backupPath);
  const snapshot = JSON.parse(await readFile(backupPath, "utf8"));
  expect(snapshot.format).toBe("lineage-clan-manager");
  expect(snapshot.data.members.map((item) => item.name)).toEqual([
    "백업검증요정",
  ]);
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "백업검증요정 삭제", exact: true })
    .click();
  await expect(
    page.getByText("아직 등록된 혈맹원이 없습니다", { exact: true }),
  ).toBeVisible();
  const chooser = page.waitForEvent("filechooser");
  await page
    .getByRole("button", { name: "백업 불러오기", exact: true })
    .click();
  page.once("dialog", (dialog) => dialog.accept());
  await (await chooser).setFiles(backupPath);
  await expect(
    page.getByRole("button", { name: "백업검증요정 수정", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "백업검증요정 수정", exact: true }),
  ).toBeVisible();
});

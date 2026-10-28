import { build } from "vite";
import {
  readFile,
  writeFile,
  mkdir,
  mkdtemp,
  rm,
  copyFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const release = path.join(root, "release");
const temporary = await mkdtemp(path.join(tmpdir(), "clan-converter-build-"));
try {
  await build({
    configFile: false,
    build: {
      lib: {
        entry: path.join(root, "tools/backup-converter/entry.js"),
        name: "ClanBackupConverter",
        formats: ["iife"],
        fileName: () => "converter.js",
      },
      outDir: path.join(temporary, "bundle"),
      minify: true,
    },
  });
  const js = await readFile(
    path.join(temporary, "bundle/converter.js"),
    "utf8",
  );
  const template = await readFile(
    path.join(root, "tools/backup-converter/template.html"),
    "utf8",
  );
  if (!template.includes("<!-- CONVERTER_BUNDLE -->"))
    throw new Error("Missing bundle slot");
  const html = template.replace(
    "<!-- CONVERTER_BUNDLE -->",
    () => `<script>${js.replace(/<\/script/gi, "<\\/script")}</script>`,
  );
  const folder = path.join(temporary, "LineageBackupConverter");
  await mkdir(folder);
  await writeFile(path.join(folder, "혈맹백업변환기.html"), html);
  await writeFile(
    path.join(folder, "사용방법.txt"),
    "1. ZIP을 압축 해제한 뒤 혈맹백업변환기.html을 엽니다.\r\n2. 원본 JSON을 선택하고 변환본 JSON 저장을 누릅니다.\r\n3. 프로그램의 백업 불러오기에서 새 JSON을 선택합니다.\r\n\r\n파일은 이 PC에서만 처리하며 서버로 전송하지 않습니다.\r\n레벨 미기재는 임시 Lv.1, 경험치 미기재는 임시0%입니다.\r\n원본 전체와 원본 순위·활동 여부는 변환본에도 보관합니다.\r\n",
  );
  await mkdir(release, { recursive: true });
  const archive = path.join(release, "LineageBackupConverter-1.0.0.zip");
  await new Promise((resolve, reject) => {
    const child = spawn(
      "zip",
      ["-q", "-r", "-FS", archive, "LineageBackupConverter"],
      { cwd: temporary, stdio: "inherit" },
    );
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`zip exited ${code}`)),
    );
  });
  await copyFile(
    path.join(folder, "혈맹백업변환기.html"),
    path.join(release, "LineageBackupConverter-1.0.0.html"),
  );
  const digest = createHash("sha256")
    .update(await readFile(archive))
    .digest("hex");
  await writeFile(
    `${archive}.sha256`,
    `${digest}  ${path.basename(archive)}\n`,
  );
  console.log(JSON.stringify({ artifact: archive, sha256: digest }));
} finally {
  await rm(temporary, { recursive: true, force: true });
}

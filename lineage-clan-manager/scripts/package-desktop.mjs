import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  access,
  cp,
  mkdir,
  mkdtemp,
  open,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const releaseRoot = path.join(root, "release");
const appName = "LineageClanManager";
const targetPlatform = "win32";
const targetArch = "x64";

async function run(command, args, options = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      shell: false,
      ...options,
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} failed (${signal || code}).`));
    });
  });
}

async function sha256(filename) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return hash.digest("hex");
}

async function assertWindowsX64(filename) {
  const file = await open(filename, "r");
  try {
    const header = Buffer.alloc(64);
    const { bytesRead } = await file.read(header, 0, header.length, 0);
    if (bytesRead !== 64 || header.toString("ascii", 0, 2) !== "MZ") {
      throw new Error("The packaged program is not a Windows executable.");
    }
    const peOffset = header.readUInt32LE(0x3c);
    if (peOffset + 6 > (await file.stat()).size)
      throw new Error("The packaged Windows PE header is invalid.");
    const signature = Buffer.alloc(6);
    await file.read(signature, 0, signature.length, peOffset);
    if (signature.toString("ascii", 0, 4) !== "PE\0\0")
      throw new Error("The packaged Windows PE header is invalid.");
    if (signature.readUInt16LE(4) !== 0x8664)
      throw new Error("The packaged executable is not for Windows x64.");
  } finally {
    await file.close();
  }
}

async function assertAppArchive(filename) {
  const { listPackage, extractFile } = await import("@electron/asar");
  const entries = listPackage(filename).map((entry) =>
    entry.replaceAll("\\", "/").replace(/^\//, ""),
  );
  for (const required of [
    "package.json",
    "dist/index.html",
    "electron/main.cjs",
    "electron/preload.cjs",
    "lib/store.cjs",
    "lib/document.cjs",
  ]) {
    if (!entries.includes(required))
      throw new Error(`The packaged app is missing ${required}.`);
  }
  if (
    entries.some((entry) =>
      /(^|\/)(?:node_modules|\.cache|\.data|\.env)(?:\/|$)/.test(entry),
    )
  )
    throw new Error(
      "Development files or user data were included in the app archive.",
    );
  const manifest = JSON.parse(
    extractFile(filename, "package.json").toString("utf8"),
  );
  if (manifest.main !== "electron/main.cjs")
    throw new Error("The packaged app entry point is invalid.");
}

async function zipFolder(folder, destination) {
  // No shell interpolation. Windows includes PowerShell; Linux/macOS use zip.
  if (process.platform === "win32") {
    await run(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Compress-Archive -LiteralPath $env:CLAN_PACKAGE_FOLDER -DestinationPath $env:CLAN_PACKAGE_ZIP -CompressionLevel Optimal",
      ],
      {
        env: {
          ...process.env,
          CLAN_PACKAGE_FOLDER: folder,
          CLAN_PACKAGE_ZIP: destination,
        },
      },
    );
  } else {
    await run("zip", ["-q", "-r", destination, path.basename(folder)], {
      cwd: path.dirname(folder),
    });
  }
}

async function main() {
  await access(path.join(root, "dist", "index.html")).catch(() => {
    throw new Error("Build the frontend first with npm run build.");
  });
  await access(path.join(root, "electron", "main.cjs"));
  const manifest = JSON.parse(
    await readFile(path.join(root, "package.json"), "utf8"),
  );
  const electronManifest = JSON.parse(
    await readFile(
      path.join(root, "node_modules", "electron", "package.json"),
      "utf8",
    ),
  );
  if (!/^\d+\.\d+\.\d+$/.test(electronManifest.version))
    throw new Error("A pinned stable Electron version is required.");
  const zipName = `${appName}-${manifest.version}-windows-x64.zip`;
  const zipPath = path.join(releaseRoot, zipName);
  const checksumPath = `${zipPath}.sha256`;
  await mkdir(releaseRoot, { recursive: true });
  // Never append into an older release archive or overwrite a completed release.
  if (await stat(zipPath).catch(() => null))
    throw new Error(`Release already exists: ${zipPath}`);
  const staging = await mkdtemp(path.join(tmpdir(), "lineage-clan-package-"));
  try {
    // Stage a small explicit allowlist. No data, .env, caches or development dependencies.
    for (const directory of ["dist", "electron", "lib"]) {
      await cp(path.join(root, directory), path.join(staging, directory), {
        recursive: true,
      });
    }
    for (const filename of ["LICENSE", "THIRD_PARTY_NOTICES.md"]) {
      if (await stat(path.join(root, filename)).catch(() => null)) {
        await cp(path.join(root, filename), path.join(staging, filename));
      }
    }
    await writeFile(
      path.join(staging, "package.json"),
      JSON.stringify(
        {
          name: manifest.name,
          productName: appName,
          author: manifest.author || manifest.productName || manifest.name,
          version: manifest.version,
          description:
            manifest.description || "혈맹원·레벨 랭킹·던전 전투 관리",
          main: "electron/main.cjs",
          private: true,
          type: manifest.type || "module",
        },
        null,
        2,
      ) + "\n",
    );
    // @electron/get honors the existing HTTPS proxy and verifies official checksums.
    // Never set rejectUnauthorized=false, disableChecksums or a replacement mirror.
    if (process.env.HTTPS_PROXY || process.env.HTTP_PROXY)
      process.env.ELECTRON_GET_USE_PROXY = "1";
    // Import after configuring proxy support: @electron/get initializes it at import time.
    const { packager } = await import("@electron/packager");
    const [folder] = await packager({
      dir: staging,
      name: appName,
      executableName: appName,
      platform: targetPlatform,
      arch: targetArch,
      electronVersion: electronManifest.version,
      appVersion: manifest.version,
      buildVersion: manifest.version,
      win32metadata: {
        ProductName: "혈맹 관리 도우미",
        FileDescription: "혈맹원·레벨 랭킹·던전 전투",
      },
      out: releaseRoot,
      overwrite: false,
      asar: true,
      prune: false,
      download: { cacheRoot: path.join(root, ".cache", "electron") },
    });
    const executable = path.join(folder, `${appName}.exe`);
    await assertWindowsX64(executable);
    await assertAppArchive(path.join(folder, "resources", "app.asar"));
    for (const required of ["LICENSE", "LICENSES.chromium.html"]) {
      await access(path.join(folder, required));
    }
    await cp(
      path.join(root, "THIRD_PARTY_NOTICES.md"),
      path.join(folder, "THIRD_PARTY_NOTICES.md"),
    );
    await writeFile(
      path.join(folder, "사용방법.txt"),
      [
        "혈맹 관리 도우미 — Windows 64비트",
        "",
        "1. ZIP 압축을 폴더 전체로 풀어 주세요.",
        "2. LineageClanManager.exe를 실행하세요.",
        "3. exe와 같은 폴더의 DLL 및 resources 폴더를 함께 보관하세요.",
        "",
        "자료는 사용자 PC의 앱 데이터 폴더에 저장됩니다.",
        "%APPDATA%\\LineageClanManager\\clan-data.json",
        "프로그램의 백업·복원 기능으로 자료를 별도 파일에 보관할 수 있습니다.",
        "이 배포본에는 기존 웹사이트의 사용자 자료나 로그인 정보가 포함되어 있지 않습니다.",
        "",
        "이 배포본은 별도 코드 서명 인증서 없이 빌드되었습니다.",
        "Linux 환경에서 Windows x64 패키지 구조와 실행 파일 헤더를 확인했습니다.",
        "Windows에서의 실제 실행 확인은 별도로 필요합니다.",
      ].join("\r\n") + "\r\n",
    );
    await zipFolder(folder, zipPath);
    const digest = await sha256(zipPath);
    await writeFile(checksumPath, `${digest}  ${zipName}\n`, { flag: "wx" });
    console.log(
      JSON.stringify(
        {
          artifact: zipPath,
          checksum: checksumPath,
          sha256: digest,
          electronVersion: electronManifest.version,
          platform: targetPlatform,
          arch: targetArch,
          bytes: (await stat(zipPath)).size,
          validation:
            "Windows PE x64 header, app.asar entry points and runtime licenses checked; Windows execution not performed",
        },
        null,
        2,
      ),
    );
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

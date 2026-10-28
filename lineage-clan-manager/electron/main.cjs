"use strict";

const {
  app,
  BrowserWindow,
  Menu,
  dialog,
  ipcMain,
  session,
  clipboard,
} = require("electron");
const path = require("node:path");
const { mkdirSync } = require("node:fs");
const { fileURLToPath } = require("node:url");
const { createStore, parseBackup, readLimited } = require("../lib/store.cjs");
const { writeClipboardText } = require("../lib/clipboard.cjs");

const TITLE = "혈맹 관리 도우미";
let startupError;
try {
  const userData = path.join(app.getPath("appData"), "LineageClanManager");
  mkdirSync(userData, { recursive: true, mode: 0o700 });
  app.setPath("userData", userData);
} catch (error) {
  startupError = error;
}
const rendererRoot = path.resolve(__dirname, "..", "dist");
const entryFile = path.join(rendererRoot, "index.html");
let mainWindow;
let store;

function developmentURL() {
  if (app.isPackaged || !process.env.CLAN_DEV_URL) return null;
  const url = new URL(process.env.CLAN_DEV_URL);
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password
  )
    throw new Error("개발 서버는 로컬 HTTP 주소만 사용할 수 있습니다.");
  return url;
}

function isRendererURL(value, devURL) {
  try {
    const url = new URL(value);
    if (devURL) return url.origin === devURL.origin;
    return url.protocol === "file:" && fileURLToPath(url) === entryFile;
  } catch {
    return false;
  }
}

function trustedSender(event, devURL) {
  if (
    !mainWindow ||
    event.sender !== mainWindow.webContents ||
    event.senderFrame !== mainWindow.webContents.mainFrame ||
    !isRendererURL(event.senderFrame.url, devURL)
  )
    throw new Error("허용되지 않는 프로그램 요청입니다.");
}

function registerHandlers(devURL) {
  function handle(channel, operation) {
    ipcMain.handle(channel, async (event, ...args) => {
      trustedSender(event, devURL);
      return operation(...args);
    });
  }
  handle("clan:load", () => store.load());
  handle("clan:save", (data, revision) => store.save(data, revision));
  handle("clan:copy-entry", (value) => writeClipboardText(clipboard, value));
  handle("clan:export-backup", async () => {
    const selected = await dialog.showSaveDialog(mainWindow, {
      title: "혈맹 자료 백업 저장",
      defaultPath: path.join(
        app.getPath("documents"),
        `혈맹관리-백업-${new Date().toISOString().slice(0, 10)}.json`,
      ),
      filters: [{ name: "혈맹 관리 JSON 백업", extensions: ["json"] }],
    });
    if (selected.canceled || !selected.filePath) return { cancelled: true };
    await store.exportBackup(selected.filePath);
    return { cancelled: false, path: selected.filePath };
  });
  handle("clan:import-backup", async (revision) => {
    const selected = await dialog.showOpenDialog(mainWindow, {
      title: "혈맹 자료 백업 불러오기",
      properties: ["openFile"],
      filters: [{ name: "혈맹 관리 JSON 백업", extensions: ["json"] }],
    });
    if (selected.canceled || !selected.filePaths[0]) return { cancelled: true };
    const source = await readLimited(selected.filePaths[0]);
    parseBackup(source);
    const confirmation = await dialog.showMessageBox(mainWindow, {
      type: "question",
      title: "백업 자료로 교체",
      message: "현재 혈맹 자료를 선택한 백업 자료로 교체할까요?",
      detail: "현재 자료를 유지하려면 취소하고 먼저 백업을 저장하세요.",
      buttons: ["취소", "자료 교체"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    if (confirmation.response !== 1) return { cancelled: true };
    const imported = await store.importBackup(source, revision);
    return { cancelled: false, ...imported };
  });
}

function configureSession(devURL) {
  session.defaultSession.setPermissionRequestHandler(
    (_contents, _permission, reply) => reply(false),
  );
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.webRequest.onBeforeRequest((request, reply) => {
    let allowed = false;
    try {
      const url = new URL(request.url);
      if (["data:", "blob:"].includes(url.protocol)) allowed = true;
      else if (devURL)
        allowed =
          url.origin === devURL.origin ||
          (url.protocol === "ws:" && url.host === devURL.host);
      else if (url.protocol === "file:") {
        const filename = fileURLToPath(url);
        allowed = filename.startsWith(`${rendererRoot}${path.sep}`);
      }
    } catch {}
    reply({ cancel: !allowed });
  });
  if (!devURL)
    session.defaultSession.webRequest.onHeadersReceived((details, reply) =>
      reply({
        responseHeaders: {
          ...details.responseHeaders,
          "Content-Security-Policy": [
            "default-src 'self' data: blob:; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'",
          ],
        },
      }),
    );
}

async function createWindow(devURL) {
  mainWindow = new BrowserWindow({
    title: TITLE,
    width: 1360,
    height: 920,
    minWidth: 960,
    minHeight: 680,
    show: false,
    backgroundColor: "#111315",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      devTools: !app.isPackaged,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, target) => {
    if (!isRendererURL(target, devURL)) event.preventDefault();
  });
  mainWindow.webContents.on("will-redirect", (event, target) => {
    if (!isRendererURL(target, devURL)) event.preventDefault();
  });
  mainWindow.webContents.on("will-attach-webview", (event) =>
    event.preventDefault(),
  );
  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.on("closed", () => {
    mainWindow = undefined;
  });
  if (devURL) await mainWindow.loadURL(devURL.href);
  else await mainWindow.loadFile(entryFile);
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
  app.whenReady().then(async () => {
    try {
      if (startupError) throw startupError;
      app.setName(TITLE);
      const devURL = developmentURL();
      store = createStore({
        filePath: path.join(app.getPath("userData"), "clan-data.json"),
      });
      await store.load();
      Menu.setApplicationMenu(null);
      configureSession(devURL);
      registerHandlers(devURL);
      await createWindow(devURL);
      app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0)
          createWindow(devURL).catch((error) => {
            dialog.showErrorBox("프로그램 시작 실패", error.message);
            app.quit();
          });
      });
    } catch (error) {
      dialog.showErrorBox(
        "프로그램 시작 실패",
        `프로그램이나 저장 자료를 열지 못했습니다. 기존 자료는 덮어쓰지 않았습니다.\n\n${error.message}`,
      );
      app.quit();
    }
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}

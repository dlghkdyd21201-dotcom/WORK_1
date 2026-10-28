"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const { pathToFileURL } = require("node:url");

async function desktopBridge(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "clan-clipboard-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filename = path.resolve(__dirname, "../electron/main.cjs");
  const requireMain = createRequire(filename);
  const handlers = new Map();
  const copies = [];
  const errors = [];
  let window;
  let ready;
  let userData;
  class BrowserWindow {
    constructor() {
      window = this;
      this.webContents = {
        mainFrame: {
          url: pathToFileURL(path.resolve(__dirname, "../dist/index.html"))
            .href,
        },
        setWindowOpenHandler() {},
        on() {},
      };
    }
    once() {}
    on() {}
    show() {}
    async loadFile() {}
  }
  const electron = {
    app: {
      isPackaged: true,
      getPath: (name) => (name === "userData" ? userData : directory),
      setPath: (_name, value) => {
        userData = value;
      },
      setName() {},
      requestSingleInstanceLock: () => true,
      on() {},
      quit() {},
      whenReady: () => ({
        then: (callback) => {
          ready = callback();
          return ready;
        },
      }),
    },
    BrowserWindow,
    Menu: { setApplicationMenu() {} },
    dialog: { showErrorBox: (...args) => errors.push(args) },
    clipboard: { writeText: (text) => copies.push(text) },
    ipcMain: { handle: (channel, callback) => handlers.set(channel, callback) },
    session: {
      defaultSession: {
        setPermissionRequestHandler() {},
        setPermissionCheckHandler() {},
        webRequest: { onBeforeRequest() {}, onHeadersReceived() {} },
      },
    },
  };
  vm.runInNewContext(
    fs.readFileSync(filename, "utf8"),
    {
      __dirname: path.dirname(filename),
      URL,
      process,
      console,
      require: (name) => (name === "electron" ? electron : requireMain(name)),
    },
    { filename },
  );
  await ready;
  assert.deepEqual(errors, []);
  return { handlers, copies, window };
}

test("the real desktop copy handler sends a confirmed entry to native clipboard", async (t) => {
  const bridge = await desktopBridge(t);
  const text =
    "던전 전투 최종 엔트리 (15명)\n" +
    Array.from(
      { length: 15 },
      (_, i) => `${i + 1}. 출전${i + 1} · 기사 · Lv.90`,
    ).join("\n");
  const event = {
    sender: bridge.window.webContents,
    senderFrame: bridge.window.webContents.mainFrame,
  };
  assert.deepEqual(await bridge.handlers.get("clan:copy-entry")(event, text), {
    copied: true,
  });
  assert.deepEqual(bridge.copies, [text]);
});

test("desktop clipboard rejects unrelated windows, subframes and invalid payloads", async (t) => {
  const bridge = await desktopBridge(t);
  const copy = bridge.handlers.get("clan:copy-entry");
  const contents = bridge.window.webContents;
  await assert.rejects(
    copy({ sender: {}, senderFrame: contents.mainFrame }, "출전 명단"),
    /허용되지/,
  );
  await assert.rejects(
    copy(
      { sender: contents, senderFrame: { url: contents.mainFrame.url } },
      "출전 명단",
    ),
    /허용되지/,
  );
  await assert.rejects(
    copy({ sender: contents, senderFrame: contents.mainFrame }, ""),
    /엔트리/,
  );
  assert.deepEqual(bridge.copies, []);
});

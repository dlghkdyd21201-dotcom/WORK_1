"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const test = require("node:test");

const entrypoint = path.resolve(__dirname, "../electron/main.cjs");
const requireFromEntrypoint = createRequire(entrypoint);

function executeBootstrap(appData) {
  const assignments = [];
  const paths = new Map([["appData", appData]]);
  const app = {
    isPackaged: true,
    getPath(name) {
      if (!paths.has(name)) throw new Error(`Unexpected path lookup: ${name}`);
      return paths.get(name);
    },
    setPath(name, value) {
      // Match Electron's native precondition: the directory must already exist.
      if (!fs.existsSync(value) || !fs.statSync(value).isDirectory()) {
        throw new Error("Failed to set path: directory does not exist");
      }
      assignments.push({ name, value });
      paths.set(name, value);
    },
    requestSingleInstanceLock() {
      return true;
    },
    on() {},
    whenReady() {
      return new Promise(() => {});
    },
    quit() {
      throw new Error("Bootstrap unexpectedly quit");
    },
  };
  const electron = {
    app,
    BrowserWindow: class {},
    Menu: {},
    dialog: {},
    ipcMain: {},
    session: {},
  };
  const context = {
    require(specifier) {
      return specifier === "electron"
        ? electron
        : requireFromEntrypoint(specifier);
    },
    __dirname: path.dirname(entrypoint),
    __filename: entrypoint,
    module: { exports: {} },
    exports: {},
    process,
    console,
    URL,
  };
  vm.runInNewContext(fs.readFileSync(entrypoint, "utf8"), context, {
    filename: entrypoint,
  });
  return { assignments, paths };
}

test("first desktop bootstrap creates its stable userData directory before Electron setPath", (t) => {
  const appData = fs.mkdtempSync(
    path.join(os.tmpdir(), "clan-bootstrap-test-"),
  );
  t.after(() => fs.rmSync(appData, { recursive: true, force: true }));
  const expected = path.join(appData, "LineageClanManager");
  assert.equal(fs.existsSync(expected), false);
  let execution;
  assert.doesNotThrow(() => {
    execution = executeBootstrap(appData);
  });
  assert.equal(fs.statSync(expected).isDirectory(), true);
  assert.deepEqual(execution.assignments, [
    { name: "userData", value: expected },
  ]);
  assert.equal(execution.paths.get("userData"), expected);
});

test("second desktop bootstrap reuses the same userData directory without changing existing records", (t) => {
  const appData = fs.mkdtempSync(
    path.join(os.tmpdir(), "clan-bootstrap-test-"),
  );
  t.after(() => fs.rmSync(appData, { recursive: true, force: true }));
  const expected = path.join(appData, "LineageClanManager");
  fs.mkdirSync(expected, { recursive: true });
  const marker = path.join(expected, "clan-data.json");
  const existing = '{"existing":"preserve-user-records"}\n';
  fs.writeFileSync(marker, existing, "utf8");
  const execution = executeBootstrap(appData);
  assert.deepEqual(execution.assignments, [
    { name: "userData", value: expected },
  ]);
  assert.equal(fs.readFileSync(marker, "utf8"), existing);
  assert.deepEqual(fs.readdirSync(expected), ["clan-data.json"]);
});

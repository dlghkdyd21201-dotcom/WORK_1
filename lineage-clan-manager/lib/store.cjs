"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { validateDocument } = require("./document.cjs");

const FORMAT = "lineage-clan-manager";
const VERSION = 1;
const MAX_DATA_BYTES = 5 * 1024 * 1024;
const MAX_FILE_BYTES = 8 * 1024 * 1024;

class StoreError extends Error {
  constructor(message, code = "INVALID_DATA") {
    super(message);
    this.name = "StoreError";
    this.code = code;
  }
}

function cloneJson(input) {
  let nodes = 0;
  function visit(value, depth) {
    if (depth > 32 || ++nodes > 100000)
      throw new StoreError("데이터 구조가 너무 큽니다.");
    if (value === null || typeof value === "boolean") return value;
    if (typeof value === "number") {
      if (!Number.isFinite(value))
        throw new StoreError("유효하지 않은 숫자가 포함되어 있습니다.");
      return value;
    }
    if (typeof value === "string") {
      if (value.length > MAX_DATA_BYTES)
        throw new StoreError("문자열 데이터가 너무 큽니다.");
      return value;
    }
    if (Array.isArray(value)) {
      if (value.length > 50000)
        throw new StoreError("목록에 데이터가 너무 많습니다.");
      return value.map((entry) => visit(entry, depth + 1));
    }
    if (
      typeof value !== "object" ||
      (Object.getPrototypeOf(value) !== Object.prototype &&
        Object.getPrototypeOf(value) !== null)
    )
      throw new StoreError("저장할 수 없는 데이터가 포함되어 있습니다.");
    const entries = Object.entries(value);
    if (entries.length > 1000)
      throw new StoreError("데이터 항목이 너무 많습니다.");
    const output = {};
    for (const [key, entry] of entries) {
      if (["__proto__", "constructor", "prototype"].includes(key))
        throw new StoreError("허용되지 않는 데이터 항목입니다.");
      output[key] = visit(entry, depth + 1);
    }
    return output;
  }
  return visit(input, 0);
}

function validateData(value) {
  const data = cloneJson(value);
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw new StoreError("프로그램 데이터 형식이 올바르지 않습니다.");
  if (!Array.isArray(data.members) || data.members.length > 5000)
    throw new StoreError("혈맹원 목록 형식이 올바르지 않습니다.");
  if (
    data.members.some(
      (member) =>
        !member || typeof member !== "object" || Array.isArray(member),
    )
  )
    throw new StoreError("혈맹원 정보 형식이 올바르지 않습니다.");
  try {
    validateDocument(data);
  } catch (error) {
    throw new StoreError(error.message);
  }
  if (Buffer.byteLength(JSON.stringify(data), "utf8") > MAX_DATA_BYTES)
    throw new StoreError("저장할 데이터가 5MB를 초과합니다.");
  return data;
}

function checkRevision(value) {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new StoreError("데이터 버전이 올바르지 않습니다.");
  return value;
}

function parseBackup(input) {
  const source = Buffer.isBuffer(input) ? input.toString("utf8") : input;
  if (typeof source !== "string" || Buffer.byteLength(source) > MAX_FILE_BYTES)
    throw new StoreError("백업 파일이 너무 크거나 형식이 올바르지 않습니다.");
  let parsed;
  try {
    parsed = JSON.parse(source.replace(/^\uFEFF/, ""));
  } catch {
    throw new StoreError("올바른 JSON 백업 파일이 아닙니다.");
  }
  if (
    !parsed ||
    parsed.format !== FORMAT ||
    parsed.version !== VERSION ||
    typeof parsed.updatedAt !== "string" ||
    !Number.isFinite(Date.parse(parsed.updatedAt))
  )
    throw new StoreError("이 프로그램에서 만든 백업 파일을 선택해 주세요.");
  return {
    format: FORMAT,
    version: VERSION,
    revision: checkRevision(parsed.revision),
    updatedAt: parsed.updatedAt,
    data: validateData(parsed.data),
  };
}

async function readLimited(filePath) {
  const file = await fs.open(filePath, "r");
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > MAX_FILE_BYTES)
      throw new StoreError("데이터 파일이 너무 크거나 올바른 파일이 아닙니다.");
    const buffer = await file.readFile();
    if (buffer.length > MAX_FILE_BYTES)
      throw new StoreError("데이터 파일이 너무 큽니다.");
    return buffer;
  } finally {
    await file.close();
  }
}

async function atomicWrite(filePath, envelope) {
  // Compact output keeps every accepted data set within the same read limit,
  // even when many deeply nested records would create excessive indentation.
  const contents = `${JSON.stringify(envelope)}\n`;
  if (Buffer.byteLength(contents, "utf8") > MAX_FILE_BYTES)
    throw new StoreError("저장할 파일이 너무 큽니다.");
  const destination = path.resolve(filePath);
  const directory = path.dirname(destination);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = path.join(directory, `.clan-${randomUUID()}.tmp`);
  let file;
  try {
    file = await fs.open(temporary, "wx", 0o600);
    await file.writeFile(contents, "utf8");
    await file.sync();
    await file.close();
    file = undefined;
    await fs.rename(temporary, destination);
  } finally {
    if (file) await file.close().catch(() => {});
    await fs.unlink(temporary).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}

function toEnvelope(data, revision) {
  return {
    format: FORMAT,
    version: VERSION,
    revision,
    updatedAt: new Date().toISOString(),
    data,
  };
}

function publicSnapshot(envelope) {
  return { data: cloneJson(envelope.data), revision: envelope.revision };
}

async function writeBackup(filePath, input) {
  // Validate the complete envelope before creating or replacing a selected file.
  const checked = parseBackup(JSON.stringify(input));
  await atomicWrite(filePath, checked);
}

function createStore({ filePath }) {
  if (typeof filePath !== "string" || !filePath)
    throw new TypeError("A data file path is required.");
  const filename = path.resolve(filePath);
  let queue = Promise.resolve();
  function serialized(operation) {
    const pending = queue.then(operation);
    queue = pending.catch(() => {});
    return pending;
  }
  async function readCurrent() {
    try {
      return parseBackup(await readLimited(filename));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      const initial = toEnvelope({ members: [] }, 0);
      await atomicWrite(filename, initial);
      return initial;
    }
  }
  async function replaceData(data, expectedRevision) {
    checkRevision(expectedRevision);
    const checked = validateData(data);
    const current = await readCurrent();
    if (current.revision !== expectedRevision)
      throw new StoreError(
        "자료가 먼저 변경되었습니다. 최신 자료를 다시 불러온 뒤 저장해 주세요.",
        "REVISION_CONFLICT",
      );
    if (current.revision >= Number.MAX_SAFE_INTEGER)
      throw new StoreError("데이터 버전을 더 올릴 수 없습니다.");
    const next = toEnvelope(checked, current.revision + 1);
    await atomicWrite(filename, next);
    return publicSnapshot(next);
  }
  return {
    load() {
      return serialized(async () => publicSnapshot(await readCurrent()));
    },
    save(data, expectedRevision) {
      return serialized(() => replaceData(data, expectedRevision));
    },
    importBackup(backup, expectedRevision) {
      return serialized(() =>
        replaceData(parseBackup(backup).data, expectedRevision),
      );
    },
    exportBackup(destination) {
      return serialized(async () => {
        if (path.resolve(destination) === filename)
          throw new StoreError(
            "사용 중인 데이터 파일과 다른 백업 위치를 선택해 주세요.",
          );
        await writeBackup(destination, await readCurrent());
      });
    },
  };
}

module.exports = {
  FORMAT,
  VERSION,
  MAX_FILE_BYTES,
  StoreError,
  createStore,
  validateData,
  parseBackup,
  readLimited,
  writeBackup,
};

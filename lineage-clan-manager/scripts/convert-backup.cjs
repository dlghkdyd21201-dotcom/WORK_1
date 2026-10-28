#!/usr/bin/env node
"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { convertBackup } = require("../lib/legacy-backup.cjs");
const { parseBackup, readLimited, writeBackup } = require("../lib/store.cjs");

async function main(args) {
  const keepOriginalClass = args.includes("--keep-original-class");
  const paths = args.filter((arg) => arg !== "--keep-original-class");
  if (paths.length !== 2 || paths.some((arg) => arg.startsWith("--")))
    throw new Error(
      "사용법: node scripts/convert-backup.cjs 원본.json 새백업.json [--keep-original-class]",
    );
  const input = path.resolve(paths[0]);
  const output = path.resolve(paths[1]);
  if (input === output)
    throw new Error("원본과 다른 새 출력 파일을 지정해 주세요.");
  try {
    await fs.lstat(output);
    throw new Error(
      "출력 파일이 이미 있습니다. 다른 새 파일명을 지정해 주세요.",
    );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  let source;
  try {
    source = JSON.parse(
      (await readLimited(input)).toString("utf8").replace(/^\uFEFF/, ""),
    );
  } catch (error) {
    if (error instanceof SyntaxError)
      throw new Error("올바른 JSON 백업 파일이 아닙니다.");
    throw error;
  }
  const { backup, report } = convertBackup(source, {
    normalizeFairyClass: !keepOriginalClass,
  });
  const checked = parseBackup(JSON.stringify(backup));
  const staging = path.join(
    path.dirname(output),
    `.backup-conversion-${randomUUID()}.json`,
  );
  try {
    await writeBackup(staging, checked);
    // Linking a validated staging file creates the destination exclusively.
    // A file appearing during conversion is never overwritten.
    await fs.link(staging, output);
  } catch (error) {
    if (error.code === "EEXIST")
      throw new Error(
        "출력 파일이 이미 있습니다. 다른 새 파일명을 지정해 주세요.",
      );
    throw error;
  } finally {
    await fs.unlink(staging).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
  return report;
}

if (require.main === module) {
  main(process.argv.slice(2))
    .then((report) => {
      process.stdout.write(`${JSON.stringify(report)}\n`);
    })
    .catch((error) => {
      // Validation messages contain no member names or source JSON. Avoid printing
      // native filesystem errors, which can include user-selected private paths.
      process.stderr.write(
        `${error.code ? "파일을 읽거나 저장하지 못했습니다." : error.message}\n`,
      );
      process.exitCode = 1;
    });
}

module.exports = { main };

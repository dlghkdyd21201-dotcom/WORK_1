"use strict";

const { validateDocument } = require("./document.cjs");
const { hydrateManualRanks } = require("./manual-ranking.cjs");

const FORMAT = "lineage-clan-manager";
const MAX_DATA_BYTES = 5 * 1024 * 1024;
const MAX_FILE_BYTES = 8 * 1024 * 1024;

function reject(message) {
  throw new Error(message);
}

// Keep this module usable in an offline browser as well as in the CLI.
// Reject non-JSON values instead of silently losing them while archiving.
function copyJson(input) {
  let nodes = 0;
  function visit(value, depth) {
    if (depth > 32 || ++nodes > 100000)
      reject("백업 데이터 구조가 너무 큽니다.");
    if (value === null || typeof value === "boolean") return value;
    if (typeof value === "number") {
      if (!Number.isFinite(value))
        reject("유효하지 않은 숫자가 포함되어 있습니다.");
      return value;
    }
    if (typeof value === "string") {
      if (value.length > MAX_DATA_BYTES) reject("문자열 데이터가 너무 큽니다.");
      return value;
    }
    if (Array.isArray(value)) {
      if (value.length > 50000) reject("목록에 데이터가 너무 많습니다.");
      return value.map((entry) => visit(entry, depth + 1));
    }
    if (
      !value ||
      typeof value !== "object" ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    )
      reject("JSON으로 보존할 수 없는 데이터가 포함되어 있습니다.");
    const entries = Object.entries(value);
    if (entries.length > 1000) reject("데이터 항목이 너무 많습니다.");
    const output = {};
    for (const [key, entry] of entries) {
      if (["__proto__", "constructor", "prototype"].includes(key))
        reject("허용되지 않는 데이터 항목입니다.");
      output[key] = visit(entry, depth + 1);
    }
    return output;
  }
  return visit(input, 0);
}

function checkSize(backup) {
  const encoder = new TextEncoder();
  if (encoder.encode(JSON.stringify(backup.data)).length > MAX_DATA_BYTES)
    reject("원본 보관 자료를 포함한 데이터가 5MB를 초과합니다.");
  if (encoder.encode(JSON.stringify(backup)).length > MAX_FILE_BYTES)
    reject("백업 파일이 8MB를 초과합니다.");
}

function checkEnvelope(source) {
  if (
    !source ||
    typeof source !== "object" ||
    Array.isArray(source) ||
    source.format !== FORMAT ||
    source.version !== 1 ||
    !Number.isSafeInteger(source.revision) ||
    source.revision < 0 ||
    typeof source.updatedAt !== "string" ||
    !Number.isFinite(Date.parse(source.updatedAt)) ||
    !source.data ||
    typeof source.data !== "object" ||
    Array.isArray(source.data) ||
    !Array.isArray(source.data.members) ||
    source.data.members.length > 5000
  )
    reject("지원하는 혈맹 관리 백업 형식이 아닙니다.");
}

function emptyReport(kind, count) {
  return {
    kind,
    members: count,
    missingLevels: 0,
    missingExperience: 0,
    renamedClasses: 0,
    inactiveMembers: 0,
  };
}

function convertBackup(source, { normalizeFairyClass = true } = {}) {
  if (typeof normalizeFairyClass !== "boolean")
    reject("클래스 표기 변경 옵션은 참 또는 거짓이어야 합니다.");
  const original = copyJson(source);
  checkEnvelope(original);

  // A valid native backup is already compatible. In particular, do not wrap
  // an earlier legacyImport archive in another copy on repeated conversion.
  try {
    validateDocument(original.data);
    const report = emptyReport("native", original.data.members.length);
    if (original.data.legacyImport?.sourceBackup) {
      const hydrated = hydrateManualRanks(original.data);
      original.data = hydrated.data;
      if (hydrated.restoredCount > 0)
        report.manualRanks = hydrated.restoredCount;
    }
    checkSize(original);
    return {
      backup: original,
      report,
    };
  } catch (error) {
    const legacy =
      original.data.members.length > 0 &&
      original.data.members.every(
        (member) =>
          member &&
          typeof member === "object" &&
          !Array.isArray(member) &&
          Object.hasOwn(member, "nickname") &&
          Object.hasOwn(member, "job"),
      );
    if (!legacy) throw error;
  }

  const report = emptyReport("legacy", original.data.members.length);
  const members = original.data.members.map((member) => {
    const missingLevel = member.level == null;
    const missingExperience = member.experience == null;
    const renameClass = normalizeFairyClass && member.job === "요정-똥";
    const note = [];
    if (missingLevel) {
      report.missingLevels++;
      note.push("원본 레벨 미기재(임시 Lv.1, 수정 필요)");
    }
    if (missingExperience) {
      report.missingExperience++;
      note.push("경험치 미기재(임시0%)");
    }
    if (renameClass) {
      report.renamedClasses++;
      note.push("클래스 표기 변경: 요정-똥 → 요정-똥물");
    }
    if (member.rank != null) {
      if (
        !Number.isInteger(member.rank) ||
        member.rank < 0 ||
        member.rank > 5000
      )
        reject("원본 순위는 0~5,000 사이의 정수여야 합니다.");
      note.push(`원본 순위: ${member.rank} (혈맹 직위 아님)`);
    }
    if (member.active != null) {
      if (![true, false, 0, 1].includes(member.active))
        reject("원본 활동 상태는 참·거짓 또는 0·1이어야 합니다.");
      const active = member.active === true || member.active === 1;
      if (!active) report.inactiveMembers++;
      note.push(
        `원본 활동 상태: ${active ? "활동" : "비활동"}(active=${member.active})`,
      );
    }
    if (member.joined != null) {
      if (typeof member.joined !== "string" || member.joined.length > 100)
        reject("원본 가입일 형식을 확인해 주세요.");
      if (member.joined.trim()) note.push(`원본 가입일: ${member.joined}`);
    }
    return {
      id: member.id,
      name: member.nickname,
      class: renameClass ? "요정-똥물" : member.job,
      level: missingLevel ? 1 : member.level,
      experience: missingExperience ? 0 : member.experience,
      manualRank: member.rank == null || member.rank === 0 ? null : member.rank,
      role: "미기록",
      note: note.join("\n"),
    };
  });
  const importedAt = new Date().toISOString();
  const backup = {
    format: FORMAT,
    version: 1,
    revision: 0,
    updatedAt: importedAt,
    data: {
      members,
      legacyImport: {
        sourceBackup: original,
        importedAt,
        defaults: {
          level: {
            value: 1,
            count: report.missingLevels,
            requiresReview: true,
            reason: "원본 레벨 미기재(임시 Lv.1, 수정 필요)",
          },
          experience: {
            value: 0,
            count: report.missingExperience,
            requiresReview: true,
            reason: "경험치 미기재(임시0%)",
          },
          role: {
            value: "미기록",
            reason: "원본 rank는 순위이며 혈맹 직위가 아님",
          },
          normalizeFairyClass,
        },
      },
    },
  };
  validateDocument(backup.data);
  copyJson(backup.data);
  checkSize(backup);
  return { backup, report };
}

module.exports = { convertBackup };

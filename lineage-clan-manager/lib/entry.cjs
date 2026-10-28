"use strict";

const ENTRY_SIZE = 15;
const ENTRY_CLASSES = Object.freeze([
  "군주",
  "기사",
  "요정",
  "요정-똥물",
  "다크엘프",
  "마법사",
]);

function reject(message) {
  throw new Error(message);
}

function record(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    reject(`${label} 형식이 올바르지 않습니다.`);
}

function text(value, label, max) {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    reject(`${label} 값을 확인해 주세요.`);
}

function identifier(value) {
  text(value, "엔트리 혈맹원 ID", 100);
  if (value !== value.trim())
    reject("엔트리 혈맹원 ID 앞뒤에 공백을 넣을 수 없습니다.");
}

// Validate without normalizing: persisted settings must round-trip unchanged.
function validateEntrySettings(settings) {
  record(settings, "엔트리 설정");
  if (!["ranking", "class"].includes(settings.mode))
    reject("엔트리 선발 방식을 확인해 주세요.");
  record(settings.classQuotas, "클래스별 정원");
  let total = 0;
  for (const [className, quota] of Object.entries(settings.classQuotas)) {
    text(className, "정원 클래스", 40);
    if (!Number.isInteger(quota) || quota < 0 || quota > ENTRY_SIZE)
      reject("클래스별 정원은 0~15 사이의 정수여야 합니다.");
    total += quota;
  }
  if ((settings.mode === "class" || total > 0) && total !== ENTRY_SIZE)
    reject("클래스별 정원의 합계는 정확히 15명이어야 합니다.");
  if (!Array.isArray(settings.absentIds) || settings.absentIds.length > 5000)
    reject("불참자 목록을 확인해 주세요.");
  const absentIds = new Set();
  for (const id of settings.absentIds) {
    identifier(id);
    if (absentIds.has(id)) reject("불참자 ID가 중복되었습니다.");
    absentIds.add(id);
  }
  return settings;
}

function validateEntryMember(member) {
  record(member, "엔트리 혈맹원");
  identifier(member.id);
  text(member.name, "엔트리 캐릭터 이름", 40);
  text(member.class, "엔트리 클래스", 40);
  if (!Number.isInteger(member.level) || member.level < 1 || member.level > 200)
    reject("엔트리 레벨은 1~200 사이의 정수여야 합니다.");
  if (
    !Number.isFinite(member.experience) ||
    member.experience < 0 ||
    member.experience > 100
  )
    reject("엔트리 경험치는 0~100% 사이의 숫자여야 합니다.");
}

function comparableName(name) {
  return name.trim().normalize("NFC").toLocaleLowerCase("ko");
}

function resolveAbsentNames(members, input) {
  if (typeof input !== "string")
    reject("불참자 이름은 쉼표나 줄바꿈으로 구분한 문자열이어야 합니다.");
  if (input.length > 10000)
    reject("불참자 이름 입력은 10,000자 이하여야 합니다.");
  if (!Array.isArray(members) || members.length > 5000)
    reject("불참자 확인용 혈맹원 목록을 확인해 주세요.");

  const names = input
    .split(/[,;\r\n]/)
    .map((name) => name.trim())
    .filter(Boolean);
  if (names.length > 5000)
    reject("불참자 이름은 한 번에 5,000개까지 입력할 수 있습니다.");

  const membersByName = new Map();
  for (const member of members) {
    record(member, "불참자 확인용 혈맹원");
    text(member.name, "불참자 확인용 캐릭터 이름", 40);
    membersByName.set(comparableName(member.name), member);
  }

  const matchedMembers = [];
  const unmatchedNames = [];
  const duplicateNames = [];
  const seenNames = new Set();
  const duplicateKeys = new Set();
  for (const name of names) {
    const key = comparableName(name);
    if (seenNames.has(key)) {
      if (!duplicateKeys.has(key)) {
        duplicateNames.push(name);
        duplicateKeys.add(key);
      }
      continue;
    }
    seenNames.add(key);
    const member = membersByName.get(key);
    if (member) matchedMembers.push(member);
    else unmatchedNames.push(name);
  }
  return { matchedMembers, unmatchedNames, duplicateNames };
}

function rankedMembers(members) {
  if (!Array.isArray(members) || members.length > 5000)
    reject("엔트리 혈맹원 목록을 확인해 주세요.");
  const ids = new Set();
  for (const member of members) {
    validateEntryMember(member);
    if (ids.has(member.id)) reject("엔트리 혈맹원 ID가 중복되었습니다.");
    ids.add(member.id);
  }
  const sorted = [...members].sort(
    (a, b) =>
      b.level - a.level ||
      b.experience - a.experience ||
      a.name.localeCompare(b.name, "ko") ||
      a.id.localeCompare(b.id),
  );
  let rank = 0;
  return sorted.map((member, index) => {
    const previous = sorted[index - 1];
    if (
      !previous ||
      previous.level !== member.level ||
      previous.experience !== member.experience
    )
      rank = index + 1;
    return { ...member, rank };
  });
}

function selectEntry(members, settings) {
  validateEntrySettings(settings);
  // Rank the whole roster first so absences do not change displayed global ranks.
  const ranked = rankedMembers(members);
  const absentIds = new Set(settings.absentIds);
  const eligible = ranked.filter((member) => !absentIds.has(member.id));
  const excludedCount = ranked.length - eligible.length;
  if (settings.mode === "ranking") {
    const selected = eligible.slice(0, ENTRY_SIZE);
    return {
      members: selected,
      shortages: [],
      vacancies: ENTRY_SIZE - selected.length,
      excludedCount,
    };
  }

  const selectedIds = new Set();
  const shortages = [];
  for (const [className, required] of Object.entries(settings.classQuotas)) {
    if (required === 0) continue;
    const candidates = eligible.filter((member) => member.class === className);
    for (const member of candidates.slice(0, required))
      selectedIds.add(member.id);
    if (candidates.length < required)
      shortages.push({
        class: className,
        required,
        available: candidates.length,
        missing: required - candidates.length,
      });
  }
  // Keep the complete selection in the same deterministic global ranking order.
  const selected = eligible.filter((member) => selectedIds.has(member.id));
  return {
    members: selected,
    shortages,
    vacancies: ENTRY_SIZE - selected.length,
    excludedCount,
  };
}

function formatEntryText(members) {
  if (!Array.isArray(members) || members.length !== ENTRY_SIZE)
    reject("최종 엔트리는 정확히 15명이어야 복사할 수 있습니다.");
  const ids = new Set();
  const lines = members.map((member, index) => {
    validateEntryMember(member);
    if (ids.has(member.id))
      reject("최종 엔트리에 같은 혈맹원이 중복되었습니다.");
    ids.add(member.id);
    const name = member.name.replace(/[\r\n\t]+/g, " ");
    const className = member.class.replace(/[\r\n\t]+/g, " ");
    return `${index + 1}. ${name} / ${className} / 레벨 ${member.level} / 경험치 ${member.experience}%`;
  });
  return ["[던전 최종 엔트리 15명]", ...lines].join("\n");
}

module.exports = {
  ENTRY_SIZE,
  ENTRY_CLASSES,
  resolveAbsentNames,
  selectEntry,
  formatEntryText,
  validateEntrySettings,
  validateEntryMember,
};

import manualRanking from "../lib/manual-ranking.cjs";

export const hydrateManualRanks = manualRanking.hydrateManualRanks;

export const CLASSES = [
  "군주",
  "기사",
  "요정",
  "요정-똥물",
  "다크엘프",
  "마법사",
  "용기사",
  "환술사",
  "전사",
  "검사",
  "창기사",
  "성기사",
  "기타",
];

function text(value, label, max, required = false) {
  if (
    typeof value !== "string" ||
    value.length > max ||
    (required && !value.trim())
  ) {
    throw new Error(
      `${label} 값을 확인해 주세요.${required ? " 비워 둘 수 없습니다." : ""}`,
    );
  }
  return value.trim();
}

function identifier(value) {
  return text(value, "기록 ID", 100, true);
}
function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || ""))
    throw new Error("날짜를 확인해 주세요.");
  const parsed = new Date(`${value}T12:00:00Z`);
  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  )
    throw new Error("유효한 날짜를 입력해 주세요.");
  return value;
}

export function today() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function validateMember(candidate, members = [], ignoreId = null) {
  if (!candidate || typeof candidate !== "object")
    throw new Error("혈맹원 자료를 확인해 주세요.");
  const id = identifier(candidate.id);
  const name = text(candidate.name, "캐릭터 이름", 40, true);
  const comparable = name.normalize("NFC").toLocaleLowerCase("ko");
  if (
    members.some(
      (member) =>
        member.id !== ignoreId &&
        member.name.normalize("NFC").trim().toLocaleLowerCase("ko") ===
          comparable,
    )
  ) {
    throw new Error("같은 이름의 혈맹원이 이미 등록되어 있습니다.");
  }
  const level = candidate.level;
  if (!Number.isInteger(level) || level < 1 || level > 200)
    throw new Error("레벨은 1~200 사이의 정수로 입력해 주세요.");
  const manualRank = manualRanking.normalizeManualRank(candidate.manualRank);
  const experience = candidate.experience;
  if (
    experience !== undefined &&
    (!Number.isFinite(experience) || experience < 0 || experience > 100)
  )
    throw new Error("보관된 경험치 자료를 확인해 주세요.");
  const now = new Date().toISOString();
  return {
    id,
    name,
    class: text(candidate.class, "클래스", 40, true),
    level,
    manualRank,
    ...(experience !== undefined ? { experience } : {}),
    role: text(candidate.role || "일반", "혈맹 직위", 30, true),
    note: text(candidate.note || "", "메모", 2000),
    createdAt: candidate.createdAt || now,
    updatedAt: now,
  };
}

export function rankMembers(members) {
  return manualRanking.rankMembers(members);
}

export function validateBattle(candidate, members = []) {
  if (!candidate || typeof candidate !== "object")
    throw new Error("전투 기록을 확인해 주세요.");
  const id = identifier(candidate.id);
  const dungeon = text(candidate.dungeon, "던전 이름", 100, true);
  const date = validDate(candidate.date);
  const time = candidate.time || "";
  if (
    typeof time !== "string" ||
    (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time))
  )
    throw new Error("전투 시간을 확인해 주세요.");
  if (!["성공", "실패", "중단"].includes(candidate.result))
    throw new Error("전투 결과를 선택해 주세요.");
  if (
    !Array.isArray(candidate.participantIds) ||
    candidate.participantIds.length < 1 ||
    candidate.participantIds.length > 1000 ||
    new Set(candidate.participantIds).size !== candidate.participantIds.length
  ) {
    throw new Error(
      "참여자를 한 명 이상 선택해 주세요. 중복 참여자는 등록할 수 없습니다.",
    );
  }
  const snapshots = Array.isArray(candidate.participants)
    ? candidate.participants
    : [];
  const participants = candidate.participantIds.map((rawId) => {
    const memberId = identifier(rawId);
    const source =
      members.find((member) => member.id === memberId) ||
      snapshots.find((member) => member.id === memberId);
    if (!source)
      throw new Error(
        "참여자 정보를 찾을 수 없습니다. 참여 명단을 다시 확인해 주세요.",
      );
    return {
      id: memberId,
      name: text(source.name, "참여자 이름", 40, true),
      class: text(source.class || "기타", "클래스", 40, true),
    };
  });
  const durationMinutes =
    candidate.durationMinutes === "" || candidate.durationMinutes === undefined
      ? 0
      : Number(candidate.durationMinutes);
  if (
    !Number.isInteger(durationMinutes) ||
    durationMinutes < 0 ||
    durationMinutes > 10080
  )
    throw new Error("전투 시간은 0~10,080분 사이의 정수로 입력해 주세요.");
  const now = new Date().toISOString();
  return {
    id,
    dungeon,
    date,
    time,
    result: candidate.result,
    participantIds: participants.map((member) => member.id),
    participants,
    durationMinutes,
    loot: text(candidate.loot || "", "보상·획득 아이템", 2000),
    note: text(candidate.note || "", "전투 메모", 5000),
    createdAt: candidate.createdAt || now,
    updatedAt: now,
  };
}

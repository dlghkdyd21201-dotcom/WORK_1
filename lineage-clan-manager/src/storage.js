import documentValidator from "../lib/document.cjs";

const KEY = "lineage-clan-manager:data:v1";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function validateData(data) {
  if (
    !data ||
    typeof data !== "object" ||
    Array.isArray(data) ||
    !Array.isArray(data.members)
  ) {
    throw new Error("혈맹 자료 형식을 확인해 주세요.");
  }
  if (new TextEncoder().encode(JSON.stringify(data)).length > 5 * 1024 * 1024) {
    throw new Error("자료 크기가 너무 큽니다.");
  }
  documentValidator.validateDocument(data);
  return clone(data);
}

function browserLoad() {
  const raw = localStorage.getItem(KEY);
  if (raw === null) return { data: { members: [] }, revision: 0 };
  let stored;
  try {
    stored = JSON.parse(raw);
  } catch {
    throw new Error(
      "저장된 자료를 읽을 수 없습니다. 기존 자료를 덮어쓰지 않았습니다. 백업 파일을 확인해 주세요.",
    );
  }
  if (
    stored.format !== "lineage-clan-manager" ||
    stored.version !== 1 ||
    !Number.isSafeInteger(stored.revision) ||
    stored.revision < 0
  ) {
    throw new Error("저장된 자료 버전을 지원하지 않습니다.");
  }
  return { data: validateData(stored.data), revision: stored.revision };
}

function browserSave(data, expectedRevision) {
  const current = browserLoad();
  if (expectedRevision !== current.revision)
    throw new Error(
      "다른 창에서 자료가 변경됐습니다. 최신 자료를 다시 불러오세요.",
    );
  const envelope = {
    format: "lineage-clan-manager",
    version: 1,
    revision: current.revision + 1,
    updatedAt: new Date().toISOString(),
    data: validateData(data),
  };
  localStorage.setItem(KEY, JSON.stringify(envelope));
  return { data: envelope.data, revision: envelope.revision };
}

const browserStorage = {
  async load() {
    return browserLoad();
  },
  async save(data, expectedRevision) {
    return browserSave(data, expectedRevision);
  },
  async exportBackup() {
    const current = browserLoad();
    const content = {
      format: "lineage-clan-manager",
      version: 1,
      revision: current.revision,
      updatedAt: new Date().toISOString(),
      data: current.data,
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(content, null, 2)], {
        type: "application/json",
      }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `혈맹자료-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return { cancelled: false };
  },
  async importBackup(expectedRevision) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    return new Promise((resolve, reject) => {
      input.addEventListener("cancel", () => resolve({ cancelled: true }), {
        once: true,
      });
      input.addEventListener(
        "change",
        async () => {
          const file = input.files?.[0];
          if (!file) {
            resolve({ cancelled: true });
            return;
          }
          try {
            if (file.size > 8 * 1024 * 1024)
              throw new Error("백업 파일 크기가 너무 큽니다.");
            const parsed = JSON.parse(
              (await file.text()).replace(/^\uFEFF/, ""),
            );
            if (
              parsed.format !== "lineage-clan-manager" ||
              parsed.version !== 1 ||
              !Number.isSafeInteger(parsed.revision) ||
              parsed.revision < 0 ||
              typeof parsed.updatedAt !== "string" ||
              !Number.isFinite(Date.parse(parsed.updatedAt))
            )
              throw new Error("이 프로그램의 백업 파일이 아닙니다.");
            const data = validateData(parsed.data);
            if (
              !window.confirm(
                "백업 자료로 현재 자료를 교체할까요? 필요하면 먼저 현재 자료를 백업하세요.",
              )
            ) {
              resolve({ cancelled: true });
              return;
            }
            resolve({
              cancelled: false,
              ...browserSave(data, expectedRevision),
            });
          } catch (error) {
            reject(error);
          }
        },
        { once: true },
      );
      input.click();
    });
  },
};

export const storage = window.clanDesktop || browserStorage;
export const isDesktop = Boolean(window.clanDesktop);

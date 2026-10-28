export async function copyEntryText(value) {
  if (typeof value !== "string" || !value.trim() || value.length > 20000) {
    throw new Error("복사할 엔트리 내용을 확인해 주세요.");
  }
  if (typeof window.clanDesktop?.copyText === "function") {
    const result = await window.clanDesktop.copyText(value);
    if (!result?.copied) throw new Error("엔트리를 복사하지 못했습니다.");
    return result;
  }
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return { copied: true };
    } catch {
      /* Use the user-initiated text selection fallback below. */
    }
  }
  const previous = document.activeElement;
  const field = document.createElement("textarea");
  field.value = value;
  field.readOnly = true;
  field.style.position = "fixed";
  field.style.left = "-9999px";
  field.setAttribute("aria-label", "복사할 최종 엔트리");
  document.body.appendChild(field);
  try {
    field.focus();
    field.select();
    if (!document.execCommand("copy"))
      throw new Error(
        "자동 복사에 실패했습니다. 화면의 엔트리 내용을 선택해 복사해 주세요.",
      );
    return { copied: true };
  } finally {
    field.remove();
    previous?.focus?.();
  }
}

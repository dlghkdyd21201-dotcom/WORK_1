"use strict";

function writeClipboardText(clipboard, value) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > 20000 ||
    value.includes("\u0000")
  ) {
    throw new Error("복사할 엔트리 내용을 확인해 주세요.");
  }
  clipboard.writeText(value);
  return { copied: true };
}

module.exports = { writeClipboardText };

/**
 * X display-name newline tool
 * Replaces only \r\n and \n with U+2028 (LSEP).
 * All other characters (including emoji grapheme clusters) are kept intact.
 */

const LSEP = "\u2028";

/** @param {string} text */
function convertNewlinesToLsep(text) {
  // Only transform actual newline sequences. Never touch other code points.
  // Order matters: \r\n first, then lone \n, then lone \r (for completeness).
  return text.replace(/\r\n/g, LSEP).replace(/\n/g, LSEP).replace(/\r/g, LSEP);
}

/** Preview: show LSEP as real visual line breaks (display only). */
function lsepToDisplayNewlines(text) {
  return text.replace(/\u2028/g, "\n");
}

/** Debug / success-check helper: list code points around LSEP. */
function summarizeCodePoints(text) {
  if (!text) return "";
  const points = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp === 0x2028) {
      points.push("U+2028(LSEP)");
    } else if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0)) {
      points.push("U+" + cp.toString(16).toUpperCase().padStart(4, "0"));
    } else {
      points.push(ch + "(U+" + cp.toString(16).toUpperCase().padStart(4, "0") + ")");
    }
  }
  return points.join(" ");
}

function initUi() {
  const inputEl = document.getElementById("input");
  const resultEl = document.getElementById("result");
  const previewEl = document.getElementById("preview");
  const convertBtn = document.getElementById("convert-btn");
  const copyBtn = document.getElementById("copy-btn");
  const clearBtn = document.getElementById("clear-btn");
  const copyStatus = document.getElementById("copy-status");
  const codepointsEl = document.getElementById("codepoints");

  function setPreview(converted) {
    if (!converted) {
      previewEl.textContent = "（まだ変換されていません）";
      previewEl.classList.add("empty");
      return;
    }
    previewEl.textContent = lsepToDisplayNewlines(converted);
    previewEl.classList.remove("empty");
  }

  function convert() {
    const raw = inputEl.value;
    const converted = convertNewlinesToLsep(raw);
    resultEl.value = converted;
    setPreview(converted);
    codepointsEl.textContent = converted
      ? "コードポイント: " + summarizeCodePoints(converted)
      : "";
    copyBtn.disabled = !converted;
    copyStatus.textContent = "";
    copyStatus.classList.remove("error");
  }

  async function copyResult() {
    const text = resultEl.value;
    if (!text) return;

    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        resultEl.focus();
        resultEl.select();
        const ok = document.execCommand("copy");
        if (!ok) throw new Error("execCommand copy failed");
      }
      copyStatus.textContent = "コピーしました。Xの設定 → 表示名に貼り付けてください。";
      copyStatus.classList.remove("error");
    } catch (err) {
      copyStatus.textContent = "コピーに失敗しました。結果欄を長押しして手動コピーしてください。";
      copyStatus.classList.add("error");
    }
  }

  function clearAll() {
    inputEl.value = "";
    resultEl.value = "";
    codepointsEl.textContent = "";
    copyStatus.textContent = "";
    copyStatus.classList.remove("error");
    copyBtn.disabled = true;
    setPreview("");
    inputEl.focus();
  }

  convertBtn.addEventListener("click", convert);
  copyBtn.addEventListener("click", copyResult);
  clearBtn.addEventListener("click", clearAll);
  inputEl.addEventListener("input", convert);
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initUi);
  } else {
    initUi();
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { convertNewlinesToLsep, lsepToDisplayNewlines, LSEP };
}

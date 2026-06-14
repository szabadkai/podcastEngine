// Word-boundary-aware pronunciation normalization for TTS.
// The map lives in data/pronunciation.json so it can be extended at runtime.

import fs from "node:fs";
import path from "node:path";

const PRONUNCIATION_PATH = path.resolve("data", "pronunciation.json");

export function loadPronunciationMap(): Record<string, string> {
  return JSON.parse(fs.readFileSync(PRONUNCIATION_PATH, "utf-8"));
}

export function savePronunciationMap(map: Record<string, string>): void {
  const tmp = PRONUNCIATION_PATH + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(map, null, 2) + "\n");
  fs.renameSync(tmp, PRONUNCIATION_PATH);
}

export function normalizeForTTS(text: string): string {
  const map = loadPronunciationMap();
  let result = text;

  const entries = Object.entries(map).sort(
    (a, b) => b[0].length - a[0].length,
  );

  for (const [term, spoken] of entries) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(
      new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`, "g"),
      (match, offset, fullText) =>
        shouldReplaceTerm(term, fullText, offset) ? spoken : match,
    );
  }

  return result;
}

function shouldReplaceTerm(term: string, text: string, offset: number): boolean {
  if (term === "AM") {
    const before = text.slice(0, offset);
    if (/\b\d{1,2}(?::\d{2})?\s*$/.test(before)) return false;
  }

  return true;
}

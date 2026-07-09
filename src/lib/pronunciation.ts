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
  let result = normalizeNumbersForSpeech(text);

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

const SMALL_NUMBERS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
];
const TENS = [
  "",
  "",
  "twenty",
  "thirty",
  "forty",
  "fifty",
  "sixty",
  "seventy",
  "eighty",
  "ninety",
];
const MAGNITUDES = ["", "thousand", "million", "billion", "trillion"];

// ElevenLabs' automatic text normalization occasionally reads compact prices
// digit-by-digit or drops digits altogether. Expand the figures that carry
// meaning in a spoken news show before sending them to any TTS provider.
function normalizeNumbersForSpeech(text: string): string {
  let result = text.replace(
    /\$(\d[\d,]*(?:\.\d+)?)(?:\s*([kKmMbB])|\s+(thousand|million|billion|trillion))?\b/g,
    (
      match: string,
      numberText: string,
      compactSuffix: string | undefined,
      writtenMagnitude: string | undefined,
      offset: number,
      fullText: string
    ) => {
      const spoken = speakNumericText(numberText);
      const magnitude = compactSuffix
        ? compactMagnitude(compactSuffix)
        : writtenMagnitude ?? "";
      const singular = followsAttributedNoun(fullText.slice(offset + match.length));
      return `${spoken}${magnitude ? ` ${magnitude}` : ""} dollar${singular || isExactlyOne(numberText, magnitude) ? "" : "s"}`;
    }
  );

  // Expand compact non-currency figures too: "10M units" is much less
  // ambiguous to a voice model as "ten million units".
  result = result.replace(
    /\b(\d[\d,]*(?:\.\d+)?)([kKmMbB])\b/g,
    (_match, numberText: string, suffix: string) =>
      `${speakNumericText(numberText)} ${compactMagnitude(suffix)}`
  );

  result = result.replace(
    /\b(\d[\d,]*(?:\.\d+)?)%/g,
    (_match, numberText: string) => `${speakNumericText(numberText)} percent`
  );

  // Commas mark a large cardinal number, whereas product names such as Form 4
  // and dimensions such as 300mm retain their original useful spelling.
  return result.replace(
    /\b\d{1,3}(?:,\d{3})+\b/g,
    (numberText) => speakNumericText(numberText)
  );
}

function compactMagnitude(suffix: string): string {
  return {
    k: "thousand",
    m: "million",
    b: "billion",
  }[suffix.toLowerCase()]!;
}

function followsAttributedNoun(trailingText: string): boolean {
  const nextWord = /^\s+([A-Za-z]+)/.exec(trailingText)?.[1]?.toLowerCase();
  if (!nextWord) return false;

  return !new Set([
    "a",
    "an",
    "and",
    "around",
    "at",
    "about",
    "by",
    "dollar",
    "dollars",
    "each",
    "for",
    "from",
    "in",
    "less",
    "more",
    "nearly",
    "of",
    "on",
    "or",
    "over",
    "per",
    "roughly",
    "the",
    "this",
    "that",
    "these",
    "those",
    "to",
    "under",
    "up",
    "with",
  ]).has(nextWord);
}

function isExactlyOne(numberText: string, magnitude: string): boolean {
  return !magnitude && Number(numberText.replace(/,/g, "")) === 1;
}

function speakNumericText(numberText: string): string {
  const normalized = numberText.replace(/,/g, "");
  const [wholeText, fractionalText] = normalized.split(".");
  const whole = Number(wholeText);
  if (!Number.isSafeInteger(whole) || whole < 0) return numberText;

  const wholeWords = integerToWords(whole);
  if (!fractionalText) return wholeWords;
  return `${wholeWords} point ${[...fractionalText]
    .map((digit) => SMALL_NUMBERS[Number(digit)])
    .join(" ")}`;
}

function integerToWords(value: number): string {
  if (value < 20) return SMALL_NUMBERS[value];
  if (value < 100) {
    const tens = TENS[Math.floor(value / 10)];
    const remainder = value % 10;
    return remainder ? `${tens}-${SMALL_NUMBERS[remainder]}` : tens;
  }
  if (value < 1000) {
    const hundreds = `${SMALL_NUMBERS[Math.floor(value / 100)]} hundred`;
    const remainder = value % 100;
    return remainder ? `${hundreds} ${integerToWords(remainder)}` : hundreds;
  }

  const groups: string[] = [];
  let remaining = value;
  let magnitudeIndex = 0;
  while (remaining > 0) {
    const group = remaining % 1000;
    if (group) {
      const magnitude = MAGNITUDES[magnitudeIndex];
      groups.unshift(`${integerToWords(group)}${magnitude ? ` ${magnitude}` : ""}`);
    }
    remaining = Math.floor(remaining / 1000);
    magnitudeIndex++;
  }
  return groups.join(" ");
}

function shouldReplaceTerm(term: string, text: string, offset: number): boolean {
  if (term === "AM") {
    const before = text.slice(0, offset);
    if (/\b\d{1,2}(?::\d{2})?\s*$/.test(before)) return false;
  }

  return true;
}

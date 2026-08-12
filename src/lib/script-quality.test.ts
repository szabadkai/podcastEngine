import assert from "node:assert/strict";
import test from "node:test";
import { analyzeScriptQuality } from "./script-quality.js";
import type { EpisodeScript, ScriptLine } from "./types.js";

function makeLines(
  count: number,
  wordsPerLine: number,
  textPrefix = "Useful concrete detail",
): ScriptLine[] {
  const speakerPattern = [
    "alex", "jordan", "alex", "jordan", "alex", "jordan", "jordan",
    "alex", "jordan", "alex", "jordan", "alex", "alex", "jordan",
  ];
  return Array.from({ length: count }, (_, index) => {
    // Each balanced block includes two natural same-speaker follow-ons.
    const speaker = speakerPattern[index % speakerPattern.length];
    const words = Array.from(
      { length: Math.max(0, wordsPerLine - 4) },
      (__, wordIndex) => `detail${index}x${wordIndex}`,
    );
    return {
      speaker,
      segment: index < 4 ? "opening" : "big-print",
      text: `${textPrefix} turn ${index} ${words.join(" ")}`,
    };
  });
}

function makeScript(lines: ScriptLine[]): EpisodeScript {
  return {
    episodeNumber: 11,
    episodeDate: "2026-07-19",
    episodeType: "news",
    title: "A useful episode",
    description: "A grounded description of the useful episode.",
    lines,
  };
}

const options = {
  expectedSpeakers: ["alex", "jordan"],
  requiredSegments: ["opening", "big-print"],
};

test("accepts a balanced full-length conversational script", () => {
  const report = analyzeScriptQuality(makeScript(makeLines(60, 55)), options);
  assert.equal(report.blockingIssues.length, 0);
  assert.equal(report.warnings.length, 0);
  assert.ok(report.wordCount >= 3200);
  assert.ok(report.sameSpeakerFollowUpCount >= 5);
});

test("blocks severely short scripts and missing required segments", () => {
  const report = analyzeScriptQuality(makeScript(makeLines(35, 20)), {
    ...options,
    requiredSegments: ["opening", "big-print", "hype-signal"],
  });
  assert.ok(report.blockingIssues.some((issue) => issue.includes("runtime target")));
  assert.ok(report.blockingIssues.some((issue) => issue.includes("hype-signal")));
});

test("detects model-like phrase repetition that the old handoff total missed", () => {
  const lines = makeLines(60, 55).map((line) => ({
    ...line,
    text: `That's the genuinely useful point. Actually, ${line.text}`,
  }));
  const report = analyzeScriptQuality(makeScript(lines), options);
  assert.ok(report.warnings.some((warning) => warning.includes('Phrase "that\'s the"')));
  assert.ok(report.warnings.some((warning) => warning.includes('Phrase "actually"')));
  assert.equal(report.repeatedPhraseCounts["genuinely"], 60);
});

test("blocks unknown speakers before audio generation", () => {
  const lines = makeLines(60, 55);
  lines[12] = { ...lines[12], speaker: "narrator" };
  const report = analyzeScriptQuality(makeScript(lines), options);
  assert.ok(report.blockingIssues.some((issue) => issue.includes("narrator")));
});

test("blocks dialogue that narrates the internal research process", () => {
  const lines = makeLines(60, 55);
  lines[8] = {
    ...lines[8],
    text: "The founding date is missing from our sources, so we cannot say when it started.",
  };
  const report = analyzeScriptQuality(makeScript(lines), options);
  assert.ok(
    report.blockingIssues.some((issue) =>
      issue.includes("internal research process"),
    ),
  );
});

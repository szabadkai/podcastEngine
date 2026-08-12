import type { EpisodeScript } from "./types.js";

export interface ScriptQualityOptions {
  expectedSpeakers?: string[];
  requiredSegments?: string[];
}

export interface ScriptQualityReport {
  wordCount: number;
  lineCount: number;
  estimatedMinutes: number;
  avgWordsPerLine: number;
  switchRatePct: number;
  sameSpeakerFollowUpCount: number;
  maxSameSpeakerRun: number;
  questionLinePct: number;
  questionLinePctBySpeaker: Record<string, number>;
  callbackCount: number;
  handoffPhraseCount: number;
  repeatedPhraseCounts: Record<string, number>;
  duplicateLineCount: number;
  speakerWordSharePct: Record<string, number>;
  warnings: string[];
  blockingIssues: string[];
  revisionAttempted?: boolean;
  initialWarnings?: string[];
}

const WORD_RE = /\b[\w'-]+\b/g;
const CALLBACK_RE =
  /\b(last week|episode \d+|episode one|episode two|episode three|episode four|episode five|episode six|few episodes|few weeks|as we covered|we covered|we talked|we flagged|listeners will remember|ties back|back in episode)\b/gi;
const RESEARCH_PROCESS_RE =
  /\b(our sources?|the sources? we have|from (?:what|the material) we have|the material we have|source packet|research deck|I (?:can(?:not|'t)|could(?:n'?t)) (?:verify|confirm) (?:from|with) (?:our|the) sources?)\b/gi;
const HANDOFF_RE =
  /\b(right, and|yeah, and|exactly|that's the|the bigger thing|the catch is|which is|and that's|so the)\b/gi;

// These are not forbidden words. They become audible tells when a model leans
// on one of them six, eight, or ten times in the same episode.
const REPETITIVE_PHRASES = [
  "that's the",
  "actually",
  "genuinely",
  "exactly",
  "right, and",
  "here's the thing",
  "the thing is",
  "the catch",
  "the bigger thing",
] as const;

function countWords(text: string): number {
  return text.match(WORD_RE)?.length ?? 0;
}

function countMatches(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0;
}

function countLiteral(text: string, phrase: string): number {
  let count = 0;
  let from = 0;
  while (true) {
    const found = text.indexOf(phrase, from);
    if (found === -1) return count;
    count++;
    from = found + phrase.length;
  }
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

export function analyzeScriptQuality(
  script: EpisodeScript,
  options: ScriptQualityOptions = {},
): ScriptQualityReport {
  const lines = Array.isArray(script.lines) ? script.lines : [];
  const text = lines.map((line) => line?.text ?? "").join("\n");
  // Normalize typographic apostrophes so generated punctuation does not evade
  // phrase checks ("that's" and "that’s" should count as the same habit).
  const normalizedText = text.toLowerCase().replace(/[’]/g, "'");
  const wordCount = countWords(text);
  const lineCount = lines.length;
  const speakerWords: Record<string, number> = {};
  const speakerLines: Record<string, number> = {};
  const speakerQuestions: Record<string, number> = {};
  let switches = 0;
  let sameSpeakerFollowUpCount = 0;
  let currentSpeakerRun = 0;
  let maxSameSpeakerRun = 0;
  let questionLines = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const speaker = typeof line?.speaker === "string" ? line.speaker : "";
    const lineText = typeof line?.text === "string" ? line.text : "";
    speakerWords[speaker] = (speakerWords[speaker] ?? 0) + countWords(lineText);
    speakerLines[speaker] = (speakerLines[speaker] ?? 0) + 1;
    if (i === 0 || lines[i - 1]?.speaker !== speaker) {
      if (i > 0) switches++;
      currentSpeakerRun = 1;
    } else {
      sameSpeakerFollowUpCount++;
      currentSpeakerRun++;
    }
    maxSameSpeakerRun = Math.max(maxSameSpeakerRun, currentSpeakerRun);
    if (lineText.includes("?")) {
      questionLines++;
      speakerQuestions[speaker] = (speakerQuestions[speaker] ?? 0) + 1;
    }
  }

  const speakerWordSharePct = Object.fromEntries(
    Object.entries(speakerWords).map(([speaker, words]) => [
      speaker,
      wordCount > 0 ? round1((words / wordCount) * 100) : 0,
    ]),
  );
  const questionLinePctBySpeaker = Object.fromEntries(
    Object.keys(speakerLines).map((speaker) => [
      speaker,
      round1(((speakerQuestions[speaker] ?? 0) / speakerLines[speaker]) * 100),
    ]),
  );
  const switchRatePct =
    lineCount > 1 ? round1((switches / (lineCount - 1)) * 100) : 0;
  const questionLinePct =
    lineCount > 0 ? round1((questionLines / lineCount) * 100) : 0;
  const callbackCount = countMatches(text, CALLBACK_RE);
  const handoffPhraseCount = countMatches(normalizedText, HANDOFF_RE);
  const researchProcessMentions = countMatches(text, RESEARCH_PROCESS_RE);
  const repeatedPhraseCounts: Record<string, number> = {};
  for (const phrase of REPETITIVE_PHRASES) {
    const count = countLiteral(normalizedText, phrase);
    if (count > 0) repeatedPhraseCounts[phrase] = count;
  }

  const seenLines = new Set<string>();
  let duplicateLineCount = 0;
  for (const line of lines) {
    const normalized = (line?.text ?? "").toLowerCase().replace(/\s+/g, " ").trim();
    // Ignore deliberately reusable short reactions such as "Right." Exact
    // duplication of a substantive turn is almost always generation damage.
    if (normalized.length < 30) continue;
    if (seenLines.has(normalized)) duplicateLineCount++;
    seenLines.add(normalized);
  }

  const isProfile = script.episodeType === "company-profile";
  const minWords = isProfile ? 3500 : 3200;
  const maxWords = isProfile ? 4300 : 4000;
  const minLines = isProfile ? 60 : 55;
  const maxLines = isProfile ? 85 : 80;
  const warnings: string[] = [];
  const blockingIssues: string[] = [];

  if (!script.title?.trim()) blockingIssues.push("Episode title is missing.");
  if (!script.description?.trim()) {
    blockingIssues.push("Episode description is missing.");
  }
  if (lineCount === 0) blockingIssues.push("Script has no dialogue lines.");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line?.speaker?.trim() || !line?.segment?.trim() || !line?.text?.trim()) {
      blockingIssues.push(`Line ${i + 1} has a blank speaker, segment, or text field.`);
    }
  }

  if (wordCount < minWords) {
    warnings.push(
      `Script is short for this format (${wordCount} words; target floor ${minWords}).`,
    );
  }
  if (wordCount > maxWords) {
    warnings.push(
      `Script is long for this format (${wordCount} words; target ceiling ${maxWords}).`,
    );
  }
  if (wordCount < minWords * 0.9) {
    blockingIssues.push(
      `Script is far below the runtime target (${wordCount} words; hard floor ${Math.ceil(minWords * 0.9)}).`,
    );
  }
  if (wordCount > maxWords * 1.15) {
    blockingIssues.push(
      `Script is far above the runtime target (${wordCount} words; hard ceiling ${Math.floor(maxWords * 1.15)}).`,
    );
  }
  if (lineCount < minLines || lineCount > maxLines) {
    warnings.push(
      `Turn count is outside the ${minLines}-${maxLines} target (${lineCount} turns).`,
    );
  }
  if (lineCount < Math.floor(minLines * 0.7) || lineCount > Math.ceil(maxLines * 1.2)) {
    blockingIssues.push(`Turn count is implausible for this format (${lineCount} turns).`);
  }
  if (switchRatePct > 88) {
    warnings.push(
      `Speaker switching is too regular (${switchRatePct}% of turns switch speaker).`,
    );
  }
  const minSameSpeakerFollowUps = Math.max(4, Math.floor(lineCount / 12));
  if (lineCount >= 30 && sameSpeakerFollowUpCount < minSameSpeakerFollowUps) {
    warnings.push(
      `Conversation is too strictly alternating (${sameSpeakerFollowUpCount} same-speaker follow-ups; target at least ${minSameSpeakerFollowUps}).`,
    );
  }
  if (maxSameSpeakerRun > 4) {
    warnings.push(
      `One speaker holds the floor for ${maxSameSpeakerRun} consecutive turns; check that it still sounds like a dialogue.`,
    );
  }
  for (const [speaker, share] of Object.entries(speakerWordSharePct)) {
    if (share > 56) {
      warnings.push(`${speaker} dominates the script (${share}% of words; target at most 56%).`);
    }
    if (share > 64) {
      blockingIssues.push(`${speaker} has an excessive ${share}% share of spoken words.`);
    }
  }
  if (callbackCount > 1) {
    warnings.push(`Too many continuity callbacks (${callbackCount}; target 0-1).`);
  }
  if (callbackCount > 3) {
    blockingIssues.push(`Script contains ${callbackCount} continuity callbacks.`);
  }
  if (handoffPhraseCount > Math.max(14, lineCount * 0.22)) {
    warnings.push(
      `Canned handoff phrases are repetitive (${handoffPhraseCount} matches).`,
    );
  }
  if (questionLinePct > 32) {
    warnings.push(
      `Question-heavy pacing (${questionLinePct}% of lines contain a question).`,
    );
  }
  const phraseLimit = Math.max(4, Math.ceil(lineCount / 14));
  for (const [phrase, count] of Object.entries(repeatedPhraseCounts)) {
    if (count > phraseLimit) {
      warnings.push(
        `Phrase "${phrase}" repeats ${count} times (soft limit ${phraseLimit}).`,
      );
    }
  }
  if (duplicateLineCount > 0) {
    warnings.push(`${duplicateLineCount} substantive dialogue line(s) are exact duplicates.`);
  }
  if (duplicateLineCount > 2) {
    blockingIssues.push(`${duplicateLineCount} substantive dialogue lines are duplicated.`);
  }
  if (researchProcessMentions > 0) {
    blockingIssues.push(
      `Script narrates the internal research process ${researchProcessMentions} time(s); omit unsupported details or describe the publisher/vendor's missing disclosure directly.`,
    );
  }

  const expectedSpeakers = options.expectedSpeakers ?? [];
  if (expectedSpeakers.length > 0) {
    const actualSpeakers = Object.keys(speakerLines).filter(Boolean);
    const unexpected = actualSpeakers.filter(
      (speaker) => !expectedSpeakers.includes(speaker),
    );
    const missing = expectedSpeakers.filter(
      (speaker) => !actualSpeakers.includes(speaker),
    );
    if (unexpected.length > 0) {
      blockingIssues.push(`Unexpected speaker id(s): ${unexpected.join(", ")}.`);
    }
    if (missing.length > 0) {
      blockingIssues.push(`Missing expected speaker(s): ${missing.join(", ")}.`);
    }
  }

  const actualSegments = new Set(lines.map((line) => line?.segment).filter(Boolean));
  const missingSegments = unique(options.requiredSegments ?? []).filter(
    (segment) => !actualSegments.has(segment),
  );
  if (missingSegments.length > 0) {
    blockingIssues.push(`Missing required segment(s): ${missingSegments.join(", ")}.`);
  }

  return {
    wordCount,
    lineCount,
    estimatedMinutes: Math.round(wordCount / 155),
    avgWordsPerLine: lineCount > 0 ? round1(wordCount / lineCount) : 0,
    switchRatePct,
    sameSpeakerFollowUpCount,
    maxSameSpeakerRun,
    questionLinePct,
    questionLinePctBySpeaker,
    callbackCount,
    handoffPhraseCount,
    repeatedPhraseCounts,
    duplicateLineCount,
    speakerWordSharePct,
    warnings,
    blockingIssues: unique(blockingIssues),
  };
}

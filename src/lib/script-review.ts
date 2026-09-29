export const SCRIPT_REVIEW_CATEGORIES = [
  "factual-fidelity",
  "editorial-arc",
  "host-voice",
  "conversation-flow",
  "semantic-repetition",
  "tone",
  "source-treatment",
] as const;

export type ScriptReviewCategory =
  (typeof SCRIPT_REVIEW_CATEGORIES)[number];
export type ScriptReviewSeverity = "material" | "advisory";

export interface ScriptReviewIssue {
  severity: ScriptReviewSeverity;
  category: ScriptReviewCategory;
  lineIndexes: number[];
  problem: string;
  revisionInstruction: string;
}

export interface ScriptReview {
  decision: "approve" | "revise";
  issues: ScriptReviewIssue[];
}

const categorySet = new Set<string>(SCRIPT_REVIEW_CATEGORIES);

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Treat model output as untrusted input. Invalid or advisory-only feedback must
 * never cause a costly rewrite, and line references must point into the draft
 * that was actually reviewed.
 */
export function normalizeScriptReview(
  raw: unknown,
  draftLineCount: number,
): ScriptReview {
  if (!raw || typeof raw !== "object" || !Array.isArray((raw as { issues?: unknown }).issues)) {
    throw new Error("Script reviewer returned an invalid response: issues must be an array");
  }

  const normalized: ScriptReviewIssue[] = [];
  for (const candidate of (raw as { issues: unknown[] }).issues) {
    if (!candidate || typeof candidate !== "object") continue;
    const issue = candidate as Record<string, unknown>;
    if (issue.severity !== "material" && issue.severity !== "advisory") continue;
    if (typeof issue.category !== "string" || !categorySet.has(issue.category)) continue;

    const problem = nonEmptyString(issue.problem);
    const revisionInstruction = nonEmptyString(issue.revisionInstruction);
    if (!problem || !revisionInstruction || !Array.isArray(issue.lineIndexes)) continue;

    const lineIndexes = [
      ...new Set(
        issue.lineIndexes.filter(
          (value): value is number =>
            Number.isInteger(value) && value >= 1 && value <= draftLineCount,
        ),
      ),
    ].slice(0, 12);
    if (lineIndexes.length === 0) continue;

    normalized.push({
      severity: issue.severity,
      category: issue.category as ScriptReviewCategory,
      lineIndexes,
      problem,
      revisionInstruction,
    });
    if (normalized.length === 8) break;
  }

  // Derive the decision from validated findings instead of trusting a possibly
  // contradictory model field (for example, "approve" plus a material issue).
  return {
    decision: normalized.some((issue) => issue.severity === "material")
      ? "revise"
      : "approve",
    issues: normalized,
  };
}

export function materialScriptReviewReasons(review: ScriptReview): string[] {
  return review.issues
    .filter((issue) => issue.severity === "material")
    .map(
      (issue) =>
        `Editorial review [${issue.category}] at line(s) ${issue.lineIndexes.join(
          ", ",
        )}: ${issue.problem} Revision instruction: ${issue.revisionInstruction}`,
    );
}

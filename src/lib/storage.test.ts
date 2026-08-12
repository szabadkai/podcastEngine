import assert from "node:assert/strict";
import test from "node:test";
import { selectRecentRecapFiles } from "./storage.js";

const recapFiles = [
  "notes.txt",
  "2026-05-29.json",
  "2026-05-30.json", // local draft that never appeared in the manifest
  "2026-06-05.json",
  "2026-06-12.json",
];

test("excludes unpublished recap drafts before slicing the continuity window", () => {
  const publishedDates = new Set(["2026-05-29", "2026-06-05", "2026-06-12"]);
  assert.deepEqual(
    selectRecentRecapFiles(recapFiles, 2, { includeDates: publishedDates }),
    ["2026-06-05.json", "2026-06-12.json"],
  );
});

test("applies date and age filters to recap filenames", () => {
  assert.deepEqual(
    selectRecentRecapFiles(recapFiles, 8, {
      beforeDate: "2026-06-20",
      minAgeDays: 14,
    }),
    ["2026-05-29.json", "2026-05-30.json", "2026-06-05.json"],
  );
});

import assert from "node:assert/strict";
import test from "node:test";
import { scheduledEpisodeType } from "./schedule.js";

test("alternates company profiles and news on consecutive Fridays", () => {
  assert.equal(scheduledEpisodeType("2026-10-02"), "company-profile");
  assert.equal(scheduledEpisodeType("2026-10-09"), "news");
  assert.equal(scheduledEpisodeType("2026-10-16"), "company-profile");
  assert.equal(scheduledEpisodeType("2026-10-23"), "news");
  // Across the year boundary: 13 weeks after the first profile.
  assert.equal(scheduledEpisodeType("2027-01-01"), "news");
  assert.equal(scheduledEpisodeType("2027-01-08"), "company-profile");
});

test("weeks before the first alternating Friday follow the same parity", () => {
  assert.equal(scheduledEpisodeType("2026-09-25"), "news");
  assert.equal(scheduledEpisodeType("2026-09-18"), "company-profile");
});

test("rejects an unparseable date", () => {
  assert.throws(() => scheduledEpisodeType("next friday"), /Invalid episode date/);
});

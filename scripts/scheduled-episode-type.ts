/**
 * Prints which episode type a scheduled Friday run should produce.
 * Used by both scheduled workflows so they alternate instead of both firing.
 *
 * Usage: tsx scripts/scheduled-episode-type.ts 2026-10-02   # company-profile
 */
import { scheduledEpisodeType } from "../src/lib/schedule.js";

const date = process.argv[2];
if (!date) {
  console.error("Usage: tsx scripts/scheduled-episode-type.ts <YYYY-MM-DD>");
  process.exit(1);
}
console.log(scheduledEpisodeType(date));

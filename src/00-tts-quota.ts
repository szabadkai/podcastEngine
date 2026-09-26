import { config } from "./config.js";
import { describeQuota, getCreditQuota } from "./lib/elevenlabs.js";

// Runs before any AI stage. Five runs from 2026-09-11 to 2026-09-25 spent
// ~25 minutes each on analysis, fact-checking, and two script-model calls,
// then failed on the first audio chunk because the plan had 31 credits left.
export async function run(_episodeDir: string): Promise<void> {
  if (config.ttsProvider !== "elevenlabs") {
    console.log(`Stage 00: TTS provider "${config.ttsProvider}" has no quota to check.`);
    return;
  }

  const quota = await getCreditQuota();
  if (!quota) {
    console.warn("Stage 00: ElevenLabs quota unavailable; continuing without the check.");
    return;
  }

  const needed = config.audio.minEpisodeCredits;
  if (quota.remaining < needed) {
    throw new Error(
      `ElevenLabs has ${describeQuota(quota)}; an episode needs about ${needed}. ` +
        "Top up the plan or wait for the reset before generating an episode.",
    );
  }
  console.log(`Stage 00: ElevenLabs ${describeQuota(quota)}.`);
}

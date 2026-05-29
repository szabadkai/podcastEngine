import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { chatJson } from "./lib/ai.js";
import { loadJson, writeJson, fileExists } from "./lib/storage.js";
import { stripTags } from "./lib/tags.js";
import type { EpisodeScript, TaggedEpisodeScript } from "./lib/types.js";

// Inserts expressive performance tags ([laugh], [chuckle], ...) into the finished
// script — but only when the active TTS provider can interpret them. For providers
// that can't, this stage is a no-op (audio reads 04-script.json directly).
export async function run(episodeDir: string): Promise<void> {
  const outputPath = path.join(episodeDir, "04b-script-tagged.json");
  if (fileExists(outputPath)) {
    console.log("Stage 04b: output already exists, skipping.");
    return;
  }

  if (!config.tagSupport[config.ttsProvider]) {
    console.log(
      `Stage 04b: provider "${config.ttsProvider}" does not support expressive tags — skipping tag pass.`
    );
    return;
  }

  const inputPath = path.join(episodeDir, "04-script.json");
  const script = loadJson<EpisodeScript | null>(inputPath, null);
  if (!script) throw new Error("No script found in 04-script.json");

  const systemPrompt = fs.readFileSync(
    path.resolve("prompts", "expressive-tags.md"),
    "utf-8"
  );

  console.log(
    `Stage 04b: adding expressive tags for provider "${config.ttsProvider}"...`
  );

  const result = await chatJson<TaggedEpisodeScript>({
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: `Add performance tags to this script. Return the same JSON with a taggedText field on every line.\n\n${JSON.stringify(
          script,
          null,
          2
        )}`,
      },
    ],
    temperature: 0.4,
    maxTokens: 16384,
  });

  // Guard against the model dropping or rewording lines: if a line's taggedText
  // (tags stripped) doesn't match the original text, fall back to the original.
  let tagged = 0;
  result.lines = result.lines.map((line, i) => {
    const original = script.lines[i];
    if (!original) return { ...line, taggedText: line.text };
    if (!line.taggedText || stripTags(line.taggedText) !== original.text) {
      return { ...original, taggedText: original.text };
    }
    if (line.taggedText !== original.text) tagged++;
    return { ...original, taggedText: line.taggedText };
  });

  writeJson(outputPath, result);
  console.log(
    `Stage 04b: tagged script written — ${tagged}/${result.lines.length} lines got a performance tag.`
  );
}

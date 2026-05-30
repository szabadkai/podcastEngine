import path from "node:path";
import { config } from "./config.js";
import { chatJson } from "./lib/ai.js";
import { loadJson } from "./lib/storage.js";
import {
  loadPronunciationMap,
  savePronunciationMap,
} from "./lib/pronunciation.js";
import type { EpisodeScript } from "./lib/types.js";

// Matches 2+ uppercase letters optionally followed by digits (e.g. PA12),
// or uppercase+ampersand combos (R&D).
const ACRONYM_RE = /(?<![A-Za-z0-9])[A-Z][A-Z0-9&]{1,}(?![A-Za-z0-9])/g;

// Common English words that look like acronyms but aren't.
const IGNORE = new Set([
  "OK", "US", "UK", "EU", "IT", "OR", "AN", "AT", "AS", "BE", "BY",
  "DO", "GO", "IF", "IN", "IS", "ME", "MY", "NO", "OF", "ON", "SO",
  "TO", "UP", "WE", "HE", "NOT", "BUT", "AND", "THE", "ARE", "WAS",
  "HAS", "HAD", "FOR", "ALL", "CAN", "HER", "HIS", "HOW", "ITS",
  "LET", "MAY", "NEW", "NOW", "OLD", "OUR", "OUT", "OWN", "SAY",
  "SHE", "TOO", "USE", "WAY", "WHO", "BOY", "DID", "GET", "HIM",
  "SET", "TRY", "ASK", "MEN", "RUN", "ANY", "BIG", "END", "FAR",
  "FEW", "GOT", "PUT", "SAT", "TOP", "RED", "YET",
]);

interface PronunciationEntry {
  term: string;
  spoken: string;
}

function extractUnknownAcronyms(script: EpisodeScript): string[] {
  const map = loadPronunciationMap();
  const known = new Set(Object.keys(map));
  const found = new Set<string>();

  for (const line of script.lines) {
    for (const match of line.text.matchAll(ACRONYM_RE)) {
      const term = match[0];
      if (!known.has(term) && !IGNORE.has(term)) {
        found.add(term);
      }
    }
  }

  return [...found].sort();
}

export async function run(episodeDir: string): Promise<void> {
  const inputPath = path.join(episodeDir, "04-script.json");
  const script = loadJson<EpisodeScript | null>(inputPath, null);
  if (!script) throw new Error("No script found in 04-script.json");

  const unknown = extractUnknownAcronyms(script);
  if (unknown.length === 0) {
    console.log("Stage 04d: no new acronyms found — pronunciation map is up to date.");
    return;
  }

  console.log(`Stage 04d: ${unknown.length} new acronym(s) found: ${unknown.join(", ")}`);

  const result = await chatJson<{ entries: PronunciationEntry[] }>({
    messages: [
      {
        role: "system",
        content: `You are a pronunciation guide for a text-to-speech engine reading a ${config.domain} podcast.

For each acronym or technical term, decide how it should be spoken aloud and return a phonetic form that a TTS engine will read naturally.

Three strategies (pick the best one for each term):
1. **Phonetic spelling** — for terms spoken letter-by-letter. Use hyphenated syllables: "eff-dee-em" for FDM, "pee-ell-ay" for PLA. Use these phonetic letter names: A=ay, B=bee, C=see, D=dee, E=ee, F=eff, G=gee, H=aitch, I=eye, J=jay, K=kay, L=ell, M=em, N=en, O=oh, P=pee, Q=cue, R=arr, S=ess, T=tee, U=you, V=vee, W=double-you, X=ex, Y=why, Z=zee.
2. **Expand** — for terms better spoken as the full phrase: "additive manufacturing" for AM.
3. **Pronounce as word** — for terms commonly said as a word: "cad" for CAD, "peek" for PEEK.

Return JSON: { "entries": [{ "term": "ACRONYM", "spoken": "how-to-say-it" }] }`,
      },
      {
        role: "user",
        content: `Classify these terms:\n${unknown.join("\n")}`,
      },
    ],
    temperature: 0.1,
    maxTokens: 2048,
  });

  const map = loadPronunciationMap();
  let added = 0;

  for (const entry of result.entries) {
    if (!entry.term || !entry.spoken) continue;
    if (map[entry.term]) continue;
    map[entry.term] = entry.spoken;
    added++;
    console.log(`  + ${entry.term} → "${entry.spoken}"`);
  }

  if (added > 0) {
    savePronunciationMap(map);
    console.log(`Stage 04d: added ${added} term(s) to data/pronunciation.json.`);
  } else {
    console.log("Stage 04d: LLM returned no new entries.");
  }
}

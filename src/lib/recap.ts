import type {
  EpisodeRecap,
  EpisodeScript,
  FactCheckedStories,
} from "./types.js";

function uniqueNonEmpty(values: string[], limit: number): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].slice(
    0,
    limit,
  );
}

// Continuity metadata already exists in the fact-checked brief. Reusing it
// avoids sending a complete 3,000-4,000 word script through another model.
export function buildMechanicalRecap(
  script: EpisodeScript,
  factChecked: FactCheckedStories | null,
): EpisodeRecap {
  const clusters = factChecked?.clusters ?? [];
  const topics = uniqueNonEmpty(
    clusters.map((cluster) => cluster.headline),
    6,
  );
  const threads = uniqueNonEmpty(
    clusters
      .filter((cluster) => {
        const factCheck = cluster.factCheck;
        return (
          cluster.segment === "future-watch" ||
          cluster.segment === "hype-signal" ||
          factCheck?.claims?.some(
            (claim) =>
              claim.rating === "unverifiable" || claim.rating === "dubious",
          ) ||
          (factCheck?.hypeFlags?.length ?? 0) > 0
        );
      })
      .map((cluster) => cluster.headline),
    4,
  );

  return {
    number: script.episodeNumber,
    date: script.episodeDate,
    title: script.title,
    topics: topics.length > 0 ? topics : [script.title],
    threads,
    predictions: [],
  };
}

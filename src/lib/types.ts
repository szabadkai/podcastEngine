export interface RawStory {
  id: string;
  title: string;
  url: string;
  source: string;
  published: string;
  snippet: string;
}

export type Segment =
  | "big-print"
  | "materials-watch"
  | "factory-floor"
  | "desktop-maker"
  | "hype-signal";

export interface StoryCluster {
  id: string;
  segment: Segment;
  headline: string;
  summary: string;
  sources: string[];
  significance: string;
  rank: number;
}

export interface AnalyzedStories {
  episodeDate: string;
  clusters: StoryCluster[];
  skipped: Array<{ headline: string; reason: string }>;
}

export interface Claim {
  claim: string;
  rating: "verified" | "plausible" | "unverifiable" | "dubious";
  note: string;
}

export interface FactCheckResult {
  claims: Claim[];
  hypeFlags: string[];
  missingContext: string[];
  skepticalAngles: string[];
}

export interface FactCheckedCluster extends StoryCluster {
  factCheck: FactCheckResult;
}

export interface FactCheckedStories {
  episodeDate: string;
  clusters: FactCheckedCluster[];
}

export interface ScriptLine {
  speaker: "alex" | "jordan";
  segment: string;
  text: string;
}

export interface EpisodeScript {
  episodeNumber: number;
  episodeDate: string;
  title: string;
  description: string;
  lines: ScriptLine[];
}

export interface TaggedScriptLine extends ScriptLine {
  // Same as ScriptLine.text but may contain expressive tags like [laugh], [chuckle].
  taggedText: string;
}

export interface TaggedEpisodeScript extends Omit<EpisodeScript, "lines"> {
  lines: TaggedScriptLine[];
}

export interface TtsChunk {
  index: number;
  speaker: "alex" | "jordan";
  text: string;
}

export interface EpisodeEntry {
  number: number;
  date: string;
  title: string;
  description: string;
  duration: number;
  fileSize: number;
  releaseUrl: string;
  guid: string;
}

export interface EpisodeManifest {
  episodes: EpisodeEntry[];
}

export interface EpisodeRecap {
  number: number;
  date: string;
  title: string;
  topics: string[]; // main stories/segments covered
  threads: string[]; // ongoing storylines worth following up
  predictions: string[]; // claims/predictions hosts made that could be revisited
}

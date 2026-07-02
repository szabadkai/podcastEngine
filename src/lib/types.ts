export type EpisodeType = "news" | "company-profile";

export type SourceType =
  | "core"
  | "maker"
  | "research"
  | "discovery"
  | "vendor"
  | "community"
  | "profile";

export interface RawStory {
  id: string;
  title: string;
  url: string;
  source: string;
  sourceType: SourceType;
  published: string;
  snippet: string;
  curated?: boolean;
}

export interface CuratedLink {
  url: string;
  title?: string;
  note?: string;
  issueNumber: number;
}

export type Segment = string;

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
  episodeType?: EpisodeType;
  companyName?: string;
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
  episodeType?: EpisodeType;
  companyName?: string;
  clusters: FactCheckedCluster[];
}

export interface ScriptLine {
  speaker: string;
  segment: string;
  text: string;
}

export interface EpisodeScript {
  episodeNumber: number;
  episodeDate: string;
  episodeType?: EpisodeType;
  companyName?: string;
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
  speaker: string;
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
  transcriptUrl?: string;
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

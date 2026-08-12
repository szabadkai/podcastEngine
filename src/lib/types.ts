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

export interface ResearchRequest {
  question: string;
  reason: string;
  priority: "critical" | "useful";
  query: string;
  preferredSources: string[];
  publicAnswerLikely: boolean;
}

export type ResearchFindingStatus =
  | "resolved"
  | "partially-resolved"
  | "not-found"
  | "not-public";

export interface ResearchSource {
  url: string;
  title: string;
  publisher: string;
  sourceClass: "primary" | "independent" | "community";
  evidence: string;
}

export interface ResearchFinding {
  requestId: string;
  clusterId: string;
  question: string;
  status: ResearchFindingStatus;
  answer: string;
  sources: ResearchSource[];
  residualUncertainty: string;
}

export interface EpisodeResearchRequest extends ResearchRequest {
  id: string;
  clusterId: string;
  clusterHeadline: string;
}

export interface EpisodeResearch {
  episodeDate: string;
  episodeType: EpisodeType;
  companyName?: string;
  completed: boolean;
  failure?: string;
  requests: EpisodeResearchRequest[];
  findings: ResearchFinding[];
}

export type ProductStatus =
  | "launched"
  | "announced"
  | "rumored"
  | "retired"
  | "unknown";

export interface ProductStatusFact {
  product: string;
  status: ProductStatus;
  evidence: string;
}

export interface FactCheckResult {
  claims: Claim[];
  // Optional for backwards compatibility with archived fact-check artifacts.
  // New company-profile checks should always return this explicit chronology
  // ledger so later stages cannot turn an established product into a rumor.
  productStatuses?: ProductStatusFact[];
  hypeFlags: string[];
  missingContext: string[];
  skepticalAngles: string[];
  // Present on the first-pass audit. The final fact-check intentionally clears
  // this field after the selected public-web questions have been researched.
  researchRequests?: ResearchRequest[];
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
  imageUrl?: string;
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

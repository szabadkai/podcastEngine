import path from "node:path";
import { pathToFileURL } from "node:url";

export interface Speaker {
  id: string;
  displayName: string;
}

export interface ShowConfig {
  podcast: {
    title: string;
    description: string;
    siteUrl: string;
    feedUrl: string;
    imageUrl: string;
    language: string;
    author: string;
    ownerName: string;
    ownerEmail: string;
    category: string;
    itunesCategories?: string[];
    rssCategory?: string;
    youtube?: {
      category: string;
      categoryId: number;
      madeForKids: boolean;
    };
    explicit: boolean;
    podcastGuid?: string;
  };
  sources: Array<{
    name: string;
    url: string;
    type?: "core" | "maker" | "research" | "discovery" | "vendor" | "community" | "profile";
  }>;
  speakers: Speaker[];
  voices: {
    edge: Record<string, { voice: string; rate: string; pitch: string }>;
    kokoro: Record<string, { voice: string; speed: number }>;
    chatterbox: Record<
      string,
      { audioPrompt: string; exaggeration: number; cfgWeight: number }
    >;
    piper: Record<string, { model: string; lengthScale: number }>;
    elevenlabs: Record<
      string,
      {
        voiceId: string;
        stability: number;
        similarityBoost: number;
        style: number;
      }
    >;
  };
  episode: {
    targetMinutes: number;
    storyWindowDays: number;
    fallbackWindowDays: number;
    minStories: number;
    maxSeenUrls: number;
    continuityWindow: number;
    continuityMinAgeDays: number;
    continuityMinSharedTerms: number;
  };
  guidPrefix: string;
  domain: string;
  continuityStopwords: string[];
}

let _show: ShowConfig | null = null;

export async function loadShow(): Promise<ShowConfig> {
  if (_show) return _show;
  const configPath = path.resolve("show.config.ts");
  const configUrl = pathToFileURL(configPath).href;
  const mod = await import(configUrl);
  _show = mod.default as ShowConfig;
  return _show;
}

export function getShow(): ShowConfig {
  if (!_show) throw new Error("Show config not loaded — call loadShow() first");
  return _show;
}

export function getSpeakerLabel(id: string): string {
  const show = getShow();
  const speaker = show.speakers.find((s) => s.id === id);
  return speaker?.displayName ?? id;
}

export function getSpeakerIds(): string[] {
  return getShow().speakers.map((s) => s.id);
}

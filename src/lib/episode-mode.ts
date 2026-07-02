import path from "node:path";
import type { EpisodeType } from "./types.js";

export interface EpisodeContext {
  type: EpisodeType;
  companyName?: string;
}

const TYPE_ALIASES: Record<string, EpisodeType> = {
  news: "news",
  weekly: "news",
  "weekly-news": "news",
  company: "company-profile",
  profile: "company-profile",
  "company-profile": "company-profile",
};

function normalizeType(raw: string | undefined): EpisodeType {
  const key = (raw || "news").trim().toLowerCase().replace(/_/g, "-");
  const type = TYPE_ALIASES[key];
  if (!type) {
    throw new Error(
      `Unknown EPISODE_TYPE "${raw}". Available types: news, company-profile`
    );
  }
  return type;
}

export function getEpisodeContext(): EpisodeContext {
  const type = normalizeType(process.env.EPISODE_TYPE);
  if (type === "company-profile") {
    const companyName = (
      process.env.COMPANY_NAME ||
      process.env.PROFILE_COMPANY ||
      ""
    ).trim();
    if (!companyName) {
      throw new Error(
        "COMPANY_NAME is required when EPISODE_TYPE=company-profile"
      );
    }
    return { type, companyName };
  }
  return { type };
}

export function episodeContextFromMetadata(metadata: {
  episodeType?: EpisodeType;
  companyName?: string;
}): EpisodeContext | null {
  if (!metadata.episodeType) return null;
  if (metadata.episodeType === "company-profile") {
    if (!metadata.companyName) {
      throw new Error("company-profile metadata is missing companyName");
    }
    return { type: metadata.episodeType, companyName: metadata.companyName };
  }
  return { type: metadata.episodeType };
}

export function describeEpisodeContext(ctx = getEpisodeContext()): string {
  if (ctx.type === "company-profile") {
    return `company-profile (${ctx.companyName})`;
  }
  return "news";
}

export function promptPath(
  stage: "analyze" | "fact-check" | "script",
  ctx = getEpisodeContext(),
): string {
  const fileName =
    ctx.type === "company-profile"
      ? `${stage}-company-profile.md`
      : `${stage}.md`;
  return path.resolve("prompts", fileName);
}

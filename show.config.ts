import type { ShowConfig } from "./src/show.js";

const show: ShowConfig = {
  podcast: {
    title: "Layer Lines Weekly",
    description:
      "The practical additive manufacturing news brief. What matters, what's hype, and what it means for builders.",
    siteUrl: "https://szabadkai.github.io/podcastEngine",
    feedUrl: "https://szabadkai.github.io/podcastEngine/feed.xml",
    imageUrl: "https://szabadkai.github.io/podcastEngine/artwork.png",
    language: "en",
    author: "Layer Lines Weekly",
    ownerName: "Layer Lines Weekly",
    ownerEmail: "levente@szabadkai.com",
    category: "Technology",
    explicit: false,
  },

  sources: [
    {
      name: "TCT Magazine",
      url: "https://www.tctmagazine.com/rss/",
    },
    {
      name: "VoxelMatters",
      url: "https://www.voxelmatters.com/feed/",
    },
    {
      name: "3D Printing Industry",
      url: "https://3dprintingindustry.com/feed/",
    },
  ],

  speakers: [
    { id: "alex", displayName: "Alex" },
    { id: "jordan", displayName: "Jordan" },
  ],

  voices: {
    edge: {
      alex: { voice: "en-US-EmmaMultilingualNeural", rate: "+0%", pitch: "+0Hz" },
      jordan: { voice: "en-GB-RyanNeural", rate: "+0%", pitch: "+0Hz" },
    },
    kokoro: {
      alex: { voice: "af_bella", speed: 1.0 },
      jordan: { voice: "bm_daniel", speed: 1.0 },
    },
    chatterbox: {
      alex: { audioPrompt: "", exaggeration: 0.5, cfgWeight: 0.5 },
      jordan: { audioPrompt: "assets/voices/jordan-ref.wav", exaggeration: 0.4, cfgWeight: 0.5 },
    },
    piper: {
      alex: { model: "en_US-amy-medium", lengthScale: 1.0 },
      jordan: { model: "en_US-joe-medium", lengthScale: 1.0 },
    },
    elevenlabs: {
      alex: {
        voiceId: "SF9uvIlY93SJRMdV5jeP",
        stability: 0.35,
        similarityBoost: 0.75,
        style: 0.55,
      },
      jordan: {
        voiceId: "RNnkVeW25AwKYxZgnHBH",
        stability: 0.40,
        similarityBoost: 0.75,
        style: 0.40,
      },
    },
  },

  episode: {
    targetMinutes: 17,
    storyWindowDays: 7,
    fallbackWindowDays: 14,
    minStories: 3,
    maxSeenUrls: 500,
    continuityWindow: 8,
  },

  guidPrefix: "layer-lines-weekly",
  domain: "3D printing and additive manufacturing",
  continuityStopwords: [
    "3d", "printing", "printer", "printers", "print", "additive", "manufacturing",
    "am", "material", "materials", "tech", "technology", "industry", "company",
  ],
};

export default show;

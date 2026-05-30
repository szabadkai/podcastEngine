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
    podcastGuid: "1aa65aa4-6725-411a-8b5c-a109f9cf36b6",
  },

  sources: [
    // ── Core AM news ────────────────────────────────────────────────────
    { name: "3D Printing Industry", url: "https://3dprintingindustry.com/feed/" },
    { name: "VoxelMatters", url: "https://www.voxelmatters.com/feed/" },
    { name: "TCT Magazine", url: "https://www.tctmagazine.com/feed/" },
    { name: "3DPrint.com", url: "https://3dprint.com/feed/" },
    { name: "Fabbaloo", url: "https://www.fabbaloo.com/feed" },
    { name: "3Dnatives", url: "https://www.3dnatives.com/en/feed/" },

    // ── Maker / practical ───────────────────────────────────────────────
    { name: "Hackaday 3DP", url: "https://hackaday.com/category/3d-printer-hacks/feed/", type: "maker" },

    // ── Vendor blogs ────────────────────────────────────────────────────
    { name: "Prusa Blog", url: "https://blog.prusa3d.com/feed/", type: "vendor" },
    { name: "Bambu Lab Blog", url: "https://blog.bambulab.com/feed/", type: "vendor" },
    { name: "Stratasys IR", url: "https://investors.stratasys.com/rss/news-releases.xml", type: "vendor" },
    { name: "Slant 3D Blog", url: "https://www.slant3d.com/blog-feed.xml", type: "vendor" },
    { name: "ELEGOO Blog", url: "https://www.elegoo.com/blogs/news.atom", type: "vendor" },
    { name: "Anycubic Blog", url: "https://store.anycubic.com/blogs/news.atom", type: "vendor" },
    // MatterHackers: feed returns malformed XML, skipped for now

    // ── Community (Reddit top/week) ─────────────────────────────────────
    { name: "r/3Dprinting", url: "https://www.reddit.com/r/3Dprinting/top/.rss?t=week", type: "community" },
    { name: "r/functionalprint", url: "https://www.reddit.com/r/functionalprint/top/.rss?t=week", type: "community" },
    { name: "r/AdditiveManufacturing", url: "https://www.reddit.com/r/AdditiveManufacturing/top/.rss?t=week", type: "community" },
    { name: "r/BambuLab", url: "https://www.reddit.com/r/BambuLab/top/.rss?t=week", type: "community" },
    { name: "r/prusa3d", url: "https://www.reddit.com/r/prusa3d/top/.rss?t=week", type: "community" },
    { name: "r/resinprinting", url: "https://www.reddit.com/r/resinprinting/top/.rss?t=week", type: "community" },

    // ── Discovery (Google News) ─────────────────────────────────────────
    {
      name: "GNews AM",
      url: "https://news.google.com/rss/search?q=%223D+printing%22+OR+%22additive+manufacturing%22&hl=en-US&gl=US&ceid=US:en",
      type: "discovery",
    },
    {
      name: "GNews Metal AM",
      url: "https://news.google.com/rss/search?q=%22laser+powder+bed+fusion%22+OR+LPBF+OR+%22metal+additive+manufacturing%22&hl=en-US&gl=US&ceid=US:en",
      type: "discovery",
    },
    {
      name: "GNews AM Companies",
      url: "https://news.google.com/rss/search?q=%22Formlabs%22+OR+%22Bambu+Lab%22+OR+%22Prusa%22+OR+%22Stratasys%22+OR+%22Desktop+Metal%22+OR+%22EOS%22+OR+%223D+Systems%22&hl=en-US&gl=US&ceid=US:en",
      type: "discovery",
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
    maxSeenUrls: 2000,
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

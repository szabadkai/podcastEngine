export const config = {
  podcast: {
    title: "Layer Lines Weekly",
    description:
      "The practical additive manufacturing news brief. What matters, what's hype, and what it means for builders.",
    siteUrl: "https://github.com/szabadkai/podcastEngine",
    language: "en",
    author: "Layer Lines Weekly",
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

  ai: {
    baseUrl: "https://openrouter.ai/api/v1",
    model: "deepseek/deepseek-v4-pro",
    scriptModel: "deepseek/deepseek-v4-pro",
    recapModel: "deepseek/deepseek-v4-pro",
    maxRetries: 3,
    retryDelayMs: 2000,
  },

  // TTS backend:
  //   "edge"       — free, natural Microsoft neural voices, no API key (recommended)
  //   "kokoro"     — free, fully local, high quality (heavier; needs model download + espeak-ng)
  //   "chatterbox" — free, fully local, expressive (PyTorch; supports [laugh]/[cough] tags; slow on CPU)
  //   "piper"      — free, fully local/offline, flatter quality
  //   "elevenlabs" — paid, best quality
  ttsProvider: "edge" as
    | "edge"
    | "kokoro"
    | "chatterbox"
    | "piper"
    | "elevenlabs",

  // Which providers natively interpret expressive tags like [laugh], [cough], [chuckle].
  // For providers not listed here, tags are stripped before synthesis (see stage 04b / 05).
  tagSupport: {
    chatterbox: true,
    elevenlabs: true,
    edge: false,
    kokoro: false,
    piper: false,
  } as Record<string, boolean>,

  // Kokoro voices (used when ttsProvider === "kokoro").
  // Full voice list: https://github.com/thewh1teagle/kokoro-onnx
  kokoroVoices: {
    alex: { voice: "af_sarah", speed: 1.0 },
    jordan: { voice: "am_adam", speed: 1.0 },
  },
  // Directory holding kokoro-v1.0.onnx and voices-v1.0.bin (run scripts/setup-kokoro.sh to populate)
  kokoroModelDir: "~/.local/share/kokoro",

  // Chatterbox voices (used when ttsProvider === "chatterbox").
  // Zero-shot voice cloning: point each host at a ~5-10s reference WAV (16kHz+ mono).
  // Leave audioPrompt empty ("") to use the model's default voice.
  // exaggeration controls expressiveness (0.0-1.0); cfgWeight controls pacing/fidelity.
  chatterboxVoices: {
    // Alex uses Chatterbox's expressive default voice (no reference clip).
    alex: { audioPrompt: "", exaggeration: 0.5, cfgWeight: 0.5 },
    // Jordan clones a drier British-male reference to stay distinct from the default.
    jordan: { audioPrompt: "assets/voices/jordan-ref.wav", exaggeration: 0.4, cfgWeight: 0.5 },
  },

  // Edge-TTS voices (used when ttsProvider === "edge").
  // Browse all voices with: edge-tts --list-voices
  edgeVoices: {
    alex: { voice: "en-US-AriaNeural", rate: "+0%", pitch: "+0Hz" },
    jordan: { voice: "en-US-GuyNeural", rate: "+0%", pitch: "+0Hz" },
  },

  // ElevenLabs voice settings (used when ttsProvider === "elevenlabs")
  elevenlabsVoices: {
    alex: {
      voiceId: "pNInz6obpgDQGcFmaJgB",
      stability: 0.5,
      similarityBoost: 0.75,
      style: 0.3,
    },
    jordan: {
      voiceId: "ErXwobaYiN019PkySvjV",
      stability: 0.5,
      similarityBoost: 0.75,
      style: 0.2,
    },
  },

  // Piper voice models (used when ttsProvider === "piper").
  // Models are downloaded to piperDataDir; the .onnx filename (minus extension) is the model name.
  piperVoices: {
    alex: { model: "en_US-amy-medium", lengthScale: 1.0 },
    jordan: { model: "en_US-joe-medium", lengthScale: 1.0 },
  },
  piperDataDir: "~/.local/share/piper-voices",

  audio: {
    model: "eleven_flash_v2_5",
    outputFormat: "mp3_44100_128",
    chunkMaxChars: 5000,
    delayBetweenChunksMs: 500,
  },

  episode: {
    targetMinutes: 17,
    storyWindowDays: 7,
    fallbackWindowDays: 14,
    minStories: 3,
    maxSeenUrls: 500,
    // How many recent episode recaps to feed into the script prompt for continuity.
    continuityWindow: 8,
  },
} as const;

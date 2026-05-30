import type { ShowConfig } from "./show.js";

export const engineConfig = {
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
  ttsProvider: "elevenlabs" as
    | "edge"
    | "kokoro"
    | "chatterbox"
    | "piper"
    | "elevenlabs",

  tagSupport: {
    chatterbox: true,
    elevenlabs: false,
    edge: false,
    kokoro: false,
    piper: false,
  } as Record<string, boolean>,

  kokoroModelDir: "~/.local/share/kokoro",
  piperDataDir: "~/.local/share/piper-voices",

  audio: {
    model: "eleven_multilingual_v2",
    outputFormat: "mp3_44100_128",
    chunkMaxChars: 5000,
    delayBetweenChunksMs: 500,
  },
} as const;

export type Config = typeof engineConfig & ShowConfig;

let _config: Config | null = null;

export function setShowConfig(show: ShowConfig): void {
  _config = { ...engineConfig, ...show };
}

export const config = new Proxy({} as Config, {
  get(_target, prop, receiver) {
    if (!_config)
      throw new Error("Config not initialized — call loadShow() first");
    return Reflect.get(_config, prop, receiver);
  },
});

import { config } from "../config.js";

const BASE_URL = "https://api.elevenlabs.io/v1";

interface TtsOptions {
  voiceId: string;
  text: string;
  stability?: number;
  similarityBoost?: number;
  style?: number;
  previousText?: string;
  nextText?: string;
  previousRequestIds?: string[];
}

interface TtsResult {
  audio: Buffer;
  requestId: string;
}

export async function textToSpeech(opts: TtsOptions): Promise<TtsResult> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY not set");

  const body: Record<string, unknown> = {
    text: opts.text,
    model_id: config.audio.model,
    voice_settings: {
      stability: opts.stability ?? 0.5,
      similarity_boost: opts.similarityBoost ?? 0.75,
      style: opts.style ?? 0.0,
    },
  };

  if (config.audio.pronunciationDictionaryLocators.length) {
    body.pronunciation_dictionary_locators =
      config.audio.pronunciationDictionaryLocators;
  }

  if (opts.previousText) body.previous_text = opts.previousText;
  if (opts.nextText) body.next_text = opts.nextText;

  if (opts.previousRequestIds?.length) {
    body.previous_request_ids = opts.previousRequestIds.slice(-3);
  }

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < config.ai.maxRetries; attempt++) {
    if (attempt > 0) {
      const delay = config.ai.retryDelayMs * Math.pow(2, attempt - 1);
      console.log(`  TTS retry ${attempt}/${config.ai.maxRetries} after ${delay}ms...`);
      await new Promise((r) => setTimeout(r, delay));
    }

    const res = await fetch(
      `${BASE_URL}/text-to-speech/${opts.voiceId}?output_format=${config.audio.outputFormat}`,
      {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      }
    );

    if (!res.ok) {
      const text = await res.text();
      lastError = new Error(`ElevenLabs ${res.status}: ${text}`);
      if (res.status === 429 || res.status >= 500) continue;
      throw lastError;
    }

    const requestId = res.headers.get("request-id") || "";
    const arrayBuf = await res.arrayBuffer();
    return {
      audio: Buffer.from(arrayBuf),
      requestId,
    };
  }

  throw lastError || new Error("TTS call failed after retries");
}

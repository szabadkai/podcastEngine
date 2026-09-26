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

export interface CreditQuota {
  used: number;
  limit: number;
  remaining: number;
  resetsAt: Date | null;
}

// Reads the plan's credit counter. Returns null when it cannot be read (a key
// without the user_read permission, a network error, an unexpected shape) so
// a restricted key never blocks an episode on a check that is advisory.
export async function getCreditQuota(): Promise<CreditQuota | null> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY not set");

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}/user/subscription`, {
      headers: { "xi-api-key": apiKey },
    });
  } catch (err) {
    console.warn(`  ElevenLabs quota check failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
  if (!res.ok) {
    console.warn(`  ElevenLabs quota check returned ${res.status}; skipping it.`);
    return null;
  }

  const data = (await res.json().catch(() => null)) as {
    character_count?: unknown;
    character_limit?: unknown;
    next_character_count_reset_unix?: unknown;
  } | null;
  const used = data?.character_count;
  const limit = data?.character_limit;
  if (typeof used !== "number" || typeof limit !== "number") return null;
  const reset = data?.next_character_count_reset_unix;
  return {
    used,
    limit,
    remaining: Math.max(0, limit - used),
    resetsAt: typeof reset === "number" ? new Date(reset * 1000) : null,
  };
}

export function describeQuota(quota: CreditQuota): string {
  const reset = quota.resetsAt
    ? `, resets ${quota.resetsAt.toISOString().slice(0, 10)}`
    : "";
  return `${quota.remaining} of ${quota.limit} credits remaining${reset}`;
}

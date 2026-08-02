import { config } from "../config.js";

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

// OpenRouter's unified reasoning control. For reasoning models (e.g. Claude
// Opus 4.8) reasoning tokens are output tokens drawn from max_tokens, so an
// unbounded thinking pass can consume the whole budget and truncate the visible
// answer. Bound it with `max_tokens` (a hard budget) or `effort`/`enabled`.
interface ReasoningConfig {
  effort?: "xhigh" | "high" | "medium" | "low" | "minimal" | "none";
  max_tokens?: number;
  enabled?: boolean;
  exclude?: boolean;
}

interface ChatOptions {
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
  model?: string;
  reasoning?: ReasoningConfig;
}

// Hard ceiling when escalating after a truncation — Claude Opus 4.8's max output.
const MAX_OUTPUT_TOKENS = 128000;

export async function chat(opts: ChatOptions): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY not set");

  // Working cap: starts at the requested value and grows if the model truncates
  // at the limit. Re-sending the identical request after a length-truncation
  // would just truncate again — the retry only helps if it has more room.
  let maxTokens = opts.maxTokens ?? 4096;

  const buildBody = (): Record<string, unknown> => {
    const body: Record<string, unknown> = {
      model: opts.model ?? config.ai.model,
      messages: opts.messages,
      temperature: opts.temperature ?? 0.3,
      max_tokens: maxTokens,
    };
    if (opts.jsonMode) body.response_format = { type: "json_object" };
    if (opts.reasoning) body.reasoning = opts.reasoning;
    return body;
  };

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < config.ai.maxRetries; attempt++) {
    if (attempt > 0) {
      const delay = config.ai.retryDelayMs * Math.pow(2, attempt - 1);
      console.log(`  Retry ${attempt}/${config.ai.maxRetries} after ${delay}ms...`);
      await new Promise((r) => setTimeout(r, delay));
    }

    let res: Response;
    try {
      res = await fetch(`${config.ai.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": config.podcast.siteUrl,
          "X-Title": config.podcast.title,
        },
        body: JSON.stringify(buildBody()),
      });
    } catch (err) {
      lastError = new Error(
        `OpenRouter request failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      continue;
    }

    // Read the body once and parse it ourselves. A provider or proxy can
    // occasionally close a nominally successful response mid-transfer; calling
    // res.json() would throw outside the retry path and abort the whole episode.
    let responseText: string;
    try {
      responseText = await res.text();
    } catch (err) {
      lastError = new Error(
        `OpenRouter response body failed while reading: ${err instanceof Error ? err.message : String(err)}`,
      );
      continue;
    }

    if (!res.ok) {
      lastError = new Error(`OpenRouter ${res.status}: ${responseText}`);

      if (res.status === 429 || res.status >= 500) continue;
      throw lastError;
    }

    let data: {
      choices: Array<{ message: { content: string }; finish_reason?: string }>;
    };
    try {
      data = JSON.parse(responseText) as typeof data;
    } catch (err) {
      lastError = new Error(
        `OpenRouter returned malformed response JSON: ${err instanceof Error ? err.message : String(err)}`,
      );
      continue;
    }

    const choice = Array.isArray(data.choices) ? data.choices[0] : undefined;
    if (!choice || typeof choice.message?.content !== "string") {
      lastError = new Error("OpenRouter response did not contain a message choice");
      continue;
    }
    // Truncated at the cap. A reasoning model spends part of max_tokens thinking,
    // so the visible answer can run out of room. Grow the cap and retry rather
    // than re-sending the same doomed request. (Bounding `reasoning` at the call
    // site is the primary guard; this is the safety net if the estimate is off.)
    if (choice.finish_reason === "length") {
      if (maxTokens >= MAX_OUTPUT_TOKENS) {
        lastError = new Error(
          `OpenRouter response truncated at max_tokens=${maxTokens} (model ceiling); reduce reasoning budget or shorten the request`,
        );
        break;
      }
      maxTokens = Math.min(maxTokens * 2, MAX_OUTPUT_TOKENS);
      lastError = new Error(
        `OpenRouter response truncated (finish_reason=length); retrying with max_tokens=${maxTokens}`,
      );
      continue;
    }
    return choice.message.content;
  }

  throw lastError || new Error("AI call failed after retries");
}

export async function chatJson<T>(opts: ChatOptions): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < config.ai.maxRetries; attempt++) {
    const raw = await chat({ ...opts, jsonMode: true });
    const cleaned = raw
      .replace(/^```json\s*\n?/, "")
      .replace(/\n?```\s*$/, "")
      .trim();
    try {
      return JSON.parse(cleaned) as T;
    } catch (err) {
      // Malformed/truncated JSON: retry the whole call. Reasoning models
      // occasionally emit partial output even under finish_reason=stop.
      lastError = err as Error;
      console.log(
        `  JSON parse failed (attempt ${attempt + 1}/${config.ai.maxRetries}): ${(err as Error).message}`,
      );
    }
  }

  throw lastError || new Error("chatJson failed after retries");
}

import { recordAiUsage } from "./ai-usage.js";
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

interface OpenRouterWebSearchTool {
  type: "openrouter:web_search";
  parameters?: {
    engine?: "auto" | "native" | "exa" | "firecrawl" | "parallel" | "perplexity";
    max_results?: number;
    max_total_results?: number;
    search_context_size?: "low" | "medium" | "high";
    allowed_domains?: string[];
    excluded_domains?: string[];
  };
}

interface OpenRouterWebFetchTool {
  type: "openrouter:web_fetch";
  parameters?: {
    engine?: "auto" | "native" | "exa" | "openrouter" | "firecrawl" | "parallel";
    max_uses?: number;
    max_content_tokens?: number;
    allowed_domains?: string[];
    blocked_domains?: string[];
  };
}

type OpenRouterTool = OpenRouterWebSearchTool | OpenRouterWebFetchTool;

interface ChatOptions {
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  maxOutputTokens?: number;
  label?: string;
  jsonMode?: boolean;
  model?: string;
  reasoning?: ReasoningConfig;
  tools?: OpenRouterTool[];
  toolChoice?: "auto" | "required" | "none";
}

// One bounded budget covers transport, truncation, and JSON validation retries.
const MAX_OUTPUT_TOKENS = 48000;
// A long-form request retried below this floor is likely to spend the last
// credits on a truncated response. Fail clearly instead of making that bet.
const MIN_AFFORDABLE_RETRY_TOKENS = 8192;

function affordableTokenLimit(responseText: string): number | null {
  try {
    const data = JSON.parse(responseText) as {
      error?: { message?: string };
    };
    const match = data.error?.message?.match(/can only afford\s+(\d+)/i);
    if (!match) return null;
    const value = Number(match[1]);
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

async function request<T>(opts: ChatOptions, decode: (raw: string) => T): Promise<T> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY not set");

  // Working cap: starts at the requested value and grows if the model truncates
  // at the limit. Re-sending the identical request after a length-truncation
  // would just truncate again — the retry only helps if it has more room.
  const requestedMaxTokens = opts.maxTokens ?? 4096;
  const ceiling = Math.min(opts.maxOutputTokens ?? requestedMaxTokens * 2, MAX_OUTPUT_TOKENS);
  if (requestedMaxTokens > ceiling) throw new Error("Requested tokens exceed the output ceiling");
  let maxTokens = requestedMaxTokens;
  let retryAfterMs = 0;

  const buildBody = (): Record<string, unknown> => {
    const body: Record<string, unknown> = {
      model: opts.model ?? config.ai.model,
      messages: opts.messages,
      max_tokens: maxTokens,
    };
    // Omitted when unset: current Claude models reject sampling parameters,
    // and some OpenRouter providers forward them instead of dropping them.
    if (opts.temperature !== undefined) body.temperature = opts.temperature;
    if (opts.jsonMode) body.response_format = { type: "json_object" };
    if (opts.reasoning) {
      const reasoning = { ...opts.reasoning };
      if (
        maxTokens < requestedMaxTokens &&
        typeof reasoning.max_tokens === "number"
      ) {
        // When the provider lowers the total output allowance, keep reasoning
        // from consuming the entire affordable budget before visible JSON is
        // produced. Preserve the caller's original cap on normal requests.
        reasoning.max_tokens = Math.min(
          reasoning.max_tokens,
          Math.max(512, Math.floor(maxTokens * 0.25)),
        );
      }
      body.reasoning = reasoning;
    }
    if (opts.tools?.length) body.tools = opts.tools;
    if (opts.toolChoice) body.tool_choice = opts.toolChoice;
    return body;
  };

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < config.ai.maxRetries; attempt++) {
    if (attempt > 0) {
      const delay = Math.max(retryAfterMs, config.ai.retryDelayMs * Math.pow(2, attempt - 1));
      retryAfterMs = 0;
      console.log(`  Retry ${attempt}/${config.ai.maxRetries} after ${delay}ms...`);
      await new Promise((r) => setTimeout(r, delay));
    }

    const started = Date.now();
    const record = (details: Record<string, unknown>) => recordAiUsage({
      label: opts.label, model: opts.model ?? config.ai.model, attempt: attempt + 1,
      maxTokens, elapsedMs: Date.now() - started, ...details,
    });
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
      record({ outcome: "network-error" });
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
      record({ outcome: "body-error", status: res.status });
      continue;
    }

    if (!res.ok) {
      lastError = new Error(`OpenRouter ${res.status}: ${responseText}`);

      record({ outcome: "http-error", status: res.status });
      if (res.status === 402 && /in_flight_budget|in-flight requests/i.test(responseText)) {
        retryAfterMs = retryDelay(res.headers.get("retry-after"), responseText, 120000);
        continue;
      }
      if (res.status === 402) {
        const affordable = affordableTokenLimit(responseText);
        const reducedMaxTokens = affordable
          ? Math.min(maxTokens - 1, Math.floor(affordable * 0.98))
          : 0;
        const retryFloor = Math.min(
          requestedMaxTokens,
          MIN_AFFORDABLE_RETRY_TOKENS,
        );
        if (reducedMaxTokens >= retryFloor) {
          maxTokens = reducedMaxTokens;
          console.warn(
            `  OpenRouter credit limit: retrying with max_tokens=${maxTokens}.`,
          );
          continue;
        }
      }
      if (res.status === 429 || res.status >= 500) {
        retryAfterMs = retryDelay(res.headers.get("retry-after"), responseText, 0);
        continue;
      }
      throw lastError;
    }

    let data: {
      id?: string;
      model?: string;
      usage?: Record<string, unknown>;
      choices?: Array<{
        message?: { content?: string | null };
        finish_reason?: string;
      }>;
      error?: string | { message?: string; code?: string | number };
    };
    try {
      data = JSON.parse(responseText) as typeof data;
    } catch (err) {
      lastError = new Error(
        `OpenRouter returned malformed response JSON: ${err instanceof Error ? err.message : String(err)}`,
      );
      record({ outcome: "malformed-response", status: res.status });
      continue;
    }

    const choice = Array.isArray(data.choices) ? data.choices[0] : undefined;
    const usage = { generationId: data.id, actualModel: data.model, usage: data.usage };
    // Truncated at the cap. A reasoning model spends part of max_tokens thinking,
    // so the visible answer can run out of room. Grow the cap and retry rather
    // than re-sending the same doomed request. (Bounding `reasoning` at the call
    // site is the primary guard; this is the safety net if the estimate is off.)
    // Checked before the content: when thinking consumes the whole budget the
    // provider returns null content, which is still a truncation.
    if (choice?.finish_reason === "length") {
      record({ ...usage, outcome: "truncated" });
      if (maxTokens >= ceiling) {
        lastError = new Error(
          `OpenRouter response truncated at max_tokens=${maxTokens} (request ceiling); reduce reasoning budget or shorten the request`,
        );
        break;
      }
      maxTokens = Math.min(maxTokens * 2, ceiling);
      lastError = new Error(
        `OpenRouter response truncated (finish_reason=length); retrying with max_tokens=${maxTokens}`,
      );
      continue;
    }
    const content = choice?.message?.content;
    if (typeof content !== "string") {
      record({ ...usage, outcome: "missing-choice" });
      const providerError =
        typeof data.error === "string"
          ? data.error
          : data.error?.message || data.error?.code
            ? [data.error.message, data.error.code && `code=${data.error.code}`]
                .filter(Boolean)
                .join("; ")
            : "no provider error details";
      lastError = new Error(
        `OpenRouter response did not contain a message choice (${providerError}; finish_reason=${choice?.finish_reason ?? "none"})`,
      );
      continue;
    }
    try {
      const result = decode(content);
      record({ ...usage, outcome: "success" });
      return result;
    } catch (err) {
      lastError = new Error(`JSON parse/validation failed: ${(err as Error).message}`);
      record({ ...usage, outcome: "invalid-json" });
      console.warn(lastError.message);
    }
  }

  throw lastError || new Error("AI call failed after retries");
}

export async function chat(opts: ChatOptions): Promise<string> {
  return request(opts, (raw) => raw);
}

export async function chatJson<T>(
  opts: ChatOptions & { validate?: (value: unknown) => T },
): Promise<T> {
  return request({ ...opts, jsonMode: true }, (raw) => {
    const cleaned = raw.replace(/^```json\s*\n?/, "").replace(/\n?```\s*$/, "").trim();
    const parsed: unknown = JSON.parse(cleaned);
    return opts.validate ? opts.validate(parsed) : parsed as T;
  });
}

// Providers sometimes put Retry-After inside the error metadata instead of HTTP headers.
export function retryDelay(header: string | null, body: string, fallback: number): number {
  let value = header;
  if (!value) {
    try { value = JSON.parse(body).error?.metadata?.headers?.["Retry-After"]; } catch { /* use fallback */ }
  }
  if (!value) return fallback;
  const seconds = Number(value);
  const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - Date.now();
  return Number.isFinite(delay) && delay >= 0 ? delay : fallback;
}

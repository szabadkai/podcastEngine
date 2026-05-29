import { config } from "../config.js";

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatOptions {
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
  model?: string;
}

export async function chat(opts: ChatOptions): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY not set");

  const body: Record<string, unknown> = {
    model: opts.model ?? config.ai.model,
    messages: opts.messages,
    temperature: opts.temperature ?? 0.3,
    max_tokens: opts.maxTokens ?? 4096,
  };
  if (opts.jsonMode) {
    body.response_format = { type: "json_object" };
  }

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < config.ai.maxRetries; attempt++) {
    if (attempt > 0) {
      const delay = config.ai.retryDelayMs * Math.pow(2, attempt - 1);
      console.log(`  Retry ${attempt}/${config.ai.maxRetries} after ${delay}ms...`);
      await new Promise((r) => setTimeout(r, delay));
    }

    const res = await fetch(`${config.ai.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": config.podcast.siteUrl,
        "X-Title": config.podcast.title,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      lastError = new Error(`OpenRouter ${res.status}: ${text}`);

      if (res.status === 429 || res.status >= 500) continue;
      throw lastError;
    }

    const data = (await res.json()) as {
      choices: Array<{ message: { content: string } }>;
    };
    return data.choices[0].message.content;
  }

  throw lastError || new Error("AI call failed after retries");
}

export async function chatJson<T>(opts: ChatOptions): Promise<T> {
  const raw = await chat({ ...opts, jsonMode: true });
  const cleaned = raw.replace(/^```json\s*\n?/, "").replace(/\n?```\s*$/, "");
  return JSON.parse(cleaned) as T;
}

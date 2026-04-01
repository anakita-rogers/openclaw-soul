import { createSoulLogger } from "./logger.js";

const log = createSoulLogger("search");

// --- Public types ---

export interface SoulSearchResult {
  title: string;
  url: string;
  snippet: string;
  summary?: string;
}

/**
 * OpenClaw config subset needed for auto-discovering search providers.
 * Matches the structure of `tools.web.search` in openclaw.yaml.
 */
export type OpenClawSearchCompat = {
  tools?: {
    web?: {
      search?: {
        provider?: string;
        apiKey?: string | { secret?: string };
        brave?: { mode?: string };
        gemini?: { apiKey?: string | { secret?: string }; model?: string };
        grok?: { apiKey?: string | { secret?: string }; model?: string };
        kimi?: { apiKey?: string | { secret?: string }; baseUrl?: string; model?: string };
        perplexity?: { apiKey?: string | { secret?: string }; baseUrl?: string; model?: string };
      };
    };
  };
  skills?: { entries?: Record<string, Record<string, unknown>> };
};

/** The search config subsection type (tools.web.search) */
type SearchConfig = NonNullable<NonNullable<NonNullable<OpenClawSearchCompat["tools"]>["web"]>["search"]>;

type ProviderName = "brave" | "gemini" | "grok" | "kimi" | "perplexity" | "bocha";

// --- API key resolution helpers ---

function resolveSecret(value: string | { secret?: string } | undefined): string | undefined {
  if (!value) return undefined;
  if (typeof value === "string") return value.trim() || undefined;
  if (typeof value === "object" && "secret" in value) {
    const secret = value.secret;
    if (typeof secret === "string" && secret.startsWith("env:")) {
      return process.env[secret.slice(4)]?.trim() || undefined;
    }
    return undefined;
  }
  return undefined;
}

function resolveBraveApiKey(search: SearchConfig | undefined): string | undefined {
  return resolveSecret(search?.apiKey) || process.env.BRAVE_API_KEY?.trim() || undefined;
}

function resolveGeminiApiKey(search: SearchConfig | undefined): string | undefined {
  return resolveSecret(search?.gemini?.apiKey) || process.env.GEMINI_API_KEY?.trim() || undefined;
}

function resolveGrokApiKey(search: SearchConfig | undefined): string | undefined {
  return resolveSecret(search?.grok?.apiKey) || process.env.XAI_API_KEY?.trim() || undefined;
}

function resolveKimiApiKey(search: SearchConfig | undefined): string | undefined {
  return resolveSecret(search?.kimi?.apiKey) || process.env.KIMI_API_KEY?.trim() || process.env.MOONSHOT_API_KEY?.trim() || undefined;
}

function resolvePerplexityApiKey(search: SearchConfig | undefined): string | undefined {
  return resolveSecret(search?.perplexity?.apiKey) || process.env.PERPLEXITY_API_KEY?.trim() || process.env.OPENROUTER_API_KEY?.trim() || undefined;
}

function resolveBochaApiKey(openclawConfig?: OpenClawSearchCompat, pluginKey?: string): string | undefined {
  if (pluginKey?.trim()) return pluginKey.trim();
  if (openclawConfig?.skills?.entries) {
    const bochaEntry = openclawConfig.skills.entries["bocha-web-search"];
    const key = bochaEntry?.apiKey;
    if (typeof key === "string" && key.trim()) return key.trim();
  }
  return process.env.BOCHA_API_KEY?.trim() || undefined;
}

// --- Provider auto-detection ---

function detectProvider(search: SearchConfig | undefined, openclawConfig?: OpenClawSearchCompat): ProviderName | null {
  // 1. Explicit provider setting
  const explicit = search?.provider?.trim().toLowerCase();
  if (explicit === "brave" || explicit === "gemini" || explicit === "grok" || explicit === "kimi" || explicit === "perplexity") {
    return explicit;
  }

  // 2. Auto-detect from available API keys (alphabetical, same as core)
  if (resolveBraveApiKey(search)) return "brave";
  if (resolveGeminiApiKey(search)) return "gemini";
  if (resolveGrokApiKey(search)) return "grok";
  if (resolveKimiApiKey(search)) return "kimi";
  if (resolvePerplexityApiKey(search)) return "perplexity";
  if (resolveBochaApiKey(openclawConfig)) return "bocha";

  return null;
}

// --- Timeout helper ---

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return promise.finally(() => clearTimeout(timer));
}

// --- Provider implementations ---

async function braveSearch(query: string, apiKey: string): Promise<SoulSearchResult[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);

  try {
    const url = new URL("https://api.search.brave.com/res/v1/web/search");
    url.searchParams.set("q", query);
    url.searchParams.set("count", "8");

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Accept: "application/json",
        "X-Subscription-Token": apiKey,
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      log.warn(`Brave API returned ${response.status}`);
      return [];
    }

    const body = (await response.json()) as {
      web?: { results?: Array<{ title?: string; url?: string; description?: string }> };
    };
    const results = body?.web?.results ?? [];

    return results
      .filter((r) => r.title && r.description)
      .map((r) => ({
        title: r.title ?? "",
        url: r.url ?? "",
        snippet: r.description ?? "",
      }));
  } catch (err) {
    if ((err as { name?: string })?.name === "AbortError") {
      log.warn("Brave search timed out (15s)");
    } else {
      log.warn(`Brave search failed: ${String(err)}`);
    }
    return [];
  } finally {
    clearTimeout(timer);
  }
}

async function geminiSearch(query: string, apiKey: string, model?: string): Promise<SoulSearchResult[]> {
  const modelName = model || "gemini-2.5-flash";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);

  try {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent`;

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: query }] }],
        tools: [{ google_search: {} }],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      log.warn(`Gemini API returned ${response.status}`);
      return [];
    }

    const body = (await response.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
        groundingMetadata?: {
          groundingChunks?: Array<{ web?: { uri?: string; title?: string } }>;
        };
      }>;
    };

    const candidate = body.candidates?.[0];
    const text = candidate?.content?.parts?.map((p) => p.text).filter(Boolean).join("\n") ?? "";
    const chunks = candidate?.groundingMetadata?.groundingChunks ?? [];

    return chunks
      .filter((c) => c.web?.uri)
      .map((c) => ({
        title: c.web?.title ?? "",
        url: c.web!.uri!,
        snippet: text.slice(0, 200),
        summary: text,
      }));
  } catch (err) {
    if ((err as { name?: string })?.name === "AbortError") {
      log.warn("Gemini search timed out (20s)");
    } else {
      log.warn(`Gemini search failed: ${String(err)}`);
    }
    return [];
  } finally {
    clearTimeout(timer);
  }
}

async function grokSearch(query: string, apiKey: string, model?: string): Promise<SoulSearchResult[]> {
  const modelName = model || "grok-4-1-fast";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);

  try {
    const response = await fetch("https://api.x.ai/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: modelName,
        input: [{ role: "user", content: query }],
        tools: [{ type: "web_search" }],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      log.warn(`Grok API returned ${response.status}`);
      return [];
    }

    const body = (await response.json()) as {
      output?: Array<{
        type?: string;
        text?: string;
        content?: Array<{ type?: string; text?: string }>;
      }>;
      citations?: string[];
    };

    // Extract text from output
    let text = "";
    for (const output of body.output ?? []) {
      if (output.type === "message") {
        for (const block of output.content ?? []) {
          if (block.type === "output_text" && block.text) {
            text = block.text;
            break;
          }
        }
      }
      if (output.type === "output_text" && output.text) {
        text = output.text;
      }
    }

    const citations = body.citations ?? [];
    if (citations.length > 0) {
      return citations.slice(0, 8).map((url, i) => ({
        title: `Source ${i + 1}`,
        url,
        snippet: text.slice(0, 200),
        summary: text,
      }));
    }

    if (text) {
      return [{ title: "Grok Search", url: "", snippet: text.slice(0, 200), summary: text }];
    }

    return [];
  } catch (err) {
    if ((err as { name?: string })?.name === "AbortError") {
      log.warn("Grok search timed out (20s)");
    } else {
      log.warn(`Grok search failed: ${String(err)}`);
    }
    return [];
  } finally {
    clearTimeout(timer);
  }
}

async function kimiSearch(query: string, apiKey: string, baseUrl?: string, model?: string): Promise<SoulSearchResult[]> {
  const apiBase = (baseUrl || "https://api.moonshot.ai/v1").replace(/\/$/, "");
  const modelName = model || "moonshot-v1-128k";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);

  try {
    // Kimi uses a multi-round tool-calling pattern for web search
    const messages: Array<Record<string, unknown>> = [{ role: "user", content: query }];
    const allCitations: string[] = [];
    const maxRounds = 2;

    for (let round = 0; round < maxRounds; round++) {
      const response = await fetch(`${apiBase}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: modelName,
          messages,
          tools: [{ type: "builtin_function", function: { name: "$web_search" } }],
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        log.warn(`Kimi API returned ${response.status}`);
        return [];
      }

      const body = (await response.json()) as {
        choices?: Array<{
          finish_reason?: string;
          message?: {
            content?: string;
            tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }>;
          };
        }>;
        search_results?: Array<{ title?: string; url?: string; content?: string }>;
      };

      // Collect citations from search_results
      for (const sr of body.search_results ?? []) {
        if (sr.url) allCitations.push(sr.url);
      }

      const choice = body.choices?.[0];
      const message = choice?.message;
      const text = message?.content?.trim() || "";
      const toolCalls = message?.tool_calls ?? [];

      if (choice?.finish_reason !== "tool_calls" || toolCalls.length === 0) {
        // Final answer
        if (allCitations.length > 0) {
          return allCitations.slice(0, 8).map((url, i) => {
            const matchingSr = body.search_results?.find((sr) => sr.url === url);
            return {
              title: matchingSr?.title ?? `Source ${i + 1}`,
              url,
              snippet: matchingSr?.content?.slice(0, 200) ?? text.slice(0, 200),
              summary: text,
            };
          });
        }
        if (text) {
          return [{ title: "Kimi Search", url: "", snippet: text.slice(0, 200), summary: text }];
        }
        return [];
      }

      // Continue multi-round
      messages.push({
        role: "assistant",
        content: text,
        tool_calls: toolCalls,
      });

      const toolContent = JSON.stringify({
        search_results: (body.search_results ?? []).map((sr) => ({
          title: sr.title ?? "",
          url: sr.url ?? "",
          content: sr.content ?? "",
        })),
      });

      for (const tc of toolCalls) {
        if (tc.id) {
          messages.push({ role: "tool", tool_call_id: tc.id, content: toolContent });
        }
      }
    }

    return [];
  } catch (err) {
    if ((err as { name?: string })?.name === "AbortError") {
      log.warn("Kimi search timed out (20s)");
    } else {
      log.warn(`Kimi search failed: ${String(err)}`);
    }
    return [];
  } finally {
    clearTimeout(timer);
  }
}

async function perplexitySearch(
  query: string,
  apiKey: string,
  baseUrl?: string,
  model?: string,
): Promise<SoulSearchResult[]> {
  // Determine if native Search API or OpenRouter chat completions
  const keyPrefix = apiKey.toLowerCase();
  const isNative = keyPrefix.startsWith("pplx-");
  const effectiveBaseUrl = baseUrl?.trim() || (isNative ? "https://api.perplexity.ai" : "https://openrouter.ai/api/v1");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);

  try {
    if (isNative && !baseUrl?.trim()) {
      // Use native Perplexity Search API for structured results
      const response = await fetch("https://api.perplexity.ai/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ query }),
        signal: controller.signal,
      });

      if (!response.ok) {
        log.warn(`Perplexity Search API returned ${response.status}`);
        return [];
      }

      const body = (await response.json()) as {
        results?: Array<{ title?: string; url?: string; snippet?: string }>;
      };

      return (body.results ?? [])
        .filter((r) => r.title || r.snippet)
        .map((r) => ({
          title: r.title ?? "",
          url: r.url ?? "",
          snippet: r.snippet ?? "",
        }));
    }

    // OpenRouter / chat completions path
    const apiBase = effectiveBaseUrl.replace(/\/$/, "");
    const modelName = model || "perplexity/sonar-pro";

    const response = await fetch(`${apiBase}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: modelName,
        messages: [{ role: "user", content: query }],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      log.warn(`Perplexity chat API returned ${response.status}`);
      return [];
    }

    const body = (await response.json()) as {
      choices?: Array<{
        message?: {
          content?: string;
          annotations?: Array<{ type?: string; url_citation?: { url?: string; title?: string } }>;
        };
      }>;
      citations?: string[];
    };

    const content = body.choices?.[0]?.message?.content ?? "";
    const citations = body.citations ?? [];
    const annotations = body.choices?.[0]?.message?.annotations ?? [];

    // Build results from annotations or citations
    if (annotations.length > 0) {
      return annotations
        .filter((a) => a.type === "url_citation" && a.url_citation?.url)
        .map((a) => ({
          title: a.url_citation?.title ?? "",
          url: a.url_citation!.url!,
          snippet: content.slice(0, 200),
          summary: content,
        }));
    }

    if (citations.length > 0) {
      return citations.slice(0, 8).map((url, i) => ({
        title: `Source ${i + 1}`,
        url,
        snippet: content.slice(0, 200),
        summary: content,
      }));
    }

    if (content) {
      return [{ title: "Perplexity Search", url: "", snippet: content.slice(0, 200), summary: content }];
    }

    return [];
  } catch (err) {
    if ((err as { name?: string })?.name === "AbortError") {
      log.warn("Perplexity search timed out (20s)");
    } else {
      log.warn(`Perplexity search failed: ${String(err)}`);
    }
    return [];
  } finally {
    clearTimeout(timer);
  }
}

async function bochaSearch(query: string, apiKey: string): Promise<SoulSearchResult[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);

  try {
    const response = await fetch("https://api.bocha.cn/v1/web-search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        freshness: "noLimit",
        summary: true,
        count: 10,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      log.warn(`Bocha API returned ${response.status}`);
      return [];
    }

    const body = (await response.json()) as {
      data?: {
        webPages?: {
          value?: Array<{
            name?: string;
            url?: string;
            snippet?: string;
            summary?: string;
          }>;
        };
      };
    };

    const results = body?.data?.webPages?.value ?? [];
    return results
      .filter((r) => r.name && r.snippet)
      .map((r) => ({
        title: r.name ?? "",
        url: r.url ?? "",
        snippet: r.snippet ?? "",
        summary: r.summary,
      }));
  } catch (err) {
    if ((err as { name?: string })?.name === "AbortError") {
      log.warn("Bocha search timed out (15s)");
    } else {
      log.warn(`Bocha search failed: ${String(err)}`);
    }
    return [];
  } finally {
    clearTimeout(timer);
  }
}

// --- Main entry point ---

/**
 * Perform web search using whatever provider OpenClaw has configured.
 * Auto-discovers provider and API key from OpenClaw config.
 */
export async function soulWebSearch(
  query: string,
  openclawConfig?: OpenClawSearchCompat,
): Promise<SoulSearchResult[] | null> {
  const search = openclawConfig?.tools?.web?.search;
  const provider = detectProvider(search, openclawConfig);

  if (!provider) {
    log.info(`No search provider available for query: "${query.slice(0, 60)}"`);
    return null;
  }

  log.info(`Searching via ${provider}: "${query.slice(0, 60)}"`);

  let results: SoulSearchResult[];

  switch (provider) {
    case "brave": {
      const apiKey = resolveBraveApiKey(search)!;
      results = await braveSearch(query, apiKey);
      break;
    }
    case "gemini": {
      const apiKey = resolveGeminiApiKey(search)!;
      const model = search?.gemini?.model;
      results = await geminiSearch(query, apiKey, model);
      break;
    }
    case "grok": {
      const apiKey = resolveGrokApiKey(search)!;
      const model = search?.grok?.model;
      results = await grokSearch(query, apiKey, model);
      break;
    }
    case "kimi": {
      const apiKey = resolveKimiApiKey(search)!;
      const baseUrl = search?.kimi?.baseUrl;
      const model = search?.kimi?.model;
      results = await kimiSearch(query, apiKey, baseUrl, model);
      break;
    }
    case "perplexity": {
      const apiKey = resolvePerplexityApiKey(search)!;
      const baseUrl = search?.perplexity?.baseUrl;
      const model = search?.perplexity?.model;
      results = await perplexitySearch(query, apiKey, baseUrl, model);
      break;
    }
    case "bocha": {
      const apiKey = resolveBochaApiKey(openclawConfig)!;
      results = await bochaSearch(query, apiKey);
      break;
    }
    default:
      return null;
  }

  if (results.length > 0) {
    log.info(`${provider} returned ${results.length} results`);
    return results;
  }

  log.info(`${provider} returned no results`);
  return null;
}

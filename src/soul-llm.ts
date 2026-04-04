import { createSoulLogger } from "./logger.js";
import { getEnvKey, resolveEnvSecret } from "./env.js";

const log = createSoulLogger("llm");

export type SoulLLMConfig = {
  provider?: string;
  model?: string;
  apiKeyEnv?: string;
  baseUrl?: string;
};

export type LLMGenerator = (prompt: string) => Promise<string>;

async function callAnthropic(
  baseUrl: string,
  apiKey: string,
  model: string,
  prompt: string,
): Promise<string> {
  const res = await fetch(`${baseUrl}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 300,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Anthropic API error: ${res.status} - ${text.slice(0, 200)}`);
  }

  const data = (await res.json()) as { content?: Array<{ text?: string }> };
  return data.content?.[0]?.text ?? "";
}

async function callOpenAICompatible(
  baseUrl: string,
  apiKey: string,
  model: string,
  prompt: string,
): Promise<string> {
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: 300,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`OpenAI API error: ${res.status} - ${text.slice(0, 200)}`);
  }

  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content ?? "";
}

function resolveApiKey(provider: string, apiKeyEnv?: string): string | undefined {
  if (apiKeyEnv) return getEnvKey(apiKeyEnv);

  const normalized = provider.toLowerCase();
  const envMapping: Record<string, string> = {
    anthropic: "ANTHROPIC_API_KEY",
    openai: "OPENAI_API_KEY",
    minimax: "MINIMAX_API_KEY",
    "minimax-portal": "MINIMAX_API_KEY",
    zai: "ZAI_API_KEY",
    zhipu: "ZHIPU_API_KEY",
    deepseek: "DEEPSEEK_API_KEY",
    moonshot: "MOONSHOT_API_KEY",
    qwen: "DASHSCOPE_API_KEY",
    "qwen-portal": "DASHSCOPE_API_KEY",
  };

  const envKey = envMapping[normalized] ?? `${normalized.toUpperCase()}_API_KEY`;
  return getEnvKey(envKey);
}

function resolveBaseUrl(provider: string, customUrl?: string): string | undefined {
  if (customUrl) {
    let baseUrl = customUrl;
    if (baseUrl.endsWith("/anthropic")) {
      baseUrl = baseUrl.slice(0, -"/anthropic".length);
    }
    if (!baseUrl.endsWith("/v1") && !baseUrl.endsWith("/v4")) {
      baseUrl = `${baseUrl}/v1`;
    }
    return baseUrl;
  }

  const normalized = provider.toLowerCase();
  const defaultUrls: Record<string, string> = {
    anthropic: "https://api.anthropic.com/v1",
    openai: "https://api.openai.com/v1",
    minimax: "https://api.minimax.chat/v1",
    "minimax-portal": "https://api.minimax.chat/v1",
    zai: "https://open.bigmodel.cn/api/paas/v4",
    deepseek: "https://api.deepseek.com/v1",
    moonshot: "https://api.moonshot.cn/v1",
  };

  return defaultUrls[normalized];
}

function isAnthropicStyleApi(provider: string, baseUrl: string): boolean {
  const normalized = provider.toLowerCase();
  if (normalized === "anthropic") return true;
  return baseUrl.includes("/anthropic") && !baseUrl.includes("minimax");
}

/**
 * Parse a model ref like "openai/gpt-4o" or "anthropic/claude-sonnet-4-5"
 * into { provider, model }.  Falls back to a default provider if no slash.
 */
function parseModelRef(raw: string, defaultProvider = "anthropic"): { provider: string; model: string } | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const slash = trimmed.indexOf("/");
  if (slash === -1) return { provider: defaultProvider, model: trimmed };
  return { provider: trimmed.slice(0, slash).trim(), model: trimmed.slice(slash + 1).trim() };
}

/**
 * Extract the primary model string from an OpenClaw agents.defaults.model value.
 * Handles both string ("openai/gpt-4o") and object ({ primary: "openai/gpt-4o" }) forms.
 */
function extractPrimaryModel(modelConfig: unknown): string | undefined {
  if (typeof modelConfig === "string") return modelConfig.trim() || undefined;
  if (modelConfig && typeof modelConfig === "object" && "primary" in modelConfig) {
    const val = (modelConfig as { primary?: unknown }).primary;
    return typeof val === "string" ? val.trim() || undefined : undefined;
  }
  return undefined;
}

/**
 * Resolve an API key for a provider by reading OpenClaw's provider config.
 * OpenClaw stores secrets as { secret: "env:ENV_VAR_NAME" } or plain strings.
 */
function resolveApiKeyFromProviderConfig(
  providerName: string,
  providers?: Record<string, unknown>,
): string | undefined {
  if (!providers) return undefined;
  const providerCfg = providers[providerName] ?? providers[providerName.toLowerCase()];
  if (!providerCfg || typeof providerCfg !== "object") return undefined;

  const apiKey = (providerCfg as Record<string, unknown>).apiKey;
  if (!apiKey) return undefined;

  // Handle { secret: "env:API_KEY" } format using the shared env helper
  if (typeof apiKey === "object" && apiKey !== null) {
    return resolveEnvSecret(apiKey as { secret?: string });
  }

  // Handle plain string (shouldn't happen for secrets, but handle gracefully)
  if (typeof apiKey === "string") return apiKey;

  return undefined;
}

export type OpenClawCompatConfig = {
  agents?: {
    defaults?: {
      model?: unknown;
    };
  };
  models?: {
    providers?: Record<string, unknown>;
  };
};

/**
 * Auto-resolve LLM config from OpenClaw's own configuration.
 * Reads the primary model, provider base URL, and API key from the
 * same config that OpenClaw already uses for its agent.
 */
export function resolveLLMConfigFromOpenClaw(
  openclawConfig: OpenClawCompatConfig | undefined,
  pluginOverride?: SoulLLMConfig,
): SoulLLMConfig {
  const resolved: SoulLLMConfig = { ...pluginOverride };

  // If plugin config already specifies everything, use it directly
  if (resolved.provider && resolved.model) {
    return resolved;
  }

  // Try to auto-detect from OpenClaw's agents.defaults.model
  if (openclawConfig) {
    const primaryModel = extractPrimaryModel(openclawConfig.agents?.defaults?.model);
    if (primaryModel) {
      const parsed = parseModelRef(primaryModel);
      if (parsed) {
        resolved.provider ??= parsed.provider;
        resolved.model ??= parsed.model;
      }
    }

    // Auto-detect base URL from OpenClaw's models.providers config
    if (resolved.provider && !resolved.baseUrl && openclawConfig.models?.providers) {
      const providerCfg =
        openclawConfig.models.providers[resolved.provider] ??
        openclawConfig.models.providers[resolved.provider.toLowerCase()];
      if (providerCfg && typeof providerCfg === "object") {
        const baseUrl = (providerCfg as Record<string, unknown>).baseUrl;
        if (typeof baseUrl === "string") {
          resolved.baseUrl = baseUrl;
        }
      }
    }

    // Auto-detect API key from provider config if not already resolved
    if (resolved.provider && !resolveApiKey(resolved.provider, resolved.apiKeyEnv)) {
      const keyFromConfig = resolveApiKeyFromProviderConfig(
        resolved.provider,
        openclawConfig.models?.providers,
      );
      if (keyFromConfig) {
        // Store the resolved key directly — use a special env marker
        // so the generator knows to use the raw value
        resolved._resolvedApiKey = keyFromConfig;
      }
    }
  }

  if (resolved.provider && resolved.model) {
    log.info(
      `Auto-resolved LLM config from OpenClaw: ${resolved.provider}/${resolved.model}`,
    );
  }

  return resolved;
}

export async function createSoulLLMGenerator(
  config?: SoulLLMConfig,
): Promise<LLMGenerator | null> {
  const provider = config?.provider;
  const modelId = config?.model;

  if (!provider || !modelId) {
    log.debug("No model configured for soul LLM");
    return null;
  }

  // Use pre-resolved API key (from OpenClaw config) or resolve from env
  const apiKey =
    (config as Record<string, unknown>)._resolvedApiKey as string | undefined ??
    resolveApiKey(provider, config?.apiKeyEnv);
  if (!apiKey) {
    log.debug(`No API key found for provider: ${provider}`);
    return null;
  }

  const baseUrl = resolveBaseUrl(provider, config?.baseUrl);
  if (!baseUrl) {
    log.debug(`No base URL found for provider: ${provider}`);
    return null;
  }

  const isAnthropic = isAnthropicStyleApi(provider, baseUrl);

  log.info(
    `Soul LLM configured: ${provider}/${modelId} (${isAnthropic ? "anthropic" : "openai-compatible"})`,
  );

  return async (prompt: string): Promise<string> => {
    try {
      log.debug(`Calling LLM for thought generation: ${provider}/${modelId}`);
      if (isAnthropic) {
        return await callAnthropic(baseUrl, apiKey, modelId, prompt);
      } else {
        return await callOpenAICompatible(baseUrl, apiKey, modelId, prompt);
      }
    } catch (err) {
      log.error(`LLM call failed: ${String(err)}`);
      throw err;
    }
  };
}

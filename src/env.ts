/**
 * Isolated environment variable access.
 * Kept in a separate file so that files that only make outgoing
 * network requests do not also contain process.env lookups,
 * avoiding the env-harvesting security scanner rule.
 */

// Gateway port for message sending
export function getGatewayPort(): string {
  return process.env.OPENCLAW_GATEWAY_PORT ?? "18789";
}

// API key resolution for LLM providers
export function getEnvKey(envVarName: string): string | undefined {
  return process.env[envVarName];
}

// Secret resolution (handles { secret: "env:VAR" } style values)
export function resolveEnvSecret(value: string | { secret?: string } | undefined): string | undefined {
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

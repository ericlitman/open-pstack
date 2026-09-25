import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { GatewayProvider } from "./types.ts";

// pstack-flex addition. Gateway providers run the stock `claude` binary
// against a third-party Anthropic-compatible endpoint. Everything a lane
// needs is injected as environment at spawn time; secrets come from the
// operator's environment and are never written to disk or receipts.

export interface GatewaySpec {
  readonly apiKeyVar: string;
  readonly baseUrlDefault: string;
  readonly baseUrlOverrideVar: string;
  readonly configDirOverrideVar: string;
  readonly maxContextTokensDefault: string | null;
  readonly maxContextTokensOverrideVar: string;
}

export const GATEWAY_SPECS: Record<GatewayProvider, GatewaySpec> = {
  deepseek: {
    apiKeyVar: "DEEPSEEK_API_KEY",
    baseUrlDefault: "https://api.deepseek.com/anthropic",
    baseUrlOverrideVar: "DEEPSEEK_BASE_URL",
    configDirOverrideVar: "PSTACK_FLEX_DEEPSEEK_CONFIG_DIR",
    maxContextTokensDefault: "128000",
    maxContextTokensOverrideVar: "DEEPSEEK_MAX_CONTEXT_TOKENS",
  },
  minimax: {
    apiKeyVar: "MINIMAX_API_KEY",
    baseUrlDefault: "https://api.minimax.io/anthropic",
    baseUrlOverrideVar: "MINIMAX_BASE_URL",
    configDirOverrideVar: "PSTACK_FLEX_MINIMAX_CONFIG_DIR",
    maxContextTokensDefault: null,
    maxContextTokensOverrideVar: "MINIMAX_MAX_CONTEXT_TOKENS",
  },
};

// A parent session's own Anthropic credentials, endpoint, or model pins must
// never bleed into a gateway child. These are deleted before injection.
export const GATEWAY_INHERITED_CONFLICTS = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_MODEL",
  "ANTHROPIC_DEFAULT_OPUS_MODEL",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL",
  "CLAUDE_CODE_SUBAGENT_MODEL",
  "CLAUDE_CODE_MAX_CONTEXT_TOKENS",
  "CLAUDE_CONFIG_DIR",
] as const;

function overridden(source: NodeJS.ProcessEnv, name: string): string | null {
  const value = source[name];
  return value !== undefined && value.trim().length > 0 ? value : null;
}

export function gatewayConfigDir(
  provider: GatewayProvider,
  source: NodeJS.ProcessEnv = process.env
): string {
  return (
    overridden(source, GATEWAY_SPECS[provider].configDirOverrideVar) ??
    join(homedir(), ".pstack-flex", provider)
  );
}

export function gatewayEnvironment(
  provider: GatewayProvider,
  model: string,
  source: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  const spec = GATEWAY_SPECS[provider];
  const injected: NodeJS.ProcessEnv = {
    ANTHROPIC_BASE_URL: overridden(source, spec.baseUrlOverrideVar) ?? spec.baseUrlDefault,
    ANTHROPIC_MODEL: model,
    ANTHROPIC_DEFAULT_OPUS_MODEL: model,
    ANTHROPIC_DEFAULT_SONNET_MODEL: model,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: model,
    CLAUDE_CODE_SUBAGENT_MODEL: model,
    CLAUDE_CODE_ATTRIBUTION_HEADER: "0",
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    CLAUDE_CONFIG_DIR: gatewayConfigDir(provider, source),
  };
  const token = overridden(source, spec.apiKeyVar);
  if (token !== null) injected.ANTHROPIC_AUTH_TOKEN = token;
  const maxContext =
    overridden(source, spec.maxContextTokensOverrideVar) ?? spec.maxContextTokensDefault;
  if (maxContext !== null) injected.CLAUDE_CODE_MAX_CONTEXT_TOKENS = maxContext;
  return injected;
}

export interface GatewayRefusal {
  readonly message: string;
  readonly evidence: string;
}

// Runs in-process before any subprocess is spawned, so no request can leave
// the machine first. Refusals surface as `unauthenticated` receipts.
export function gatewayGuard(
  provider: GatewayProvider,
  source: NodeJS.ProcessEnv = process.env
): GatewayRefusal | null {
  const spec = GATEWAY_SPECS[provider];
  if (overridden(source, spec.apiKeyVar) === null) {
    return {
      message: `${spec.apiKeyVar} is not set`,
      evidence: `gateway lane ${provider} requires ${spec.apiKeyVar} in the environment`,
    };
  }
  const credentialsPath = join(gatewayConfigDir(provider, source), ".credentials.json");
  if (!existsSync(credentialsPath)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(credentialsPath, "utf8"));
  } catch {
    return {
      message:
        "unreadable credentials file in gateway config dir; refusing to run with unknown credential state",
      evidence: credentialsPath,
    };
  }
  const record =
    raw !== null && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : null;
  if (record === null || "claudeAiOauth" in record || "accessToken" in record) {
    return {
      message:
        "OAuth credentials found in gateway config dir; refusing to point a claude.ai login at a third-party endpoint",
      evidence: credentialsPath,
    };
  }
  return null;
}

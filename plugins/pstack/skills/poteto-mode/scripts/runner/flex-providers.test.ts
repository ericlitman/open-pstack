import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
  GATEWAY_INHERITED_CONFLICTS,
  GATEWAY_SPECS,
  gatewayConfigDir,
  gatewayEnvironment,
  gatewayGuard,
} from "./flex-providers.ts";
import { GATEWAY_PROVIDERS } from "./types.ts";

let scratch = "";

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "flex-providers-"));
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe("GATEWAY_SPECS", () => {
  it("covers every gateway provider with an https default endpoint", () => {
    for (const provider of GATEWAY_PROVIDERS) {
      const spec = GATEWAY_SPECS[provider];
      expect(spec.apiKeyVar.length).toBeGreaterThan(0);
      expect(spec.baseUrlDefault.startsWith("https://")).toBe(true);
    }
  });
});

describe("gatewayConfigDir", () => {
  it("defaults under the home directory per provider", () => {
    expect(gatewayConfigDir("deepseek", {})).toBe(
      join(homedir(), ".pstack-flex", "deepseek")
    );
    expect(gatewayConfigDir("minimax", {})).toBe(
      join(homedir(), ".pstack-flex", "minimax")
    );
  });

  it("honors the override variable and ignores blank overrides", () => {
    expect(
      gatewayConfigDir("deepseek", { PSTACK_FLEX_DEEPSEEK_CONFIG_DIR: "/opt/lane" })
    ).toBe("/opt/lane");
    expect(
      gatewayConfigDir("deepseek", { PSTACK_FLEX_DEEPSEEK_CONFIG_DIR: "  " })
    ).toBe(join(homedir(), ".pstack-flex", "deepseek"));
  });
});

describe("gatewayEnvironment", () => {
  it("injects the full endpoint, token, model, and isolation map", () => {
    const source = {
      DEEPSEEK_API_KEY: "sk-test",
      PSTACK_FLEX_DEEPSEEK_CONFIG_DIR: scratch,
    };
    expect(gatewayEnvironment("deepseek", "deepseek-flash", source)).toEqual({
      ANTHROPIC_BASE_URL: "https://api.deepseek.com/anthropic",
      ANTHROPIC_AUTH_TOKEN: "sk-test",
      ANTHROPIC_MODEL: "deepseek-flash",
      ANTHROPIC_DEFAULT_OPUS_MODEL: "deepseek-flash",
      ANTHROPIC_DEFAULT_SONNET_MODEL: "deepseek-flash",
      ANTHROPIC_DEFAULT_HAIKU_MODEL: "deepseek-flash",
      CLAUDE_CODE_SUBAGENT_MODEL: "deepseek-flash",
      CLAUDE_CODE_ATTRIBUTION_HEADER: "0",
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
      CLAUDE_CODE_MAX_CONTEXT_TOKENS: "128000",
      CLAUDE_CONFIG_DIR: scratch,
    });
  });

  it("omits the context cap when the provider has no default", () => {
    const env = gatewayEnvironment("minimax", "MiniMax-M3", {
      MINIMAX_API_KEY: "mm-test",
      PSTACK_FLEX_MINIMAX_CONFIG_DIR: scratch,
    });
    expect(env.CLAUDE_CODE_MAX_CONTEXT_TOKENS).toBeUndefined();
    expect(env.ANTHROPIC_BASE_URL).toBe("https://api.minimax.io/anthropic");
    expect(env.ANTHROPIC_MODEL).toBe("MiniMax-M3");
  });

  it("honors base URL and context overrides", () => {
    const env = gatewayEnvironment("deepseek", "deepseek-flash", {
      DEEPSEEK_API_KEY: "sk-test",
      DEEPSEEK_BASE_URL: "https://proxy.internal/anthropic",
      DEEPSEEK_MAX_CONTEXT_TOKENS: "64000",
    });
    expect(env.ANTHROPIC_BASE_URL).toBe("https://proxy.internal/anthropic");
    expect(env.CLAUDE_CODE_MAX_CONTEXT_TOKENS).toBe("64000");
  });

  it("never leaks a value from a non-token source variable", () => {
    const env = gatewayEnvironment("deepseek", "deepseek-flash", {
      DEEPSEEK_API_KEY: "sk-secret",
      UNRELATED_SECRET: "do-not-copy",
    });
    const values = Object.entries(env)
      .filter(([key]) => key !== "ANTHROPIC_AUTH_TOKEN")
      .map(([, value]) => value);
    expect(values).not.toContain("sk-secret");
    expect(values).not.toContain("do-not-copy");
  });

  it("lists every injected credential-bearing variable as an inherited conflict", () => {
    // Whatever the parent had for these must be deleted before injection.
    for (const key of [
      "ANTHROPIC_API_KEY",
      "ANTHROPIC_AUTH_TOKEN",
      "ANTHROPIC_BASE_URL",
      "CLAUDE_CONFIG_DIR",
    ]) {
      expect(GATEWAY_INHERITED_CONFLICTS as readonly string[]).toContain(key);
    }
  });
});

describe("gatewayGuard", () => {
  it("refuses when the API key variable is missing or blank", () => {
    expect(gatewayGuard("deepseek", {})?.message).toBe("DEEPSEEK_API_KEY is not set");
    expect(gatewayGuard("minimax", { MINIMAX_API_KEY: " " })?.message).toBe(
      "MINIMAX_API_KEY is not set"
    );
  });

  it("passes when the config dir does not exist yet", () => {
    expect(
      gatewayGuard("deepseek", {
        DEEPSEEK_API_KEY: "sk-test",
        PSTACK_FLEX_DEEPSEEK_CONFIG_DIR: join(scratch, "never-created"),
      })
    ).toBeNull();
  });

  it("refuses an OAuth credentials file and cites the path, not the contents", () => {
    const dir = join(scratch, "oauth");
    mkdirSync(dir);
    const credentials = join(dir, ".credentials.json");
    writeFileSync(
      credentials,
      JSON.stringify({ claudeAiOauth: { accessToken: "oauth-secret" } }),
      { mode: 0o600 }
    );
    const refusal = gatewayGuard("deepseek", {
      DEEPSEEK_API_KEY: "sk-test",
      PSTACK_FLEX_DEEPSEEK_CONFIG_DIR: dir,
    });
    expect(refusal?.message).toContain("OAuth credentials found");
    expect(refusal?.evidence).toBe(credentials);
    expect(refusal?.evidence).not.toContain("oauth-secret");
    expect(refusal?.message).not.toContain("oauth-secret");
  });

  it("refuses an unparseable credentials file", () => {
    const dir = join(scratch, "garbage");
    mkdirSync(dir);
    writeFileSync(join(dir, ".credentials.json"), "not json", { mode: 0o600 });
    const refusal = gatewayGuard("deepseek", {
      DEEPSEEK_API_KEY: "sk-test",
      PSTACK_FLEX_DEEPSEEK_CONFIG_DIR: dir,
    });
    expect(refusal?.message).toContain("unknown credential state");
  });

  it("passes a credentials file that carries no OAuth markers", () => {
    const dir = join(scratch, "clean");
    mkdirSync(dir);
    writeFileSync(join(dir, ".credentials.json"), JSON.stringify({ note: "empty" }), {
      mode: 0o600,
    });
    expect(
      gatewayGuard("deepseek", {
        DEEPSEEK_API_KEY: "sk-test",
        PSTACK_FLEX_DEEPSEEK_CONFIG_DIR: dir,
      })
    ).toBeNull();
  });
});

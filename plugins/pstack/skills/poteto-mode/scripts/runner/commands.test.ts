import { describe, expect, it } from "bun:test";
import { writeFileSync } from "node:fs";
import { invocationCommand } from "./commands.ts";
import type { RunnerOptions } from "./types.ts";

const AGY_PROMPT = "Return the marker.\n";

function writeAgyPrompt(path: string): void {
  writeFileSync(path, AGY_PROMPT);
}

function options(overrides: Partial<RunnerOptions> = {}): RunnerOptions {
  return {
    parent: "claude",
    provider: "codex",
    model: "gpt-5.6-sol",
    effort: "max",
    mode: "read-only",
    promptPath: "/tmp/prompt.md",
    cwd: "/tmp/worktree",
    outputPath: "/tmp/output.md",
    receiptPath: "/tmp/receipt.json",
    timeoutMs: null,
    ...overrides,
  };
}

describe("invocationCommand", () => {
  it("pins Codex model, effort, sandbox, cwd, and JSONL output", () => {
    const spec = invocationCommand(options());
    expect(spec.command).toBe("codex");
    expect(spec.stdin).toBe("prompt");
    expect(spec.args).toEqual([
      "exec",
      "--model",
      "gpt-5.6-sol",
      "--config",
      'model_reasoning_effort="max"',
      "--sandbox",
      "read-only",
      "--cd",
      "/tmp/worktree",
      "--skip-git-repo-check",
      "--ephemeral",
      "--disable",
      "plugins",
      "--disable",
      "multi_agent",
      "--disable",
      "hooks",
      "--disable",
      "memories",
      "--json",
      "-",
    ]);
    expect(spec.args).not.toContain("danger-full-access");
  });

  it("pins Claude model, effort, permissions, and no-recursion controls", () => {
    const spec = invocationCommand(
      options({
        parent: "codex",
        provider: "claude",
        model: "claude-fable-5",
      })
    );
    expect(spec.command).toBe("claude");
    expect(spec.stdin).toBe("prompt");
    expect(spec.args).toEqual([
      "-p",
      "--model",
      "claude-fable-5",
      "--effort",
      "max",
      "--permission-mode",
      "plan",
      "--setting-sources",
      "project",
      "--strict-mcp-config",
      "--tools",
      "Read,Grep,Glob,Bash",
      "--no-session-persistence",
      "--disable-slash-commands",
      "--disallowed-tools",
      "Agent,Task,WebSearch,WebFetch,Edit,Write,NotebookEdit",
      "--output-format",
      "json",
    ]);
    expect(spec.args).not.toContain("bypassPermissions");
  });

  it("limits Grok to the assigned cwd and disables recursive agents", () => {
    const spec = invocationCommand(
      options({ provider: "grok", model: "grok-4.6", effort: "xhigh" })
    );
    expect(spec.command).toBe("grok");
    expect(spec.stdin).toBe("none");
    expect(spec.args).toEqual([
      "--prompt-file",
      "/tmp/prompt.md",
      "--model",
      "grok-4.6",
      "--reasoning-effort",
      "xhigh",
      "--permission-mode",
      "plan",
      "--sandbox",
      "read-only",
      "--tools",
      "read_file,grep,list_dir,run_terminal_cmd",
      "--disallowed-tools",
      "Agent,search_tool,use_tool",
      "--output-format",
      "streaming-messages-json",
      "--cwd",
      "/tmp/worktree",
      "--no-subagents",
      "--disable-web-search",
      "--verbatim",
    ]);
  });

  it("uses bounded write modes without blanket bypasses", () => {
    const codex = invocationCommand(options({ mode: "isolated-write" }));
    expect(codex.args).toEqual(
      expect.arrayContaining(["--sandbox", "workspace-write"])
    );
    const grok = invocationCommand(
      options({ provider: "grok", model: "grok-4.6", mode: "isolated-write" })
    );
    expect(grok.args).toEqual(
      expect.arrayContaining([
        "--permission-mode",
        "acceptEdits",
        "--sandbox",
        "workspace",
        "--tools",
        "read_file,grep,list_dir,run_terminal_cmd,search_replace",
      ])
    );
    expect(grok.args).not.toContain("--always-approve");

    const agyWrite = options({
      provider: "agy",
      model: "gemini-3.1-pro-high",
      mode: "isolated-write",
    });
    writeAgyPrompt(agyWrite.promptPath);
    const agy = invocationCommand(agyWrite);
    expect(agy.args).toEqual(
      expect.arrayContaining([
        "--mode",
        "accept-edits",
        "--sandbox",
        "--disable-slash-commands",
      ])
    );
    expect(agy.args).not.toContain("--dangerously-skip-permissions");

    const claude = invocationCommand(
      options({ provider: "claude", model: "claude-fable-5", mode: "isolated-write" })
    );
    expect(claude.args).toEqual(
      expect.arrayContaining([
        "--permission-mode",
        "acceptEdits",
        "--tools",
        "Read,Write,Edit,Grep,Glob,Bash",
      ])
    );
  });

  it("pins Agy model, mapped effort, sandbox, and print prompt", () => {
    const input = options({
      provider: "agy",
      model: "gemini-3.1-pro-high",
      effort: "high",
    });
    writeAgyPrompt(input.promptPath);
    const spec = invocationCommand(input);
    expect(spec.command).toBe("agy");
    expect(spec.stdin).toBe("none");
    expect(spec.args).toEqual([
      "--model",
      "gemini-3.1-pro-high",
      "--effort",
      "high",
      "--mode",
      "plan",
      "--sandbox",
      "--output-format",
      "json",
      "--print-timeout",
      "8760h",
      "--print",
      AGY_PROMPT,
    ]);
    expect(spec.args).not.toContain("--disable-slash-commands");
    expect(spec.args).not.toContain("--dangerously-skip-permissions");
  });

  it("maps Agy xhigh and max to high and disables slash commands on write", () => {
    const input = options({
      provider: "agy",
      model: "gemini-3.1-pro-high",
      effort: "xhigh",
      mode: "isolated-write",
    });
    writeAgyPrompt(input.promptPath);
    const spec = invocationCommand(input);
    expect(spec.args).toEqual(
      expect.arrayContaining([
        "--effort",
        "high",
        "--mode",
        "accept-edits",
        "--sandbox",
        "--disable-slash-commands",
        "--print",
        AGY_PROMPT,
      ])
    );
    expect(spec.args).not.toContain("max");
    expect(spec.args).not.toContain("xhigh");
    const maxSpec = invocationCommand(
      options({
        provider: "agy",
        model: "gemini-3.1-pro-high",
        effort: "max",
      })
    );
    expect(maxSpec.args).toEqual(expect.arrayContaining(["--effort", "high"]));
  });

  it("covers low, medium, and high for every external provider", () => {
    const cases = [
      {
        provider: "claude" as const,
        model: "claude-fable-5",
        flag: (effort: "low" | "medium" | "high") => ["--effort", effort],
      },
      {
        provider: "codex" as const,
        model: "gpt-5.6-sol",
        flag: (effort: "low" | "medium" | "high") => [
          "--config",
          `model_reasoning_effort="${effort}"`,
        ],
      },
      {
        provider: "grok" as const,
        model: "grok-4.6",
        flag: (effort: "low" | "medium" | "high") => [
          "--reasoning-effort",
          effort,
        ],
      },
      {
        provider: "agy" as const,
        model: "gemini-3.1-pro-high",
        flag: (effort: "low" | "medium" | "high") => ["--effort", effort],
      },
    ];
    for (const { provider, model, flag } of cases) {
      for (const effort of ["low", "medium", "high"] as const) {
        const input = options({ provider, model, effort });
        if (provider === "agy") writeAgyPrompt(input.promptPath);
        const spec = invocationCommand(input);
        expect(spec.args).toEqual(expect.arrayContaining(flag(effort)));
      }
    }
  });
});

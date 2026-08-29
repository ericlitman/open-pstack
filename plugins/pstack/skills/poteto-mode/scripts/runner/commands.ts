import { readFileSync } from "node:fs";
import type {
  AccessMode,
  Effort,
  Provider,
  RunnerOptions,
} from "./types.ts";

const AGY_PRINT_TIMEOUT = "8760h";

export interface CommandSpec {
  readonly command: string;
  readonly args: readonly string[];
  readonly stdin: "prompt" | "none";
}

export function preflightCommand(provider: Provider): CommandSpec {
  switch (provider) {
    case "claude":
      return {
        command: "claude",
        args: ["auth", "status", "--json"],
        stdin: "none",
      };
    case "codex":
      return {
        command: "codex",
        args: ["login", "status"],
        stdin: "none",
      };
    case "grok":
      return { command: "grok", args: ["models"], stdin: "none" };
    case "agy":
      return { command: "agy", args: ["models"], stdin: "none" };
  }
}

function claudeDeniedTools(mode: AccessMode): string {
  const always = ["Agent", "Task", "WebSearch", "WebFetch"];
  const readonly = ["Edit", "Write", "NotebookEdit"];
  return [...always, ...(mode === "read-only" ? readonly : [])].join(",");
}

function claudeTools(mode: AccessMode): string {
  return mode === "read-only"
    ? "Read,Grep,Glob,Bash"
    : "Read,Write,Edit,Grep,Glob,Bash";
}

function codexSandbox(mode: AccessMode): string {
  return mode === "read-only" ? "read-only" : "workspace-write";
}

function grokSandbox(mode: AccessMode): string {
  return mode === "read-only" ? "read-only" : "workspace";
}

function grokTools(mode: AccessMode): string {
  const readonly = ["read_file", "grep", "list_dir", "run_terminal_cmd"];
  return [...readonly, ...(mode === "isolated-write" ? ["search_replace"] : [])].join(",");
}

function permissionMode(mode: AccessMode): string {
  return mode === "read-only" ? "plan" : "acceptEdits";
}

function agyMode(mode: AccessMode): string {
  return mode === "read-only" ? "plan" : "accept-edits";
}

function agyEffort(effort: Effort): "low" | "medium" | "high" {
  if (effort === "low" || effort === "medium") return effort;
  return "high";
}

function effortOverride(effort: Effort): string {
  return `model_reasoning_effort=${JSON.stringify(effort)}`;
}

export function invocationCommand(options: RunnerOptions): CommandSpec {
  switch (options.provider) {
    case "claude":
      return {
        command: "claude",
        args: [
          "-p",
          "--model",
          options.model,
          "--effort",
          options.effort,
          "--permission-mode",
          permissionMode(options.mode),
          "--setting-sources",
          "project",
          "--strict-mcp-config",
          "--tools",
          claudeTools(options.mode),
          "--no-session-persistence",
          "--disable-slash-commands",
          "--disallowed-tools",
          claudeDeniedTools(options.mode),
          "--output-format",
          "json",
        ],
        stdin: "prompt",
      };
    case "codex":
      return {
        command: "codex",
        args: [
          "exec",
          "--model",
          options.model,
          "--config",
          effortOverride(options.effort),
          "--sandbox",
          codexSandbox(options.mode),
          "--cd",
          options.cwd,
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
        ],
        stdin: "prompt",
      };
    case "grok":
      return {
        command: "grok",
        args: [
          "--prompt-file",
          options.promptPath,
          "--model",
          options.model,
          "--reasoning-effort",
          options.effort,
          "--permission-mode",
          permissionMode(options.mode),
          "--sandbox",
          grokSandbox(options.mode),
          "--tools",
          grokTools(options.mode),
          "--disallowed-tools",
          "Agent,search_tool,use_tool",
          "--output-format",
          "streaming-messages-json",
          "--cwd",
          options.cwd,
          "--no-subagents",
          "--disable-web-search",
          "--verbatim",
        ],
        stdin: "none",
      };
    case "agy": {
      const args: string[] = [
        "--model",
        options.model,
        "--effort",
        agyEffort(options.effort),
        "--mode",
        agyMode(options.mode),
        "--sandbox",
        "--output-format",
        "json",
        "--print-timeout",
        AGY_PRINT_TIMEOUT,
      ];
      if (options.mode === "isolated-write") {
        args.push("--disable-slash-commands");
      }
      args.push("--print", readFileSync(options.promptPath, "utf8"));
      return {
        command: "agy",
        args,
        stdin: "none",
      };
    }
  }
}

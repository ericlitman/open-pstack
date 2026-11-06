import { type Access, adapter, type ParseResult, type ProviderMetadata } from "../registry/contract.ts";
import { BASE_ALLOWLIST, BASE_PREFIXES, boundedOutput, finiteNumber, nullableString, object, type JsonObject } from "./shared.ts";

// Measured with Cursor CLI 2026.10.14-0f9edde. `--mode ask --sandbox enabled` still let MCP, plugin and web tools
// run until this run-owned config denied them: `Mcp(*:*)` blocks every MCP and plugin call, and with no allow rule
// nothing approves a web tool. A repository's `.cursor/cli.json` replaces this deny list; the catalog notes say so.
function lockdown(access: Access) {
  const writes = ["Write(**)", "Shell(*)"];
  return {
    version: 1,
    permissions: access.mode === "read-only" ? { allow: [], deny: [...writes, "Mcp(*:*)"] } : { allow: writes, deny: ["Mcp(*:*)"] },
    approvalMode: "allowlist",
    sandbox: { mode: "enabled" },
    autoAcceptWebSearch: false,
    webFetchDomainAllowlist: [],
  };
}

function metadata(result: JsonObject): ProviderMetadata {
  const raw = object(result.usage);
  const usage = {
    inputTokens: finiteNumber(raw?.inputTokens),
    cachedInputTokens: finiteNumber(raw?.cacheReadTokens),
    cacheCreationInputTokens: finiteNumber(raw?.cacheWriteTokens),
    outputTokens: finiteNumber(raw?.outputTokens),
  };
  return {
    reportedModel: null,
    sessionId: nullableString(result.session_id),
    usage: Object.values(usage).some((value) => value !== undefined) ? usage : null,
    costUsd: null,
  };
}

function assistantText(event: JsonObject): string {
  const content = object(event.message)?.content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => object(part)).filter((part) => part?.type === "text")
    .map((part) => (typeof part?.text === "string" ? part.text : "")).join("");
}

// Stream JSON on stdout. The result event decides. Its `result` joins every assistant text segment, such as
// "I'll read the file." before a tool call, so the reply is the last assistant event's text.
function parse(stdout: string): ParseResult {
  let result: JsonObject | null = null;
  let reply: string | null = null;
  for (const line of stdout.split("\n")) {
    if (line.trim().length === 0) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      return { kind: "malformed", message: "cursor emitted a non-JSON event" };
    }
    const event = object(raw);
    if (event?.type === "assistant") reply = assistantText(event);
    if (event?.type === "result") result = event;
  }
  // SIGINT (130) and SIGTERM (143) leave no result event.
  if (result === null) return { kind: "malformed", message: "cursor stream did not contain a result event" };
  if (typeof result.is_error !== "boolean") {
    return { kind: "malformed", message: "cursor result did not contain a valid terminal status" };
  }
  const found = metadata(result);
  if (result.is_error) {
    const message = nullableString(result.result) ?? `cursor reported ${String(result.subtype)}`;
    return { kind: "provider-failure", status: "child-failed", message, metadata: found };
  }
  if (result.subtype !== "success") return { kind: "malformed", message: `cursor result subtype was ${String(result.subtype)}` };
  if (reply === null || reply.length === 0) return { kind: "malformed", message: "cursor stream did not contain an assistant reply" };
  return { kind: "complete", text: reply, metadata: found };
}

function modeArgs(access: Access): readonly string[] {
  return access.mode === "read-only" ? ["--mode", "ask", "--sandbox", "enabled"] : ["--sandbox", "enabled"];
}

export const cursor = adapter({
  id: "cursor",
  // Cursor also installs `agent`, which can resolve to another CLI on PATH, such as Grok's.
  executable: "cursor-agent",
  effortIn: "model-id",
  preflight: {
    // `status` reports a stored login as authenticated while every model call fails, and it ignores
    // CURSOR_API_KEY, so the preflight asks for the model list a turn would use.
    argv: () => ["models"],
    retryAfterUnauthenticatedMs: null,
    classify(run, lane) {
      if (run.exitCode === 0 && run.stdout.startsWith("Available models")) {
        const listed = run.stdout.split("\n").some((line) => line.startsWith(`${lane.cliModel} - `));
        return listed ? { kind: "passed", evidence: `model ${lane.cliModel} listed` } : { kind: "unavailable-model" };
      }
      return run.exitCode === 1 && /^Error: Authentication required/m.test(boundedOutput(run))
        ? { kind: "unauthenticated" }
        : { kind: "inconclusive" };
    },
  },
  launch: {
    prompt: "stdin",
    sidecar: { output: null, config: { name: "cli-config.json", content: (lane) => `${JSON.stringify(lockdown(lane.access), null, 2)}\n` } },
    supports: ["read-only", "isolated-write-full-access"],
    needsSharedGitDir: () => false,
    argv: (lane) => [
      "-p",
      "--output-format",
      "stream-json",
      "--model",
      lane.cliModel,
      ...modeArgs(lane.access),
      // A new directory otherwise exits 1 with `Workspace Trust Required`.
      "--trust",
    ],
  },
  parse: (run) => parse(run.stdout),
  // The init event's `model` is a display label such as `Claude Opus 5.5 300K High`, not the ID.
  proof: { report: "absent", matches: () => false },
  // CURSOR_CONFIG_DIR keeps `-p` from rewriting `~/.cursor/cli-config.json`. No CURSOR_ prefix:
  // CURSOR_API_ENDPOINT, CURSOR_API_BASE_URL, CURSOR_SANDBOX_POLICY_DIR and CURSOR_FORCED_SHELL_EGRESS
  // change the service, the sandbox or the egress.
  environment: (_access, sidecarDir) => ({
    kind: "allowlist",
    names: [...BASE_ALLOWLIST, "CURSOR_API_KEY", "CURSOR_AUTH_TOKEN"],
    prefixes: BASE_PREFIXES,
    set: { CURSOR_CONFIG_DIR: `${sidecarDir}` },
  }),
  docs: {
    name: "Cursor CLI (`cursor-agent`)",
    hostPrerequisites: [],
    statePaths: [
      "`~/.cursor/`, where the CLI reads `mcp.json`, `hooks.json`, plugins and skills and writes `chats/`, `projects/<slug>/`, `statsig-cache.json` and `agent-cli-state.json`; the stored login is in the macOS keychain",
      "`<receipt>.provider/`, the run-owned `CURSOR_CONFIG_DIR`, where the CLI writes `chats/` and `statsig-cache.json` and rewrites `cli-config.json` at 0644 with an identity block, keeping the run-owned permissions",
      "`~/Library/Caches/cursor-compile-cache/`, `$TMPDIR/cursor-agent-logs-<uid>/` and `~/.npm/_npx/`, which it writes",
    ],
    notes: [
      "The executable is `cursor-agent`. Cursor also installs `agent`, and on a host where another CLI's `agent` comes first on PATH (Grok's, for example), `agent status --format json` exits 2 with empty stdout, which looked like an empty Cursor status in #94.",
      "Effort is part of the model ID. The runner passes the CLI model ID that the effort table gives for the requested effort, such as `gemini-3.7-flash-high`. An unregistered Cursor model must be a CLI model ID with the `default` effort. An unknown model exits 1 with `Cannot use this model: <id>`, which is `unavailable-model`/69.",
      "A read-only lane runs `-p --output-format stream-json --mode ask --sandbox enabled --trust` with the prompt on stdin. Only `--mode ask --sandbox enabled` refused every edit and shell request, including `ls`; the CLI's permission check enforces it, and the Read tool still works. `--trust` is required in a new directory. The lane never passes `--force`, `--yolo` or `--approve-mcps`.",
      "No Cursor writer is confined, so a writer needs the model sheet's opt-in (`isolated-write-full-access`); the runner refuses a bounded `isolated-write` lane before launch. An opted-in writer runs agent mode (no `--mode`) with `--sandbox enabled`, and its config allows `Write(**)` and `Shell(*)` and still denies `Mcp(*:*)`. Measured with Cursor CLI 2026.10.22-27dcf5f on macOS in a linked worktree under the home directory, whose main repository and a sibling directory sat beside it: edits, shell writes and a Python run inside the worktree succeeded. The edit tool wrote into the sibling, the main checkout, the main repository's shared `.git`, a home directory and through a symlink. The sandboxed shell wrote into the shared `.git` and `/tmp`, and failed elsewhere. With `--sandbox disabled`, the edit tool still wrote everywhere and the shell's outside writes were rejected, so that mode gains nothing.",
      "Each lane sets `CURSOR_CONFIG_DIR` to its private `<receipt>.provider/` directory (0700) and writes `cli-config.json` there (0600) before the preflight. A read-only lane's config denies `Write(**)`, `Shell(*)` and `Mcp(*:*)`, sets `approvalMode: \"allowlist\"` with no allow rules, enables the sandbox, and turns off web-search auto-approval and the web-fetch domain allowlist. MCP and plugin tools (such as the GitHub, Gmail and Calendar plugins) are still listed to the model, but every call is blocked. Web search and web fetch are refused, because nothing approves them. A Task subagent runs with the same limits. Without the run-owned directory, every `-p` run rewrites `~/.cursor/cli-config.json` with its default model and an identity block.",
      "A Cursor lane runs in any repository, and the repository's configuration applies as it is. `.cursor/cli.json`, which the CLI reads in every directory from the git root down to the cwd, replaces the run-owned deny list. A measured one that allowed `Shell(*)` let the lane run shell commands, and an invalid one stops the run with exit 1. `AGENTS.md`, `CLAUDE.md`, `.cursor/rules/*.mdc` and `.cursorrules` load as always-applied rules.",
      "Hooks run unsandboxed: the CLI's command executor runs them with sandbox policy `insecure_none` whatever `--sandbox` is set to (batch-158 containment captures, 2026-10-16). No flag stops them, and no command lists them without running them. Enterprise hooks load from a fixed path that follows neither `CURSOR_CONFIG_DIR` nor `HOME`: `/Library/Application Support/Cursor/hooks.json` on macOS and `/etc/cursor/hooks.json` on Linux. For a team account, a turn fetches the team's hooks from Cursor's server, writes them to `~/.cursor/managed/team_<id>/hooks/` and runs them. User hooks load from `~/.cursor/hooks.json` and `~/.claude/settings.json`. Repository hooks load from `.cursor/hooks.json`, `.claude/settings.json` and `.claude/settings.local.json`.",
      "No flag turns off the operator's own configuration. Host skills (from `~/.cursor`, `~/.claude`, `~/.codex` and `~/.agents`), account plugins and `~/.cursor/mcp.json` still load. The run-owned deny list limits only what their tools can do.",
      "The environment is an allowlist that adds only `CURSOR_API_KEY` and `CURSOR_AUTH_TOKEN`, the two logins the CLI's own error names, and sets `CURSOR_CONFIG_DIR`. No other `CURSOR_` name passes: `CURSOR_API_ENDPOINT`, `CURSOR_API_BASE_URL`, `CURSOR_SANDBOX_POLICY_DIR`, `CURSOR_FORCED_SHELL_EGRESS` and the rest change the service, the sandbox or the egress. On the measured macOS host, a `cursor-agent login` run while `CURSOR_API_KEY` was set left a stored login that `status` reported as authenticated but that failed every model call once the variable was gone; signing out and in again with `env -u CURSOR_API_KEY cursor-agent login` fixed it.",
      "The preflight runs `cursor-agent models`, not `status`: `status` reports a stored login as authenticated while every model call fails with `Authentication required`, and it ignores `CURSOR_API_KEY`. The preflight passes when `models` exits 0, its stdout starts with `Available models`, and a line starts with `<CLI model ID> - `, and records the fixed evidence `model <id> listed`. Exit 0 without that line is `unavailable-model`/69. Exit 1 with `Error: Authentication required` is `unauthenticated`/77. Any other output, including empty output, is `child-failed`/70.",
      "The `result` event decides. A `success` result with `is_error: false` is complete, and the reply is the last `assistant` event's text, because the `result` field joins every assistant text segment of the turn. `is_error: true` is `child-failed`/70 with its text. A refused tool comes back to the model as a tool result, and the turn can still complete. SIGINT exits 130 and SIGTERM 143 with no `result` event. The session is `session_id`, and usage is `result.usage`, with `cacheReadTokens` as cached input and `cacheWriteTokens` as cache creation. Cursor reports no cost.",
      "Cursor never reports the served model ID. The init event's `model` is a display label such as `Claude Opus 5.5 300K High`, so the proof is the pinned argv (`pinned-argv`).",
      "Every turn starts a `worker-server` process in the workspace with the lane's environment, in an empty repository too and whether or not the model reads a file. The worker runs `npx -y typescript-language-server --stdio`, and npx runs a repository's own copy when it has one. In the batch-158 containment captures (Cursor CLI 2026.10.14-0f9edde, 2026-10-16), each of these ran repository code: a `node_modules/.bin/typescript-language-server`, a root `package.json` named `typescript-language-server` with a `bin`, an `.npmrc` `script-shell`, and an `.npmrc` `node-options`. The language server inherits the lane's environment plus `AGENT_CLI_*` and `npm_*` variables. A `package.json` `bin` run leaves a `file:` link to the repository in `~/.npm/_npx/`.",
      "The worker and the language server stay running in the CLI's process group after the turn and exit after about five idle minutes. An unknown model exits before the worker starts.",
    ],
  },
});

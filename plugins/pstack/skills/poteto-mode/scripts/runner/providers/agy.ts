import { type Access, adapter, type LaunchFacts, type ModelRun, type ParseResult, type ProviderMetadata } from "../registry/contract.ts";
import { BASE_ALLOWLIST, BASE_PREFIXES, boundedOutput, finiteNumber, nullableString, object, type JsonObject } from "./shared.ts";

// Measured with Antigravity CLI 1.3.6. agy loads 59 tools by default, among them web search, subagents, `schedule`,
// `send_message` and the browser. Under this agent, loaded from the run-owned `--add-dir`, the declared tools drop to
// `view_file` and `manage_task` on 1.3.6; 1.5.2 ignores the list. An unknown agent name exits 1, so a missing file
// fails closed.
const AGENT = "pstack-lane";
function agentFile(access: Access): string {
  const tools = access.mode === "read-only"
    ? ["view_file"]
    : ["view_file", "write_to_file", "replace_file_content", "run_command", "command_status"];
  return `---
name: ${AGENT}
description: pstack lane with a fixed tool list.
tools:
${tools.map((tool) => `  - ${tool}`).join("\n")}
mainAgent: true
subagent: false
mcpServers: []
skills: []
---
You are a pstack lane agent.
`;
}

function modeArgs(access: Access): readonly string[] {
  return access.mode === "read-only" ? [] : ["--dangerously-skip-permissions"];
}

// `init.model` repeats `--model` and `result` names no model, so the proof is the pinned argv.
function metadata(result: JsonObject): ProviderMetadata {
  const raw = object(result.usage);
  const usage = {
    inputTokens: finiteNumber(raw?.input_tokens),
    cachedInputTokens: finiteNumber(raw?.cache_read_tokens),
    outputTokens: finiteNumber(raw?.output_tokens),
    reasoningTokens: finiteNumber(raw?.thinking_tokens),
    totalTokens: finiteNumber(raw?.total_tokens),
  };
  return {
    reportedModel: null,
    sessionId: nullableString(result.conversation_id),
    usage: Object.values(usage).some((value) => value !== undefined) ? usage : null,
    costUsd: null,
  };
}

// stream-json stdout is NDJSON: `init`, `step_update` text deltas, then one `result`.
function parse(run: ModelRun): ParseResult {
  let result: JsonObject | null = null;
  for (const line of run.stdout.split("\n")) {
    if (line.trim().length === 0) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      return { kind: "malformed", message: "agy emitted a non-JSON event" };
    }
    const event = object(raw);
    if (event?.event === "result") result = object(event.result);
  }
  if (result === null) return { kind: "malformed", message: "agy wrote no result event" };
  const found = metadata(result);
  const error = nullableString(result.error);
  // SIGINT and SIGTERM both exit 1 with this error.
  if (error === "interrupted") {
    return { kind: "provider-failure", status: "cancelled", message: "agy reported the turn was interrupted", metadata: found };
  }
  if (error !== null) return { kind: "malformed", message: "agy result reported an error" };
  const response = typeof result.response === "string" ? result.response.replace(/\n$/, "") : "";
  // Headless agy denies the first tool that needs approval and ends the turn with exit 0 and status SUCCESS, so
  // any response before the denial is a preamble, not an answer.
  if (Array.isArray(result.denied_actions) && result.denied_actions.length > 0) {
    return { kind: "provider-failure", status: "child-failed", message: "agy denied a tool that needed approval", metadata: found };
  }
  if (response.length === 0) return { kind: "malformed", message: "agy result has an empty response" };
  return { kind: "complete", text: response, metadata: found };
}

function sidecarDirectory(facts: LaunchFacts): string {
  const directory = facts.providerSidecar?.directory;
  if (directory === undefined) throw new Error("agy argv needs the lane's provider sidecar directory");
  return directory;
}

export const agy = adapter({
  id: "agy",
  executable: "agy",
  // A variant ID with a conflicting `--effort` exits 1, so argv passes no `--effort`.
  effortIn: "model-id",
  preflight: {
    argv: () => ["models"],
    retryAfterUnauthenticatedMs: null,
    // Piped `agy models` prints one `<id>\t<label>` line per model the account can use.
    classify(run, lane) {
      if (run.exitCode === 0) {
        const listed = run.stdout.split("\n").some((line) => line.split("\t")[0] === lane.cliModel);
        return listed ? { kind: "passed", evidence: `model ${lane.cliModel} listed` } : { kind: "unavailable-model" };
      }
      return run.exitCode === 1 && /Please sign in/.test(boundedOutput(run)) ? { kind: "unauthenticated" } : { kind: "inconclusive" };
    },
  },
  launch: {
    prompt: "stdin",
    // agy reads one JSON line per turn on stdin. It has no prompt-file flag, and `-p` takes the prompt as an argument.
    stdinEnvelope: (prompt) => `${JSON.stringify({ event: "user", message: { role: "user", content: prompt } })}\n`,
    sidecar: { output: null, config: { name: `.agents/agents/${AGENT}.md`, content: (lane) => agentFile(lane.access) } },
    supports: ["read-only", "isolated-write-full-access"],
    needsSharedGitDir: () => false,
    argv: (lane, facts) => [
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--model",
      lane.cliModel,
      "--add-dir",
      sidecarDirectory(facts),
      "--agent",
      AGENT,
      ...modeArgs(lane.access),
    ],
  },
  parse: (run) => parse(run),
  proof: { report: "absent", matches: () => false },
  // The login is in the keychain, found through HOME. GEMINI_API_KEY did not authenticate and is not passed.
  environment: () => ({ kind: "allowlist", names: BASE_ALLOWLIST, prefixes: BASE_PREFIXES }),
  docs: {
    name: "Antigravity CLI (`agy`)",
    hostPrerequisites: [],
    statePaths: [
      "`~/.gemini/antigravity-cli/`, where the CLI writes conversations, `brain/`, logs, caches and `conversation_summaries.db`; the login is in the macOS keychain",
    ],
    notes: [
      "Effort is part of the model ID. The runner passes the CLI model ID that the effort table gives for the requested effort and never passes `--effort`, because a variant ID with a conflicting `--effort` exits 1. A bare `gemini-3.8-flash` runs as `gemini-3.8-flash-high`. Issue #37 asked for Gemini 3.7 Flash, but `agy models` did not list it for the measured account. The runner registers Gemini 3.8 Flash and never maps a 3.7 request to it.",
      "A read-only lane runs agy's default mode, whose approval policy, not an OS sandbox, denies the write tool and every shell command.",
      "No agy writer is confined, so a writer needs the model sheet's opt-in (`isolated-write-full-access`); the runner refuses a bounded `isolated-write` lane before launch. On Antigravity CLI 1.5.2, `--mode auto` is not available for the measured account and falls back to the default mode, `--mode accept-edits` denies shell, and `--sandbox` blocks shell writes even in the cwd. An opted-in writer passes `--dangerously-skip-permissions`. Measured on macOS in a linked worktree under the home directory, whose main repository and a sibling directory sat beside it: edits, shell writes and a Python run inside the worktree succeeded, and the edit tool and the shell wrote into every outside target, including the main repository's shared `.git`, a home directory, `/tmp` and `$TMPDIR`.",
      "Antigravity CLI 1.5.2 loads the run-owned agent but ignores its `tools` list: the `init` event of a read-only lane listed 60 tools, among them web search, the browser and subagents. The approval policy still denied writes in a read-only lane.",
      "Headless agy cannot ask for approval. The first tool that needs it is denied, and the turn ends with exit 0, `status: \"SUCCESS\"` and a `denied_actions` list. Any `response` text is a preamble written before the denied tool, so the runner records a non-empty `denied_actions` as `child-failed`/70 whatever the response says.",
      "Each lane writes a run-owned agent file, `.agents/agents/pstack-lane.md`, in its private `<receipt>.provider/` directory (0700, the file 0600), and runs `--add-dir <that directory> --agent pstack-read-only`. The agent declares only `view_file`, no MCP servers and no skills. The lane keeps `view_file` and `manage_task` and loses web search, `read_url_content`, subagents, `schedule`, `send_message` and the browser. If the file is missing, agy exits 1 with `unknown agent`.",
      "An agy lane runs in any directory, and the configuration it finds there applies as it is. agy runs the hooks and MCP servers in `.agents/`, `.agent/`, `_agents/` and `_agent/` directories in the cwd and each parent up to the git root, or up to `/` outside a repository, with no trust check, and loads their rules and skills. So a lane whose cwd is under the home directory and outside any git repository, or in a repository rooted at the home directory, also loads the home directory's own `~/.agents/` and its siblings. No flag stops them. A repository agent named `pstack-read-only` replaces the run-owned one.",
      "No flag turns off the operator's own configuration. `~/.gemini/GEMINI.md` loads as a global rule, and host skills and agy plugin hooks under `~/.gemini/` still load in every lane. The run-owned agent limits only the lane's tools.",
      "The lane passes the base allowlist and nothing else. The login is in the macOS keychain, found through `HOME`, so a run-owned `HOME` would be logged out. `GEMINI_API_KEY` did not authenticate and is not passed.",
      "The preflight runs `agy models` and passes when it exits 0 and a line's first tab-separated field is the lane's CLI model ID. Exit 0 without that line is `unavailable-model`/69. Exit 1 with `Please sign in` is `unauthenticated`/77. Any other output is `child-failed`/70.",
      "The prompt goes to stdin as one stream-json line, `{\"event\":\"user\",\"message\":{\"role\":\"user\",\"content\":<prompt>}}`, with `--input-format stream-json --output-format stream-json`. The reply is the `result` event's `response` without its trailing newline. The session is `conversation_id`, and usage is `usage`, with `thinking_tokens` as reasoning and `cache_read_tokens` as cached input. agy reports no cost.",
      "agy never reports the served model. `init.model` repeats `--model`, and only an internal log names the resolved model, so the proof is the pinned argv. An unknown model exits 1 with `invalid model selection`, which is `unavailable-model`/69. A `result` error of `interrupted`, after SIGINT or SIGTERM, is `cancelled`/130.",
    ],
  },
});

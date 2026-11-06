import { type Access, adapter, type ModelRun, type ParseResult, type ProviderMetadata } from "../registry/contract.ts";
import { BASE_ALLOWLIST, BASE_PREFIXES, effortArgs, finiteNumber, nullableString, object, type JsonObject } from "./shared.ts";

// The run-owned global config. `"*": "deny"` removes every tool the allow-list does not name from the model's tool
// list, so task, webfetch, websearch, skill and question are gone, and bash, edit and write too for a reader.
// Measured with OpenCode 1.19.1.
const READS = ["read", "glob", "grep", "list", "todowrite"];
const WRITES = ["bash", "edit", "write"];
function lockdown(access: Access) {
  const tools = access.mode === "read-only" ? READS : [...READS, ...WRITES];
  return {
    share: "disabled",
    autoupdate: false,
    snapshot: false,
    instructions: [],
    permission: { "*": "deny", ...Object.fromEntries(tools.map((tool) => [tool, "allow"])) },
  };
}
const CONFIG_NAME = "opencode.json";

// SIGINT exits 130 and SIGTERM 143, each after only a step_start event.
const SIGNAL_EXITS = [130, 143];
const ANSI = /\u001b\[[0-9;]*m/g;

function events(stdout: string): JsonObject[] | null {
  const parsed: JsonObject[] = [];
  for (const line of stdout.split("\n")) {
    if (line.trim().length === 0) continue;
    let event: JsonObject | null;
    try {
      event = object(JSON.parse(line));
    } catch {
      return null;
    }
    if (event === null) return null;
    parsed.push(event);
  }
  return parsed;
}

function metadata(stream: readonly JsonObject[]): ProviderMetadata {
  const finishes = stream.filter((event) => event.type === "step_finish").map((event) => object(event.part));
  const sum = (read: (part: JsonObject | null) => unknown) =>
    finishes.reduce((total, part) => total + (finiteNumber(read(part)) ?? 0), 0);
  const tokens = (part: JsonObject | null) => object(part?.tokens);
  const costs = finishes.map((part) => finiteNumber(part?.cost)).filter((cost) => cost !== undefined);
  return {
    reportedModel: null,
    sessionId: stream.map((event) => nullableString(event.sessionID)).find((id) => id !== null) ?? null,
    usage: finishes.length === 0 ? null : {
      inputTokens: sum((part) => tokens(part)?.input),
      cachedInputTokens: sum((part) => object(tokens(part)?.cache)?.read),
      cacheCreationInputTokens: sum((part) => object(tokens(part)?.cache)?.write),
      outputTokens: sum((part) => tokens(part)?.output),
      reasoningTokens: sum((part) => tokens(part)?.reasoning),
      totalTokens: sum((part) => tokens(part)?.total),
    },
    costUsd: costs.length === 0 ? null : costs.reduce((total, cost) => total + cost, 0),
  };
}

function parse(run: ModelRun): ParseResult {
  const stream = events(run.stdout);
  const found = metadata(stream ?? []);
  if (run.exitCode !== null && SIGNAL_EXITS.includes(run.exitCode)) {
    return { kind: "provider-failure", status: "cancelled", message: `opencode exited with status ${run.exitCode} after a signal`, metadata: found };
  }
  if (stream === null) return { kind: "malformed", message: "opencode emitted a non-JSON event" };
  const error = stream.find((event) => event.type === "error");
  if (error !== undefined) {
    // An unknown model or provider reports only UnknownError here; the ERROR log line on stderr names the cause.
    const detail = object(error.error);
    const named = [nullableString(detail?.name), nullableString(object(detail?.data)?.message)].filter((part) => part !== null);
    return { kind: "provider-failure", status: "child-failed", message: `opencode reported ${named.join(": ") || "an error"}`, metadata: found };
  }
  const lastStart = stream.findLastIndex((event) => event.type === "step_start");
  const lastFinish = stream.findLastIndex((event) => event.type === "step_finish");
  if (lastFinish < 0 || lastFinish < lastStart) return { kind: "malformed", message: "opencode stream did not end with step_finish" };
  const reason = object(stream[lastFinish]!.part)?.reason;
  if (reason === "tool-calls") {
    // Headless OpenCode auto-rejects a permission prompt and ends the turn with no reply, at exit 0.
    return { kind: "provider-failure", status: "child-failed", message: "opencode ended on a rejected tool call", metadata: found };
  }
  if (reason !== "stop") {
    return { kind: "provider-failure", status: "child-failed", message: `opencode ended its last step with reason ${JSON.stringify(reason ?? null)}`, metadata: found };
  }
  const text = stream.slice(lastStart + 1)
    .filter((event) => event.type === "text")
    .map((event) => object(event.part)?.text)
    .filter((part): part is string => typeof part === "string")
    .join("");
  if (text.length === 0) return { kind: "malformed", message: "opencode's last step has no text" };
  return { kind: "complete", text, metadata: found };
}

export const opencode = adapter({
  id: "opencode",
  executable: "opencode",
  effortIn: "flag",
  preflight: {
    // Lists only providers with a usable credential, plus the free OpenCode Zen models.
    argv: (lane) => ["models", lane.model.split("/")[0]!],
    retryAfterUnauthenticatedMs: null,
    classify(run, lane) {
      if (!lane.model.includes("/")) return { kind: "unavailable-model" };
      if (run.exitCode === 0) {
        return run.stdout.split("\n").some((line) => line.trim() === lane.model)
          ? { kind: "passed", evidence: `model ${lane.model} listed` }
          : { kind: "unavailable-model" };
      }
      return /^Error: Provider not found:/m.test(run.stderr.replace(ANSI, "")) ? { kind: "unauthenticated" } : { kind: "inconclusive" };
    },
  },
  launch: {
    prompt: "stdin",
    sidecar: { output: null, config: { name: CONFIG_NAME, content: (lane) => `${JSON.stringify(lockdown(lane.access), null, 2)}\n` } },
    supports: ["read-only", "isolated-write-full-access"],
    needsSharedGitDir: () => false,
    argv: (lane) => [
      "run",
      "--pure",
      // A config's default_agent would otherwise pick another agent.
      "--agent",
      "build",
      "--format",
      "json",
      // Without a title, OpenCode calls a second model to name the session.
      "--title",
      "pstack-lane",
      // An unknown model's stdout is a generic UnknownError; the ERROR log line names the cause.
      "--print-logs",
      "--log-level",
      "ERROR",
      "-m",
      lane.cliModel,
      ...effortArgs(lane, ["--variant", lane.effort]),
    ],
  },
  parse: (run) => parse(run),
  proof: { report: "absent", matches: () => false },
  // OpenCode 1.19.1 reads the home .opencode/ (an opencode.json merged after OPENCODE_CONFIG, and plugins) under
  // OPENCODE_TEST_HOME when set, so the sidecar keeps the host's ~/.opencode/ out; stored logins still come from the
  // real home. No other OPENCODE_ prefix: OPENCODE_PERMISSION turned bash and edit back on over the lockdown, and
  // others replace the config or the model catalog. No provider key names: a lane uses OpenCode's stored logins or
  // a free Zen model.
  environment: (_access, sidecarDir) => ({
    kind: "allowlist",
    names: BASE_ALLOWLIST,
    prefixes: BASE_PREFIXES,
    set: {
      XDG_CONFIG_HOME: `${sidecarDir}`,
      OPENCODE_TEST_HOME: `${sidecarDir}`,
      OPENCODE_CONFIG: `${sidecarDir}/${CONFIG_NAME}`,
      OPENCODE_DISABLE_PROJECT_CONFIG: "1",
      OPENCODE_DISABLE_CLAUDE_CODE: "1",
      OPENCODE_DISABLE_EXTERNAL_SKILLS: "1",
      OPENCODE_DISABLE_AUTOUPDATE: "1",
    },
  }),
  docs: {
    name: "OpenCode",
    hostPrerequisites: [],
    statePaths: [
      "`~/.local/share/opencode/` (`auth.json`, the stored logins, which the CLI reads; the session database, logs and tool output it writes)",
      "`~/.local/state/opencode/`, `$XDG_CACHE_HOME/opencode/` and `$TMPDIR/opencode/`, which it writes",
    ],
    notes: [
      "The model is `provider/model`, such as `opencode/deepseek-v4.1-flash-free`. The effort is `--variant <effort>`, omitted for `default`. OpenCode accepts an unknown variant silently, so only a registered family's efforts are checked.",
      "Each lane runs the `build` agent (`--agent build`, because a config's `default_agent` would otherwise pick another agent) with a run-owned config whose `\"*\": \"deny\"` permission removes every tool the config does not allow from the model's tool list. A read-only lane allows `read`, `glob`, `grep`, `list` and `todowrite`. OpenCode's permission policy enforces this, not an OS sandbox.",
      "No OpenCode writer is confined, so a writer needs the model sheet's opt-in (`isolated-write-full-access`); the runner refuses a bounded `isolated-write` lane before launch. An opted-in writer's config also allows `bash`, `edit` and `write`. Measured with OpenCode 1.19.1 on macOS in a linked worktree under the home directory, whose main repository and a sibling directory sat beside it: edits, shell writes and a Python run inside the worktree succeeded. The `external_directory` rule stopped the edit tool outside the worktree except through a symlinked directory, and the shell wrote into the sibling, the main checkout, the main repository's shared `.git`, a home directory, `/tmp` and `$TMPDIR`.",
      "The runner writes that config to `<receipt>.provider/opencode.json` (0600, in a 0700 directory), points `OPENCODE_CONFIG` at it, and sets `XDG_CONFIG_HOME` and `OPENCODE_TEST_HOME` to the directory, so OpenCode reads the run-owned directory in place of the host's `~/.config/opencode/` and `~/.opencode/`. OpenCode 1.19.1 merges `~/.opencode/opencode.json` after `OPENCODE_CONFIG` and imports `~/.opencode/plugins/*.js` even with `--pure`, and it finds that home `.opencode/` through `OPENCODE_TEST_HOME` when set. Measured with a fresh `HOME` whose `.opencode/opencode.json` allowed `bash`, `edit` and `write` and whose `.opencode/plugins/` held a canary plugin: without `OPENCODE_TEST_HOME`, `opencode debug agent build` listed those tools and the canary ran, and neither `OPENCODE_CONFIG_CONTENT` nor `OPENCODE_CONFIG_DIR` changed that; with it, `debug agent build` and `debug config` showed only the lockdown, the canary did not run, and a lane asked to write and edit files changed nothing. Stored logins still come from the real home. `OPENCODE_DISABLE_PROJECT_CONFIG=1` stops the repository's `opencode.json`, `opencode.jsonc`, `.opencode/` agents and commands, and `AGENTS.md` from loading. `OPENCODE_DISABLE_CLAUDE_CODE=1` stops `~/.claude/CLAUDE.md` and `~/.claude/skills`, and `OPENCODE_DISABLE_EXTERNAL_SKILLS=1` stops `~/.agents/skills`. `OPENCODE_DISABLE_AUTOUPDATE=1` and `--pure` turn off updates and external plugins. The built-in `customize-opencode` skill remains, but the `skill` tool is denied.",
      "A managed config (`/Library/Application Support/opencode/` on macOS, `/etc/opencode/` on Linux) merges after the run-owned config and overrides it. Measured on OpenCode 1.19.1 with layers planted through the binary's `OPENCODE_TEST_MANAGED_CONFIG_DIR` redirect: a managed `mcp` server started in a real lane, a managed `lsp` command ran when the model called `read`, a managed `provider` `baseURL` rerouted the lane, and a managed `agent.build` prompt replaced the build agent's prompt. `--agent build` and `-m` took precedence over a managed `default_agent` and `agent.build.model`, and `--pure` kept a managed `plugin` from loading. On macOS, `/Library/Managed Preferences/<user>/ai.opencode.managed.plist` and `/Library/Managed Preferences/ai.opencode.managed.plist` merge last. The plist layer is from OpenCode's source and was not measured.",
      "A stored `wellknown` login (from `opencode providers login <url>`) or an active console organization (from `opencode console login`) makes every OpenCode process, including each lane, fetch remote config and merge it into the lane's configuration. Measured with a fake well-known login and a local server, whose config added an MCP server and a `default_agent`. The console organization fetch is from OpenCode's source and was not measured.",
      "OpenCode 1.19.1 imports a repository's `.opencode/plugins/*.js` from the cwd or a parent up to the git root, even with `--pure` and `OPENCODE_DISABLE_PROJECT_CONFIG=1`. The import runs each module's top-level code; only the plugin's initialization is skipped.",
      "The child environment drops every other `OPENCODE_*` variable, because `OPENCODE_PERMISSION` turns `bash` and `edit` back on and others replace the config or the model catalog. It also drops provider keys such as `OPENROUTER_API_KEY`. A lane authenticates through OpenCode's stored logins (`opencode auth login`, kept in `~/.local/share/opencode/auth.json`), or uses a free OpenCode Zen model, which needs no login.",
      "The preflight runs `opencode models <provider>`, where `<provider>` is the model's part before the first `/`. It passes when it exits 0 and one line equals the model. `Error: Provider not found:` with a nonzero exit is `unauthenticated`/77. Exit 0 without the model line is `unavailable-model`/69, and so is a model with no `/`. Any other output is `child-failed`/70.",
      "The lane passes `--title pstack-lane`, because without a title OpenCode calls a second model to name the session. The prompt goes on stdin.",
      "The reply, session ID, token usage and cost come from the `--format json` event stream on stdout. A lane is complete only when the last `step_finish` has reason `stop` and a `text` event follows the last `step_start`; the reply is those texts in order. Usage and cost are summed over every `step_finish`. An `error` event is `child-failed`/70. For an unknown model that event says only `UnknownError`, and `--print-logs --log-level ERROR` puts its `ProviderModelNotFoundError` cause on stderr, which the receipt keeps. A final `step_finish` with reason `tool-calls` is a permission prompt that headless OpenCode auto-rejected at exit 0, and is `child-failed`/70. Exit 130 or 143 after a signal is `cancelled`/130.",
      "No event names the served model, so the model proof is the pinned argv (`pinned-argv`).",
      "Sessions stay in the local session database. The config turns sharing off, and OpenCode 1.19.1 keeps no server-side session record.",
    ],
  },
});

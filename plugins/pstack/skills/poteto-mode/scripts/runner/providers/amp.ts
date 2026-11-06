import { type Access, adapter, type LaunchFacts, type ParseResult } from "../registry/contract.ts";
import type { NormalizedUsage } from "../types.ts";
import { BASE_ALLOWLIST, BASE_PREFIXES, normalizedUsage, nullableString, object, type JsonObject } from "./shared.ts";

const EDITS = ["create_file", "edit_file", "apply_patch"];
// `smart` lists `shell_command`, and Amp checks the call's permission as `async_shell_command`.
const SHELLS = ["shell_command", "async_shell_command"];

function lockdown(access: Access) {
  const writer = access.mode === "isolated-write";
  return {
    "amp.mcpServers": {},
    "amp.skills.disableClaudeCodeSkills": true,
    "amp.skills.disableGlobalAgentsSkills": true,
    "amp.tools.enable": writer ? ["Read", ...EDITS, ...SHELLS] : ["Read"],
    "amp.permissions": [
      { tool: "Read", action: "allow" },
      ...(writer
        ? [...EDITS, ...SHELLS].map((tool) => ({ tool, action: "allow" }))
        : [...EDITS, "shell_command"].map((tool) => ({ tool, action: "reject" }))),
      { tool: "code_exec", action: "reject" },
      { tool: "*", action: "reject" },
    ],
    "amp.updates.mode": "disabled",
    "amp.notifications.enabled": false,
  };
}

// SIGINT and SIGTERM both exit 0 with this result error.
const CANCELLED = "User cancelled (SIGINT/SIGTERM)";

function summed(entries: readonly NormalizedUsage[]): NormalizedUsage | null {
  if (entries.length === 0) return null;
  const total: Record<string, number> = {};
  for (const entry of entries) {
    for (const [key, value] of Object.entries(entry)) {
      if (value !== undefined) total[key] = (total[key] ?? 0) + value;
    }
  }
  return total;
}

// Claude Code-style stream JSON. The result event decides, because failures and cancellations exit 0.
function parse(stdout: string): ParseResult {
  let result: JsonObject | null = null;
  const usage: NormalizedUsage[] = [];
  for (const line of stdout.split("\n")) {
    if (line.trim().length === 0) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      return { kind: "malformed", message: "amp emitted a non-JSON event" };
    }
    const event = object(raw);
    if (event?.type === "assistant") {
      const entry = normalizedUsage(object(event.message)?.usage);
      if (entry !== null) usage.push(entry);
    }
    if (event?.type === "result") result = event;
  }
  if (result === null) return { kind: "malformed", message: "amp stream did not contain a result event" };
  if (typeof result.is_error !== "boolean") {
    return { kind: "malformed", message: "amp result did not contain a valid terminal status" };
  }
  const metadata = { reportedModel: null, sessionId: nullableString(result.session_id), usage: summed(usage), costUsd: null };
  if (result.is_error) {
    const message = nullableString(result.error) ?? `amp reported ${String(result.subtype)}`;
    return { kind: "provider-failure", status: message === CANCELLED ? "cancelled" : "child-failed", message, metadata };
  }
  if (result.subtype !== "success") return { kind: "malformed", message: `amp result subtype was ${String(result.subtype)}` };
  const text = nullableString(result.result);
  if (text === null) return { kind: "malformed", message: "amp result did not contain final text" };
  return { kind: "complete", text, metadata };
}

function settingsPath(facts: LaunchFacts): string {
  const config = facts.providerSidecar?.config ?? null;
  if (config === null) throw new Error("amp argv needs the lane's provider settings path");
  return config;
}

export const amp = adapter({
  id: "amp",
  executable: "amp",
  effortIn: "model-id",
  preflight: {
    argv: () => ["usage"],
    retryAfterUnauthenticatedMs: null,
    // The first line holds the account email and the next one the credit balance, so the evidence is fixed.
    classify(run) {
      if (run.exitCode === 0 && run.stdout.startsWith("Signed in as ")) return { kind: "passed", evidence: "authenticated" };
      if (run.exitCode === 1 && `${run.stdout}\n${run.stderr}`.includes("Invalid or missing API key")) {
        return { kind: "unauthenticated" };
      }
      return { kind: "inconclusive" };
    },
  },
  launch: {
    prompt: "stdin",
    sidecar: { output: null, config: { name: "settings.json", content: (lane) => `${JSON.stringify(lockdown(lane.access), null, 2)}\n` } },
    supports: ["read-only", "isolated-write-full-access"],
    needsSharedGitDir: () => false,
    argv: (lane, facts) => [
      "-x",
      "--stream-json",
      "-m",
      lane.cliModel,
      "--settings-file",
      settingsPath(facts),
      "--visibility",
      "private",
      "--no-ide",
      "--no-notifications",
      "-l",
      "pstack-runner",
    ],
  },
  parse: (run) => parse(run.stdout),
  proof: { report: "absent", matches: () => false },
  // No AMP_ prefix: AMP_SETTINGS_FILE, AMP_EXECUTOR (`orb` runs the turn remotely), AMP_INITIAL_AGENT_MODE_KEY and
  // AMP_URL would change the settings, where the turn runs, the mode or the service.
  environment: () => ({
    kind: "allowlist",
    names: [...BASE_ALLOWLIST, "AMP_API_KEY"],
    prefixes: BASE_PREFIXES,
    set: { AMP_IGNORE_GUIDANCE_FILES: "*" },
  }),
  docs: {
    name: "Amp CLI",
    hostPrerequisites: [],
    statePaths: [
      "`~/.local/share/amp/` (the login in `secrets.json`, accounts, session and recent threads) and `~/.cache/amp/` (logs, downloaded plugins and skills)",
    ],
    notes: [
      "Effort is part of the model ID. The model is an official Amp agent mode, such as `deepseek-v4.1-flash`, from Amp's own `official-modes` plugin, which Amp serves to every user. Where a mode has effort variants, the variant is part of its name (for example `gpt-6-astra-low` to `gpt-6-astra-max`). An unregistered Amp model must be a mode name with the `default` effort. An unknown mode exits 1 with a generic error and ends `child-failed`/70.",
      "No Amp writer is confined, so a writer needs the model sheet's opt-in (`isolated-write-full-access`); the runner refuses a bounded `isolated-write` lane before launch. An opted-in writer's settings also enable and allow `create_file`, `edit_file`, `apply_patch`, `shell_command` and `async_shell_command`, the name Amp checks a `shell_command` call against. `code_exec` and every other tool stay rejected. Measured with Amp CLI 0.0.1792123242-g03edc7 on macOS 27.0.1 in the built-in `smart` mode, whose tools are `apply_patch` and `shell_command`, in a linked worktree under the home directory, whose main repository and a sibling directory sat beside it: edits, shell writes and a Python run inside the worktree succeeded. The edit tool wrote into the sibling, the main checkout, through symlinks to both, `/tmp` and a home directory. The shell wrote into each of those, the main repository's shared `.git` and `$TMPDIR`. An edit into the shared `.git` and one into `$TMPDIR` never returned: the first raised a UI request that execute mode cannot answer, and both turns waited until they were cancelled. The runner adds no timeout, so such a writer lane runs until the parent cancels it. The account's official modes failed that day with a server `agentMode` validation error, so the measurement used `smart`.",
      "A read-only lane is a run-owned `--settings-file` in its private `<receipt>.provider/` directory (0700). It enables only the `Read` tool and rejects every other tool, which turns off the shell, edits, subagents, web tools, code execution, thread tools and `manage_amp`. It also turns off MCP servers, Claude Code and `~/.agents` skills, updates and notifications. The lane sets `AMP_IGNORE_GUIDANCE_FILES=*`, so `AGENTS.md` in the cwd and its parents does not load. `Read` can read any path on the host. Measured with Amp CLI 0.0.1792094445-g3475f5 and 0.0.1792123242-g03edc7.",
      "Amp's own `official-modes` plugin supplies the pinned modes and runs its code in every lane. Amp serves and updates it with no version pin: its cache hash changed from `a1f1ef61c4dd011d` to `cb61cf1a7f4be96c` between 2026-10-15 and 2026-10-16.",
      "System plugins in `$XDG_CONFIG_HOME/amp/plugins` or `~/.config/amp/plugins` load in every lane, and the lane keeps an inherited `XDG_CONFIG_HOME`. A plugin is Bun code that runs as the user, and Amp has no production switch that turns plugins off (`AMP_DISABLE_PLUGINS` is ignored outside development builds). Measured with Amp CLI 0.0.1792123242-g03edc7: a system plugin ran at import and in the `session.start`, `agent.start` and `agent.end` hooks. One that called `configuration.update` at startup rewrote the lane's settings file to enable every tool with an allow-all rule, after which the model had 29 tools and ran a shell write in the cwd. One that registered the key `deepseek-v4.1-flash` replaced the official mode's prompt and tools, while the argv still named that mode.",
      "Personal and workspace plugins come from ampcode.com, load in every lane and use the same plugin API as system plugins. The measured account had none.",
      "A machine `managed-settings.json` (`/Library/Application Support/ampcode/` on macOS, `/etc/ampcode/` on Linux) and server-managed workspace settings apply above the user settings that `--settings-file` replaces, per Amp's settings docs, so they can change the enabled tools and permissions. Neither was measured: the Mac had no managed file, and the account has no workspace.",
      "A repository's `.amp/settings.json` in the cwd overrides the run-owned settings, and its `.amp/plugins/*.ts` runs at startup with no trust check. Measured with Amp CLI 0.0.1792094445-g3475f5: a cwd `.amp/settings.json` turned `create_file` and `shell_command` back on, and a `.amp/plugins/` plugin ran. A workspace MCP server in `.amp/` waited for approval and did not start.",
      "The environment is an allowlist that adds only `AMP_API_KEY`. No other `AMP_` name passes: `AMP_SETTINGS_FILE`, `AMP_EXECUTOR`, `AMP_INITIAL_AGENT_MODE_KEY` and `AMP_URL` would change the settings, where the turn runs, the mode or the service.",
      "The preflight is `amp usage`, run without a terminal. It passes when it exits 0 and starts with `Signed in as `, and records the fixed evidence `authenticated`, because the output holds the account email and credit balance. Exit 1 with `Invalid or missing API key` is `unauthenticated`/77, and any other output is `child-failed`/70. A logged-out Amp command other than `amp usage` can open a browser login on its own, which is why the runner never starts a turn without a passing preflight.",
      "The reply, session and token usage come from the stream JSON on stdout: the reply is the `result` event's text, the session is its `session_id` (`T-<uuid>`, also the ampcode.com thread ID), and the usage sums each assistant message's `usage`. The stream has no cost and never names the model, so the proof is the pinned mode in the argv (`pinned-argv`).",
      "Failures and cancellations can exit 0, so the `result` event decides. `is_error: true` with `User cancelled (SIGINT/SIGTERM)` is `cancelled`/130, and any other `is_error` result is `child-failed`/70 with its error text, for example a Claude mode on a subscription-only account. A rejected tool comes back to the model as an ordinary tool result, and the turn can still complete.",
      "Each run is an ampcode.com thread holding the prompt, tool inputs and outputs, the hostname and the working directory. The lane passes `--visibility private` and the label `pstack-runner`; every captured thread was private and archived. Turns spend Amp credits, or a linked ChatGPT subscription for GPT modes.",
    ],
  },
});

import { type Access, adapter, type ModelRun, type ParseResult, type ProviderMetadata } from "../registry/contract.ts";
import { modelFailureStatus, type NormalizedUsage } from "../types.ts";
import { BASE_ALLOWLIST, BASE_PREFIXES, effortArgs, finiteNumber, nullableString, object, type JsonObject } from "./shared.ts";

// SIGINT exits 130 and SIGTERM 143, each with no terminal event. Measured with Muse Code 1.4.14.
const SIGNAL_EXITS = [130, 143];

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

function usage(stream: readonly JsonObject[]): NormalizedUsage | null {
  const models = stream.filter((event) => event.payload_type === "run.usage")
    .flatMap((event) => {
      const entries = object(event.payload)?.models;
      return Array.isArray(entries) ? entries.map(object) : [];
    });
  if (models.length === 0) return null;
  const sum = (field: string) => models.reduce((total, entry) => total + (finiteNumber(entry?.[field]) ?? 0), 0);
  return {
    inputTokens: sum("input_tokens"),
    cachedInputTokens: sum("cached_tokens"),
    outputTokens: sum("output_tokens"),
    reasoningTokens: sum("reasoning_tokens"),
  };
}

function metadata(stream: readonly JsonObject[]): ProviderMetadata {
  const session = stream.map((event) => object(event.stream)).find((entry) => entry?.kind === "session");
  return { reportedModel: null, sessionId: nullableString(session?.id), usage: usage(stream), costUsd: null };
}

function parse(run: ModelRun): ParseResult {
  const stream = events(run.stdout);
  const found = metadata(stream ?? []);
  if (run.exitCode !== null && SIGNAL_EXITS.includes(run.exitCode)) {
    return { kind: "provider-failure", status: "cancelled", message: `muse exited with status ${run.exitCode} after a signal`, metadata: found };
  }
  if (stream === null) return { kind: "malformed", message: "muse emitted a non-JSON event" };
  const terminal = stream.findLast((event) => typeof event.payload_type === "string" && event.payload_type.startsWith("run.terminal."));
  const payload = object(terminal?.payload);
  if (payload === null) return { kind: "malformed", message: "muse ended without a terminal event" };
  if (payload.terminal !== "completed") {
    const reason = nullableString(payload.reason) ?? "no reason";
    if (modelFailureStatus(reason) === "unavailable-model") return { kind: "malformed", message: `muse named an unavailable model: ${reason}` };
    return { kind: "provider-failure", status: "child-failed", message: `muse run ended ${String(payload.terminal)}: ${reason}`, metadata: found };
  }
  const text = nullableString(payload.text);
  if (text === null) return { kind: "malformed", message: "muse completed the run without final text" };
  return { kind: "complete", text, metadata: found };
}

function accessArgs(access: Access): readonly string[] {
  return access.mode === "read-only" ? ["--disable-write", "--disable-shell"] : [];
}

export const muse = adapter({
  id: "muse",
  executable: "muse",
  effortIn: "flag",
  preflight: {
    argv: () => ["usage"],
    retryAfterUnauthenticatedMs: null,
    // The output names the subscription tier and allowance, so the evidence is fixed.
    classify(run) {
      if (run.exitCode === 0 && run.stdout.startsWith("Tier: ")) return { kind: "passed", evidence: "authenticated" };
      return run.exitCode === 1 && /^muse usage: not logged in:/m.test(run.stderr) ? { kind: "unauthenticated" } : { kind: "inconclusive" };
    },
  },
  launch: {
    prompt: "file",
    sidecar: null,
    supports: ["read-only", "isolated-write-full-access"],
    needsSharedGitDir: () => false,
    argv: (lane) => [
      "exec",
      "--json",
      "--model",
      lane.cliModel,
      ...effortArgs(lane, ["--reasoning-effort", lane.effort]),
      "--prompt-file",
      lane.promptPath,
      "--workspace",
      lane.cwd,
      "--worktree",
      "off",
      "--approval-mode",
      "never",
      "--approval-judge",
      "off",
      "--disable-web-tools",
      "--disable-reminders",
      "--disable-request-user-input",
      "--no-foreign-personal-context",
      "--no-session-log",
      ...accessArgs(lane.access),
    ],
  },
  parse: (run) => parse(run),
  proof: { report: "absent", matches: () => false },
  environment: () => ({ kind: "allowlist", names: BASE_ALLOWLIST, prefixes: BASE_PREFIXES }),
  docs: {
    name: "Muse Code",
    hostPrerequisites: [],
    statePaths: [
      "`~/.config/muse/` (the login in `auth.json`, which the CLI reads and refreshes, `settings.json` and `trust.json`)",
      "`~/.local/share/muse/` (the session index, model catalog cache, plugins, skills and runtime state it writes) and `~/Library/Application Support/Muse/` on macOS",
    ],
    notes: [
      "Measured with Muse Code 1.4.14 on macOS. Every flag in the argv is in the recorded `muse --help` and `muse exec --help`. A lane runs `exec --json --model <model> --prompt-file <prompt> --workspace <cwd> --worktree off --approval-mode never --approval-judge off` with web tools, reminders, `request_user_input`, foreign personal context and the session log turned off. The effort is `--reasoning-effort <effort>`, omitted for `default`; Muse also accepts `none` and `minimal`, which the runner does not offer. The parent owns the worktree, so Muse creates none. No Muse family is registered, so a lane names a catalog model, such as `muse-spark-1.3` or `muse-wonder-1.0`.",
      "A read-only lane adds `--disable-write --disable-shell`. The file-reading tools remain, and a write request fails with `writes are disabled for this session`.",
      "No Muse writer is confined, so a writer needs the model sheet's opt-in (`isolated-write-full-access`); the runner refuses a bounded `isolated-write` lane before launch. An opted-in writer drops `--disable-write` and `--disable-shell` and keeps Muse's sandbox on. Measured in a linked worktree under the home directory, whose main repository and a sibling directory sat beside it: edits, shell writes and a Python run inside the worktree succeeded. The file tools refused every path outside the workspace (`absolute path is outside the workspace`, `path escapes workspace`) except the system temporary folders. The sandboxed shell failed outside the worktree with `Operation not permitted`, except that it wrote into the main repository's shared `.git`, `/tmp` and `$TMPDIR`. With `--disable-sandbox`, the file tools and the shell wrote into every outside target, so the runner never passes it.",
      "With `--approval-mode never --approval-judge off`, a refused tool call returns its error to the model and the run continues. Muse reports `Agent delegation: auto unavailable: workspace is untrusted` on stderr, and the lane never passes `--trust-workspace`, so the workspace's skills and rules do not load.",
      "Muse reads `~/.config/muse/settings.json` in every lane. Its `endpoint_transport` key reroutes every lane to another endpoint: on the measured host, a value that another tool wrote sent each lane to a proxy, and every turn failed with `still unauthorized after a token refresh`. The runner does not override it.",
      "The environment is the base allowlist. The login is found through `HOME`. `muse login --help` says `META_API_KEY` takes priority over the account login; the lane does not pass it, and that path is not measured.",
      "The preflight runs `muse usage`. It passes when it exits 0 and starts with `Tier: `, with the fixed evidence `authenticated`, because the output names the subscription tier. Exit 1 with `muse usage: not logged in:` is `unauthenticated`/77. Any other output, such as `No subscription allowance (api_key)`, is `child-failed`/70.",
      "The `--json` stream is one envelope per line, dispatched on `payload_type`. The reply is the text of the last `run.terminal.*` event, accepted only when its `terminal` is `completed` and the text is not empty. Another terminal is `child-failed`/70 with its reason, except that `model `<id>` does not exist or you lack access` is `unavailable-model`/69. SIGINT exits 130 and SIGTERM 143, each with no terminal event, which is `cancelled`/130; a stream with no terminal event otherwise is `malformed-output`/65. The session is the `session` stream ID, and usage sums the `run.usage` event's per-model tokens. No cost is reported.",
      "`run.model.configured` repeats the requested model, and no event was shown to name a different served model, so the model proof is the pinned argv (`pinned-argv`).",
    ],
  },
});

import { adapter, type Lane, type ParseResult } from "../registry/contract.ts";
import type { AccessMode } from "../types.ts";
import {
  BASE_ALLOWLIST,
  BASE_PREFIXES,
  boundedOutput,
  effortArgs,
  exactOrSuffixed,
  failedPreflight,
  finiteNumber,
  modelFromUsage,
  namedPreflightFailure,
  normalizedUsage,
  nullableString,
  object,
  type JsonObject,
} from "./shared.ts";

const ENVIRONMENT_PREFIXES = [...BASE_PREFIXES, "GROK_", "XAI_"];

const LOGIN = /\blogged in\b|\bYou are using XAI_API_KEY\.|\bYou are authenticated via deployment key\./i;

// grok names its configured default above the list even when the account cannot use it,
// so only the lines under the header count.
function modelAvailable(value: string, model: string): boolean {
  const lines = value.split("\n");
  const header = lines.findIndex((line) => /^\s*Available models:/.test(line));
  if (header < 0) return false;
  const escaped = model.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const listed = new RegExp(`(^|[^A-Za-z0-9_.-])${escaped}($|[^A-Za-z0-9_.-])`);
  return lines.slice(header + 1).some((line) => listed.test(line));
}

function sandbox(mode: AccessMode): string {
  return mode === "read-only" ? "read-only" : "workspace";
}

function tools(mode: AccessMode): string {
  const readonly = ["read_file", "grep", "list_dir", "run_terminal_cmd"];
  return [...readonly, ...(mode === "isolated-write" ? ["search_replace"] : [])].join(",");
}

function parse(stdout: string, lane: Lane): ParseResult {
  let result: JsonObject | null = null;
  for (const line of stdout.split("\n")) {
    if (line.trim().length === 0) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      return { kind: "malformed", message: "grok emitted a non-JSON event" };
    }
    const event = object(raw);
    if (event?.type === "result") result = event;
  }

  if (result === null) return { kind: "malformed", message: "grok result did not contain a terminal event" };
  if (nullableString(result.subtype) === null || typeof result.is_error !== "boolean") {
    return { kind: "malformed", message: "grok result did not contain a valid terminal status" };
  }
  const metadata = {
    reportedModel: modelFromUsage(result.modelUsage, lane, exactOrSuffixed),
    sessionId: nullableString(result.session_id),
    usage: normalizedUsage(result.usage),
    costUsd: finiteNumber(result.total_cost_usd) ?? null,
  };
  if (result.is_error || result.subtype !== "success") {
    const errors = Array.isArray(result.errors)
      ? result.errors.filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
      : [];
    const message = errors.join("\n") || nullableString(result.error)
      || nullableString(object(result.error)?.message) || nullableString(result.result)
      || `grok reported ${result.subtype}`;
    const cancelled = result.stop_reason === "cancelled" || result.stop_reason === "canceled"
      || result.subtype === "cancelled" || result.subtype === "canceled"
      || /^(?:User cancel(?:led|ed) the execution|PermissionCancelled)/i.test(message);
    return { kind: "provider-failure", status: cancelled ? "cancelled" : "child-failed", message, metadata };
  }
  const text = nullableString(result.result);
  if (text === null) return { kind: "malformed", message: "grok result did not contain final text" };

  return { kind: "complete", text, metadata };
}

export const grok = adapter({
  id: "grok",
  executable: "grok",
  effortIn: "flag",
  preflight: {
    argv: () => ["models"],
    retryAfterUnauthenticatedMs: 5_000,
    classify(run, lane) {
      const combined = `${run.stdout}\n${run.stderr}`;
      if (run.exitCode === 0 && namedPreflightFailure(combined) === null && LOGIN.test(combined)
          && modelAvailable(combined, lane.model)) {
        return { kind: "passed", evidence: `authenticated; model ${lane.model} available` };
      }
      return failedPreflight(
        run,
        modelAvailable(boundedOutput(run), lane.model) ? "unauthenticated" : "unavailable-model"
      );
    },
  },
  launch: {
    prompt: "file",
    sidecar: null,
    supports: ["read-only", "isolated-write"],
    needsSharedGitDir: () => false,
    argv: (lane) => [
      "--prompt-file",
      lane.promptPath,
      "--model",
      lane.model,
      ...effortArgs(lane, ["--reasoning-effort", lane.effort]),
      // Headless Grok cancels the whole turn on a permission prompt, in both access modes.
      // Auto mode reports a blocked call to the model instead; the sandbox still confines
      // writes (read-only, or workspace for isolated-write).
      "--permission-mode",
      "auto",
      "--sandbox",
      sandbox(lane.access.mode),
      "--tools",
      tools(lane.access.mode),
      "--disallowed-tools",
      "Agent,search_tool,use_tool",
      "--output-format",
      "streaming-messages-json",
      "--cwd",
      lane.cwd,
      "--no-subagents",
      "--disable-web-search",
      "--verbatim",
    ],
  },
  parse: (run, lane) => parse(run.stdout, lane),
  proof: { report: "required", matches: exactOrSuffixed },
  environment: () => ({ kind: "allowlist", names: BASE_ALLOWLIST, prefixes: ENVIRONMENT_PREFIXES }),
  docs: {
    name: "Grok Build CLI",
    hostPrerequisites: ["Linux: Landlock and `bwrap`", "macOS: any `/var/run/docker.sock` symlink points inside Grok's runtime-socket list"],
    statePaths: ["`~/.grok/`, which the CLI writes (for example `~/.grok/managed_config.toml`)"],
    notes: [
      "`fast` is part of Cursor's Grok selector, not a Grok Build CLI model or effort flag.",
      "The preflight passes when `grok models` reports a login (`logged in`, `You are using XAI_API_KEY.`, or `You are authenticated via deployment key.`) and lists the lane's model on a line under `Available models:`. A model named only above that header, such as on the `Default model:` line, or output without the header, is `unavailable-model`/69.",
      "On macOS, Grok 1.0.77's sandbox refuses to start when a runtime socket it blocks, such as `/var/run/docker.sock`, is a symlink to a path outside its built-in list (`/var/run/docker.sock`, the podman and containerd sockets, `~/.docker/desktop/docker.sock`, `~/.docker/run/docker.sock`). OrbStack's link to `~/.orbstack/run/docker.sock` triggers it, and a `sandbox.toml` deny entry does not help. Removing the link (`sudo rm /var/run/docker.sock`; `docker` keeps working through the `orbstack` context) lets the bounded sandbox start (#275).",
      "The authentication preflight has one bounded retry. If the first `grok models` result would be classified as unauthenticated, the runner waits five seconds and tries the same preflight once more. A second failure is terminal. The delay and second attempt share the runner's absolute deadline and cancellation latch, and the receipt keeps evidence from both attempts. Model execution is never retried.",
    ],
  },
});

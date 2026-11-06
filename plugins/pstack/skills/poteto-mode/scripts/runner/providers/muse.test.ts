import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ModelRun } from "../registry/contract.ts";
import type { LaneRequest } from "../registry/index.ts";
import { modelFailureStatus } from "../types.ts";
import { adapterSuite, testFacts, testLane } from "./adapter-suite.ts";
import { muse } from "./muse.ts";

adapterSuite(muse);

const fixture = (name: string): string => readFileSync(join(import.meta.dir, "fixtures/muse", name), "utf8");
const lane = (request: Partial<LaneRequest> = {}) => testLane({ provider: "muse", model: "muse-spark-1.3", effort: "low", ...request });
const run = (overrides: Partial<ModelRun>): ModelRun => ({ exitCode: 0, stdout: "", stderr: "", sidecar: null, ...overrides });
const help = fixture("help.txt") + fixture("exec-help.txt");

describe("muse launch", () => {
  it("runs a read-only lane with writes and the shell disabled and every flag from the recorded help", () => {
    const argv = muse.launch.argv(lane(), testFacts(muse));
    expect(argv).toEqual([
      "exec", "--json", "--model", "muse-spark-1.3", "--reasoning-effort", "low", "--prompt-file", "/tmp/prompt.md",
      "--workspace", "/tmp/worktree", "--worktree", "off", "--approval-mode", "never", "--approval-judge", "off",
      "--disable-web-tools", "--disable-reminders", "--disable-request-user-input", "--no-foreign-personal-context",
      "--no-session-log", "--disable-write", "--disable-shell",
    ]);
    for (const flag of argv.filter((token) => token.startsWith("--"))) expect(help).toMatch(new RegExp(`^ +(-[a-z], )?${flag}( |\n)`, "m"));
  });

  it("runs an opted-in writer with the sandbox on, and refuses a bounded writer", () => {
    const writer = muse.launch.argv(lane({ mode: "isolated-write", writerSandbox: "full-access" }), testFacts(muse));
    expect(writer).toEqual(muse.launch.argv(lane(), testFacts(muse)).slice(0, -2));
    expect(writer).not.toContain("--disable-sandbox");
    expect(() => lane({ mode: "isolated-write" }))
      .toThrow("provider muse does not support isolated-write; it supports only: read-only, isolated-write-full-access");
  });
});

describe("muse preflight", () => {
  it("passes a signed-in `muse usage` with fixed evidence and reads `not logged in` as unauthenticated", () => {
    expect(muse.preflight.argv(lane(), null)).toEqual(["usage"]);
    expect(muse.preflight.classify({ exitCode: 0, stdout: fixture("usage-logged-in.txt"), stderr: "" }, lane()))
      .toEqual({ kind: "passed", evidence: "authenticated" });
    expect(muse.preflight.classify({ exitCode: 1, stdout: "", stderr: fixture("usage-logged-out.stderr.txt") }, lane()))
      .toEqual({ kind: "unauthenticated" });
    expect(muse.preflight.classify({ exitCode: 0, stdout: "No subscription allowance (api_key)\n", stderr: "" }, lane()))
      .toEqual({ kind: "inconclusive" });
  });
});

describe("muse parse", () => {
  it("completes from the terminal event's text with the session and summed usage", () => {
    expect(muse.parse(run({ stdout: fixture("read-only.jsonl") }), lane())).toEqual({
      kind: "complete",
      text: "pelican\n\nI did not create `written.txt` — writes are disabled for this session, so it did not work.\n",
      metadata: {
        reportedModel: null,
        sessionId: "01a1b0d1-5bc5-7991-b672-c9331f087027",
        usage: { inputTokens: 46636, cachedInputTokens: 23153, outputTokens: 1086, reasoningTokens: 938 },
        costUsd: null,
      },
    });
    expect(muse.parse(run({ stdout: fixture("writer.jsonl") }), lane()).kind).toBe("complete");
  });

  it("reads an unknown model's failed terminal as an unavailable model, and other failures as child-failed", () => {
    const unknown = muse.parse(run({ exitCode: 1, stdout: fixture("unknown-model.jsonl") }), lane());
    expect(unknown.kind).toBe("malformed");
    expect(modelFailureStatus(unknown.kind === "malformed" ? unknown.message : "")).toBe("unavailable-model");
    const failed = fixture("read-only.jsonl").replace(/"terminal":"completed","text":"[^"]*","reason":null/, '"terminal":"failed","text":"","reason":"quota"');
    expect(muse.parse(run({ exitCode: 1, stdout: failed }), lane()))
      .toMatchObject({ kind: "provider-failure", status: "child-failed", message: "muse run ended failed: quota" });
  });

  it("reads exit 130 or 143 as cancelled and refuses a stream with no terminal event or final text", () => {
    expect(muse.parse(run({ exitCode: 130, stdout: fixture("sigint.jsonl") }), lane()))
      .toMatchObject({ kind: "provider-failure", status: "cancelled" });
    expect(muse.parse(run({ exitCode: 0, stdout: fixture("sigint.jsonl") }), lane()))
      .toEqual({ kind: "malformed", message: "muse ended without a terminal event" });
    const empty = fixture("read-only.jsonl").replace(/"terminal":"completed","text":"[^"]*"/, '"terminal":"completed","text":""');
    expect(muse.parse(run({ stdout: empty }), lane())).toEqual({ kind: "malformed", message: "muse completed the run without final text" });
    expect(muse.parse(run({ stdout: "not json\n" }), lane())).toEqual({ kind: "malformed", message: "muse emitted a non-JSON event" });
  });
});

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { access } from "../registry/contract.ts";
import type { ModelRun } from "../registry/contract.ts";
import type { LaneRequest } from "../registry/index.ts";
import { adapterSuite, testFacts, testLane } from "./adapter-suite.ts";
import { amp } from "./amp.ts";
import { BASE_ALLOWLIST, BASE_PREFIXES } from "./shared.ts";

adapterSuite(amp);

const fixture = (name: string): string => readFileSync(join(import.meta.dir, "fixtures/amp", name), "utf8");

const lane = (request: Partial<LaneRequest> = {}) =>
  testLane({ provider: "amp", model: "deepseek-v4.1-flash", effort: "default", ...request });
const run = (overrides: Partial<ModelRun>): ModelRun => ({ exitCode: 0, stdout: "", stderr: "", sidecar: null, ...overrides });
const preflight = (exitCode: number, stdout: string, stderr = "") => amp.preflight.classify({ exitCode, stdout, stderr }, lane());
const NO_PROOF = { reportedModel: null, costUsd: null };

describe("amp launch", () => {
  it("runs the pinned official mode in execute mode with the run-owned settings, private and labeled", () => {
    expect(amp.launch.argv(lane(), testFacts(amp))).toEqual([
      "-x",
      "--stream-json",
      "-m",
      "deepseek-v4.1-flash",
      "--settings-file",
      "/tmp/receipt.json.provider/settings.json",
      "--visibility",
      "private",
      "--no-ide",
      "--no-notifications",
      "-l",
      "pstack-runner",
    ]);
    expect(amp.launch.prompt).toBe("stdin");
    expect(amp.launch.sidecar!.output).toBeNull();
  });

  it("enables and allows the edit and shell tools only for an opted-in writer, and refuses a bounded writer and efforts the mode does not list", () => {
    const writer = lane({ mode: "isolated-write", writerSandbox: "full-access" });
    const settings = JSON.parse(amp.launch.sidecar!.config!.content(writer));
    const tools = ["create_file", "edit_file", "apply_patch", "shell_command", "async_shell_command"];
    expect(settings["amp.tools.enable"]).toEqual(["Read", ...tools]);
    expect(settings["amp.permissions"]).toEqual([
      { tool: "Read", action: "allow" },
      ...tools.map((tool) => ({ tool, action: "allow" })),
      { tool: "code_exec", action: "reject" },
      { tool: "*", action: "reject" },
    ]);
    expect(amp.launch.argv(writer, testFacts(amp))).toEqual(amp.launch.argv(lane(), testFacts(amp)));
    expect(() => lane({ mode: "isolated-write" }))
      .toThrow("provider amp does not support isolated-write; it supports only: read-only, isolated-write-full-access");
    expect(() => lane({ effort: "max" })).toThrow("effort max is not offered for amp:deepseek-v4.1-flash; choose one of: default");
  });

  it("writes the captured lockdown settings", () => {
    const config = amp.launch.sidecar!.config!;
    expect(config.name).toBe("settings.json");
    expect(JSON.parse(config.content(lane()))).toEqual(JSON.parse(fixture("lockdown-settings.json")));
  });

  it("passes only AMP_API_KEY and turns off guidance files", () => {
    expect(amp.environment(access("read-only"), "/tmp/receipt.json.provider")).toEqual({
      kind: "allowlist",
      names: [...BASE_ALLOWLIST, "AMP_API_KEY"],
      prefixes: BASE_PREFIXES,
      set: { AMP_IGNORE_GUIDANCE_FILES: "*" },
    });
  });
});

describe("amp preflight", () => {
  it("passes a signed-in usage report with a fixed summary", () => {
    expect(preflight(0, fixture("usage-logged-in.stdout.txt"))).toEqual({ kind: "passed", evidence: "authenticated" });
    expect(preflight(1, fixture("usage-logged-in.stdout.txt"))).toEqual({ kind: "inconclusive" });
  });

  it("reads the missing-key error at exit 1 as unauthenticated", () => {
    expect(preflight(1, "", fixture("usage-logged-out.stderr.txt"))).toEqual({ kind: "unauthenticated" });
  });

  it("reads any other output as inconclusive", () => {
    for (const [exitCode, stdout, stderr] of [
      [0, "", ""],
      [0, "Would you like to log in to Amp? [(y)es, (n)o]", ""],
      [1, "", fixture("unknown-mode.stderr.txt")],
      [2, "", fixture("usage-logged-out.stderr.txt")],
    ] as const) {
      expect([stdout, stderr, preflight(exitCode, stdout, stderr)]).toEqual([stdout, stderr, { kind: "inconclusive" }]);
    }
  });
});

describe("amp parse", () => {
  it("takes the reply from the result event and sums the assistant usage", () => {
    expect(amp.parse(run({ stdout: fixture("stream-complete-readonly-marker.jsonl") }), lane())).toEqual({
      kind: "complete",
      text: "39d942e7-da69-4370-863f-d2468a9fd511",
      metadata: {
        ...NO_PROOF,
        sessionId: "T-<THREAD_ID>",
        usage: { inputTokens: 0, cachedInputTokens: 1920, cacheCreationInputTokens: 8749, outputTokens: 259 },
      },
    });
  });

  it("completes a turn whose tools were rejected as ordinary tool results", () => {
    expect(amp.parse(run({ stdout: fixture("stream-tool-rejected-by-permission.jsonl") }), lane()))
      .toMatchObject({ kind: "complete", text: expect.stringContaining("blocked by your permission rules") });
  });

  it("reads an exit-0 error result as child-failed with its error text", () => {
    const parsed = amp.parse(run({ stdout: fixture("stream-error-subscription-only-exit0.jsonl") }), lane());
    expect(parsed).toMatchObject({
      kind: "provider-failure",
      status: "child-failed",
      message: expect.stringMatching(/^Claude Usage is set to Subscription Only\./),
      metadata: { ...NO_PROOF, sessionId: "T-<THREAD_ID>", usage: null },
    });
  });

  it("reads the SIGINT/SIGTERM cancellation result as cancelled", () => {
    expect(amp.parse(run({ stdout: fixture("stream-cancel-sigint.jsonl") }), lane())).toEqual({
      kind: "provider-failure",
      status: "cancelled",
      message: "User cancelled (SIGINT/SIGTERM)",
      metadata: { ...NO_PROOF, sessionId: "T-<THREAD_ID>", usage: null },
    });
  });

  it("never returns text without a successful result event", () => {
    expect(amp.parse(run({ exitCode: 1, stderr: fixture("unknown-mode.stderr.txt") }), lane()))
      .toEqual({ kind: "malformed", message: "amp stream did not contain a result event" });
    expect(amp.parse(run({ stdout: "not json\n" }), lane())).toEqual({ kind: "malformed", message: "amp emitted a non-JSON event" });
    const result = (fields: object) => `${JSON.stringify({ type: "result", session_id: "T-1", ...fields })}\n`;
    expect(amp.parse(run({ stdout: result({ subtype: "success", result: "x" }) }), lane()))
      .toEqual({ kind: "malformed", message: "amp result did not contain a valid terminal status" });
    expect(amp.parse(run({ stdout: result({ subtype: "success", is_error: false, result: "" }) }), lane()))
      .toEqual({ kind: "malformed", message: "amp result did not contain final text" });
    expect(amp.parse(run({ stdout: result({ subtype: "error_max_turns", is_error: false, result: "x" }) }), lane()))
      .toEqual({ kind: "malformed", message: "amp result subtype was error_max_turns" });
    expect(amp.parse(run({ stdout: result({ subtype: "error_during_execution", is_error: true }) }), lane()))
      .toMatchObject({ kind: "provider-failure", status: "child-failed", message: "amp reported error_during_execution" });
  });

  it("never claims a served model", () => {
    expect(amp.proof).toMatchObject({ report: "absent" });
    expect(amp.proof.matches(lane(), "deepseek-v4.1-flash")).toBe(false);
  });
});

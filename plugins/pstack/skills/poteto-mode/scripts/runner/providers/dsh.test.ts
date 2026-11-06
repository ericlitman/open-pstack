import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ModelRun } from "../registry/contract.ts";
import type { LaneRequest } from "../registry/index.ts";
import { modelFailureStatus } from "../types.ts";
import { adapterSuite, testFacts, testLane } from "./adapter-suite.ts";
import { dsh } from "./dsh.ts";

adapterSuite(dsh);

const fixture = (name: string): string => readFileSync(join(import.meta.dir, "fixtures/dsh", name), "utf8");

const lane = (request: Partial<LaneRequest> = {}) => testLane({ provider: "dsh", model: "deepseek-flash", effort: "max", ...request });
const run = (overrides: Partial<ModelRun>): ModelRun => ({ exitCode: 0, stdout: "", stderr: "", sidecar: null, ...overrides });
const preflight = (stdout: string, exitCode = 1) => dsh.preflight.classify({ exitCode, stdout, stderr: "" }, lane());

describe("dsh launch", () => {
  it("reads the prompt from stdin with the run-owned patch before --json", () => {
    expect(dsh.launch.argv(lane(), testFacts(dsh))).toEqual([
      "--profile", "headless", "--patch", "/tmp/receipt.json.provider/patch.yml", "--json", "-",
    ]);
    expect(dsh.launch.prompt).toBe("stdin");
    expect(dsh.launch.sidecar?.output).toBeNull();
  });

  it("pins read-only mode, the stored login in place, the model and effort, and turns off the lockdown rows", () => {
    const saved = process.env.DSH_HOME;
    process.env.DSH_HOME = "/srv/dsh";
    const patch = dsh.launch.sidecar!.config!.content(lane({ model: "deepseek-v4-pro", effort: "low", cwd: "/tmp/a dir: #x" }));
    if (saved === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = saved;
    expect(patch).toStartWith([
      "- id: sandbox-policy",
      "  config:",
      "    mode: read-only",
      "    workspaceRoot: \"/tmp/a dir: #x\"",
      "- id: approval",
      "  config:",
      "    policy: ask",
      "- id: credentials",
      "  disabled: false",
      "  config:",
      "    path: \"/srv/dsh/.credentials.yaml\"",
      "- id: agent-default-model",
      "  config:",
      "    provider: deepseek-official",
      "    model: \"deepseek-v4-pro\"",
      "    reasoningEffort: \"low\"",
    ].join("\n") + "\n");
    for (const id of [
      "agent-instructions", "skill-filesystem", "tool-skill", "tool-web", "web", "web-search-deepseek", "web-fetch-http",
      "tool-subagent", "tool-subagent-fork", "tool-subagent-control", "tool-subagent-list-agents", "tool-workflow",
      "workflow-ptc", "plugin-package-inventory-deepseek", "session-title-llm",
    ]) {
      expect(patch).toContain(`- id: ${id}\n  disabled: true\n`);
    }
    expect(patch).toEndWith("- id: session-log-deepseek\n  config:\n    enabled: false\n");
    expect(dsh.launch.sidecar!.config!.content(lane({ model: "deepseek-next", effort: "default" }))).not.toMatch(/^ {4}reasoningEffort:/m);
  });

  it("reads the stored login from the parent's DSH_HOME, resolved as dsh resolves it, else ~/.dsh", () => {
    const saved = process.env.DSH_HOME;
    try {
      process.env.DSH_HOME = "/srv/dsh home";
      expect(dsh.launch.sidecar!.config!.content(lane())).toContain("- id: credentials\n  disabled: false\n  config:\n    path: \"/srv/dsh home/.credentials.yaml\"\n");
      for (const [value, home] of [
        [undefined, join(homedir(), ".dsh")],
        [" \t", join(homedir(), ".dsh")],
        ["~", homedir()],
        ["~/dsh-alt", join(homedir(), "dsh-alt")],
        ["dsh-rel", join(process.cwd(), "dsh-rel")],
        ["~alice/dsh", join(process.cwd(), "~alice/dsh")],
      ] as const) {
        if (value === undefined) delete process.env.DSH_HOME;
        else process.env.DSH_HOME = value;
        expect(dsh.launch.sidecar!.config!.content(lane())).toContain(`    path: ${JSON.stringify(join(home, ".credentials.yaml"))}\n`);
      }
    } finally {
      if (saved === undefined) delete process.env.DSH_HOME;
      else process.env.DSH_HOME = saved;
    }
  });

  it("pins workspace-write for a bounded writer and refuses full access and the medium effort for a registered family", () => {
    const writer = dsh.launch.sidecar!.config!.content(lane({ mode: "isolated-write", cwd: "/tmp/lane" }));
    expect(writer).toStartWith("- id: sandbox-policy\n  config:\n    mode: workspace-write\n    workspaceRoot: \"/tmp/lane\"\n- id: approval\n  config:\n    policy: ask\n");
    expect(() => lane({ mode: "isolated-write", writerSandbox: "full-access" }))
      .toThrow("provider dsh does not support isolated-write-full-access; it supports only: read-only, isolated-write");
    expect(() => lane({ effort: "medium" })).toThrow("effort medium is not offered for dsh:deepseek-flash; choose one of: low, high, max");
  });

  it("passes DEEPSEEK_API_KEY, no other inherited DEEPSEEK_ or DSH_ name, and the provider directory as DSH_HOME", () => {
    const policy = dsh.environment(lane().access, "/tmp/receipt.json.provider");
    if (policy.kind !== "allowlist") throw new Error("expected an allowlist");
    expect(policy.names.filter((name) => /^(DSH_|DEEPSEEK_)/.test(name))).toEqual(["DEEPSEEK_API_KEY"]);
    expect(policy.prefixes.filter((prefix) => /^(DSH|DEEPSEEK)/.test(prefix))).toEqual([]);
    expect(policy.set).toEqual({ DSH_HOME: "/tmp/receipt.json.provider" });
  });
});

describe("dsh preflight", () => {
  it("runs a positional task with the lane's patch, then the shipped preflight patch", () => {
    const argv = dsh.preflight.argv(lane(), testFacts(dsh).providerSidecar);
    expect(argv).toEqual([
      "--profile", "headless", "--patch", "/tmp/receipt.json.provider/patch.yml",
      "--patch", join(import.meta.dir, "dsh-preflight.yml"), "--json", "preflight",
    ]);
    expect(readFileSync(argv[5]!, "utf8")).toContain("baseURL: http://127.0.0.1:1\n- id: llm-retry\n  disabled: true\n");
  });

  it("passes TRANSPORT with fixed evidence that the key is not validated", () => {
    for (const name of ["preflight-transport.jsonl", "status-credential-present.jsonl"]) {
      expect(preflight(fixture(name))).toEqual({ kind: "passed", evidence: "credential present; not validated" });
    }
  });

  it("reads MISSING_CREDENTIAL as unauthenticated and anything else as inconclusive", () => {
    expect(preflight(fixture("status-logged-out.jsonl"))).toEqual({ kind: "unauthenticated" });
    for (const stdout of ["", "{", fixture("unsupported-effort.jsonl"), fixture("real-complete-flash-max.jsonl")]) {
      expect([stdout, preflight(stdout)]).toEqual([stdout, { kind: "inconclusive" }]);
    }
  });
});

describe("dsh parse", () => {
  it("takes the final text after a completed turn, with summed step usage and the session ID", () => {
    expect(dsh.parse(run({ stdout: fixture("real-complete-flash-max.jsonl") }), lane())).toEqual({
      kind: "complete",
      text: "MARKER-FIXTURE",
      metadata: {
        reportedModel: null,
        sessionId: "session-MARKER-FIXTURE",
        usage: {
          inputTokens: 3600,
          outputTokens: 65,
          totalTokens: 6993,
          cachedInputTokens: 3328,
          cacheCreationInputTokens: 0,
        },
        costUsd: null,
      },
    });
    expect(dsh.proof).toMatchObject({ report: "absent" });
    expect(dsh.proof.matches(lane(), "deepseek-flash")).toBe(false);
  });

  it("never completes SIGTERM's exit 0 with a partial final, and reads exit 130 as cancelled", () => {
    expect(dsh.parse(run({ stdout: fixture("cancel-sigterm.jsonl") }), lane()))
      .toEqual({ kind: "malformed", message: "dsh ended without a completed turn" });
    expect(dsh.parse(run({ exitCode: 130, stdout: fixture("cancel-sigint.jsonl") }), lane()))
      .toMatchObject({ kind: "provider-failure", status: "cancelled" });
  });

  it("reads a turn_end error as child-failed with its code and message", () => {
    expect(dsh.parse(run({ exitCode: 1, stdout: fixture("unsupported-effort.jsonl"), stderr: fixture("unsupported-effort.stderr.txt") }), lane()))
      .toMatchObject({
        kind: "provider-failure",
        status: "child-failed",
        message: "dsh turn failed: UNSUPPORTED_REASONING_EFFORT: provider \"deepseek-official\" model \"deepseek-flash\" does not support reasoning effort \"medium\"",
        metadata: { sessionId: expect.stringMatching(/^session-/) },
      });
  });

  it("leaves DeepSeek's unknown-model refusal to the runner's unavailable-model rule", () => {
    const stderr = fixture("real-unknown-model.stderr.txt");
    expect(modelFailureStatus(stderr)).toBe("unavailable-model");
    expect(dsh.parse(run({ exitCode: 1, stdout: fixture("real-unknown-model.jsonl"), stderr }), lane()))
      .toEqual({ kind: "malformed", message: "dsh named an unavailable model" });
    expect(modelFailureStatus("TOOL: The supported API model names are a, but you passed b")).toBe("child-failed");
  });

  it("refuses a completed turn without final text and a non-JSON event", () => {
    const completedEmpty = fixture("real-complete-flash-max.jsonl").replace("{\"type\":\"final\",\"text\":\"MARKER-FIXTURE\"}", "{\"type\":\"final\",\"text\":\"\"}");
    expect(dsh.parse(run({ stdout: completedEmpty }), lane()))
      .toEqual({ kind: "malformed", message: "dsh completed the turn without final text" });
    expect(dsh.parse(run({ stdout: "Welcome\n" }), lane())).toEqual({ kind: "malformed", message: "dsh emitted a non-JSON event" });
  });
});

import { afterEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import {
  defaultDescriptor,
  effortsOf,
  type LaneRequest,
  REGISTRY,
  resolveLane,
  resolveModel,
} from "./registry/index.ts";
import {
  CATALOG_PATH,
  driftMessage,
  driftReport,
  main,
  renderCatalog,
  renderNativeAgents,
  WRITE_COMMAND,
  writeGenerated,
} from "./registry/render.ts";
import { EFFORTS } from "./types.ts";

const RUNNER = import.meta.dir;
const PLUGIN_ROOT = join(RUNNER, "../../../..");

function request(overrides: Partial<LaneRequest> = {}): LaneRequest {
  return {
    parent: "codex",
    provider: "claude",
    model: "opus",
    effort: "max",
    mode: "read-only",
    promptPath: "/tmp/prompt.md",
    cwd: "/tmp/worktree",
    outputPath: "/tmp/output.md",
    receiptPath: "/tmp/receipt.json",
    timeoutMs: null,
    ...overrides,
  };
}

function familyOf(provider: string, model: string): string | null {
  const match = resolveModel(provider, model);
  return match.kind === "unregistered" ? null : match.family.name;
}

const RELEASED_BY_1_15_0 = { count: 20, sha256: "d8308fb54209a852f3be8a44a9057153776036bf72eb55142c9e5faefcca49f8" };

describe("registry data", () => {
  it("keeps every pair released by 1.15.0 in place", () => {
    const released = REGISTRY.releasedPairs.slice(0, RELEASED_BY_1_15_0.count);
    expect(createHash("sha256").update(JSON.stringify(released)).digest("hex")).toBe(RELEASED_BY_1_15_0.sha256);
  });

  it("resolves every released pair to its recorded family", () => {
    for (const { pair, family } of REGISTRY.releasedPairs) {
      const at = pair.indexOf(":");
      expect([pair, familyOf(pair.slice(0, at), pair.slice(at + 1))]).toEqual([pair, family]);
    }
  });

  it("lists every role-default pair as a released pair", () => {
    const released = new Set(REGISTRY.releasedPairs.map((entry) => entry.pair));
    for (const { lanes } of REGISTRY.roleDefaults) {
      for (const name of lanes) {
        if (name === "inherit-parent" || name === "auto") continue;
        const family = REGISTRY.families.find((entry) => entry.name === name)!;
        expect(released).toContain(`${family.provider}:${family.model}`);
      }
    }
  });

  it("keeps the solo code roles on Sol and every panel on Opus, Sol and Grok", () => {
    const lanes = (role: string) => REGISTRY.roleDefaults.find((entry) => entry.role === role)?.lanes;
    for (const role of ["bug-fix", "perf-issue", "hillclimb"]) expect([role, lanes(role)]).toEqual([role, ["sol"]]);
    for (const role of ["arena runners", "arena cross-judge pool", "architect runners", "interrogate reviewers"]) {
      expect([role, lanes(role)]).toEqual([role, ["opus", "sol", "grok"]]);
    }
    for (const role of ["why investigators, synthesizer", "reflect tooling, judgment, divergent, synthesizer"]) {
      expect([role, lanes(role)]).toEqual([role, ["inherit-parent"]]);
    }
  });

  it("keeps the default efforts, the Claude rolling aliases and Sol's ultra", () => {
    expect(REGISTRY.families.map((entry) => [entry.name, entry.defaultEffort])).toEqual([
      ["fable", "max"],
      ["sol", "max"],
      ["grok", "xhigh"],
      ["opus", "max"],
      ["luna", "max"],
      ["sonnet", "max"],
      ["opus-5-5", "max"],
      ["haiku-5-5", "max"],
      ["swe-2", "max"],
      ["swe-1.6", "default"],
      ["deepseek-v4.1-flash-free", "max"],
      ["deepseek-flash", "max"],
      ["deepseek-v4-pro", "max"],
      ["amp-deepseek-v4.1-flash", "default"],
      ["gemini-3.8-flash", "high"],
      ["composer-2.5", "default"],
      ["gemini-3.7-flash", "high"],
    ]);
    expect(REGISTRY.families.filter((entry) => entry.provider === "claude").map((entry) => [entry.name, entry.model]))
      .toEqual([["fable", "fable"], ["opus", "opus"], ["sonnet", "sonnet"], ["opus-5-5", "claude-opus-5-5"], ["haiku-5-5", "claude-haiku-5-5"]]);
    expect(REGISTRY.families.filter((entry) => entry.rolling !== undefined)
      .map((entry) => [entry.name, entry.rolling!.revisionPrefix]))
      .toEqual([["fable", "claude-fable-"], ["opus", "claude-opus-"], ["sonnet", "claude-sonnet-"]]);
    expect(REGISTRY.families.filter((entry) => entry.provider === "codex").map((entry) => [entry.name, entry.model]))
      .toEqual([["sol", "gpt-6.1-sol"], ["luna", "gpt-6-luna"]]);
    expect(REGISTRY.families.filter((entry) => effortsOf(entry).includes("ultra")).map((entry) => entry.name)).toEqual(["sol"]);
  });

  it("keeps family names and (provider, model) pairs unique, and efforts ordered", () => {
    const names = REGISTRY.families.map((entry) => entry.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name).toMatch(/^[a-z0-9]+([.-][a-z0-9]+)*$/);
    const pairs = REGISTRY.families.flatMap((entry) => [entry.model, ...(entry.predecessors ?? []).map((kept) => kept.model)]
      .map((model) => `${entry.provider}:${model}`));
    expect(new Set(pairs).size).toBe(pairs.length);
    for (const entry of REGISTRY.families) {
      for (const efforts of [effortsOf(entry), ...(entry.predecessors ?? []).map((kept) => kept.efforts)]) {
        expect(efforts.length).toBeGreaterThan(0);
        expect([...efforts]).toEqual(EFFORTS.filter((effort) => efforts.includes(effort)));
      }
      expect(effortsOf(entry)).toContain(entry.defaultEffort);
    }
  });

  it("renders each role default as its families' default descriptors, keeping aliases", () => {
    const catalog = renderCatalog(REGISTRY).content;
    for (const { role, lanes } of REGISTRY.roleDefaults) {
      const descriptors = lanes.map((name) => {
        const family = REGISTRY.families.find((entry) => entry.name === name);
        return family === undefined ? name : defaultDescriptor(family);
      });
      expect(catalog).toContain(`\n${role}: ${descriptors.join(", ")}\n`);
    }
    expect(catalog).toContain("Every documented role remains present.");
  });

  it("routes each provider natively only from its own parent", () => {
    const routes = renderCatalog(REGISTRY).content.split("\n## Routes\n")[1]!.split("\n## ")[0]!;
    for (const adapter of REGISTRY.adapters) {
      const cells = routes.split("\n").find((line) => line.startsWith(`| ${adapter.id} |`))!.split(" | ");
      expect(cells.slice(1, 3)).toEqual([
        adapter.id === "claude" ? "native `Agent`" : "external runner",
        adapter.id === "codex" ? "native `spawn_agent`" : "external runner",
      ]);
    }
  });
});

describe("generated files", () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });
  function root(): string {
    const path = mkdtempSync(join(tmpdir(), "pstack-render-"));
    roots.push(path);
    return path;
  }
  function files(dir: string): Record<string, string> {
    return Object.fromEntries(readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => {
        const path = join(entry.parentPath, entry.name);
        return [relative(dir, path), readFileSync(path, "utf8")];
      }));
  }

  it("match the committed catalog and agents", () => {
    expect(driftMessage(driftReport(REGISTRY, PLUGIN_ROOT))).toBe("");
  });

  it("change nothing on a second write", () => {
    const dir = root();
    writeGenerated(REGISTRY, dir);
    const first = files(dir);
    expect(Object.keys(first)).toContain(CATALOG_PATH);
    writeGenerated(REGISTRY, dir);
    expect(files(dir)).toEqual(first);
    expect(main(["--check"], dir)).toBe(0);
  });

  it("report a hand edit, a missing file and a stray agent with the write command, and --write repairs them", () => {
    const dir = root();
    writeGenerated(REGISTRY, dir);
    const [agent] = renderNativeAgents(REGISTRY);
    writeFileSync(join(dir, CATALOG_PATH), "hand edit\n", { flag: "a" });
    rmSync(join(dir, agent!.path));
    for (const name of ["pstack-retired-max.md", "poteto-agent.md", "comment-sicko.md"]) {
      writeFileSync(join(dir, "agents", name), `${name}\n`);
    }

    expect(driftReport(REGISTRY, dir)).toEqual([
      `stale ${CATALOG_PATH}`,
      `missing ${agent!.path}`,
      "stray agents/pstack-retired-max.md",
    ]);
    expect(driftMessage(driftReport(REGISTRY, dir))).toContain(WRITE_COMMAND);
    expect(main(["--check"], dir)).toBe(1);

    expect(main(["--write"], dir)).toBe(0);
    expect(driftReport(REGISTRY, dir)).toEqual([]);
    expect(readFileSync(join(dir, "agents/poteto-agent.md"), "utf8")).toBe("poteto-agent.md\n");
    expect(readFileSync(join(dir, "agents/comment-sicko.md"), "utf8")).toBe("comment-sicko.md\n");
    expect(main([], dir)).toBe(64);
  });
});

describe("hand-written dispatch and setup rules", () => {
  const dispatch = readFileSync(join(PLUGIN_ROOT, "skills/poteto-mode/references/provider-dispatch.md"), "utf8");
  const setup = readFileSync(join(PLUGIN_ROOT, "skills/setup-pstack/SKILL.md"), "utf8");
  const section = (text: string, from: string, to: string): string => {
    const start = text.indexOf(from), end = text.indexOf(to);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    return text.slice(start, end);
  };

  it("binds Claude-native dispatch to the generated agents", () => {
    const native = section(dispatch, "## Native lanes", "## External lanes");
    expect(native).toContain("match the descriptor's `(provider, model)` to one model-matrix row");
    expect(native).toContain("`pstack-<family>-<effort>`");
  });

  it("normalizes rolling-alias pins and keeps predecessors before any runtime route", () => {
    const normalization = section(dispatch, "## Read-time normalization", "## The parent owns the route");
    expect(normalization).toContain("an exact model-matrix row, then a kept predecessor, then a rolling-alias revision");
    expect(normalization).toContain("such as a registered exact pin, is never normalized");
    expect(normalization).toContain("replace that model component in memory");
    expect(normalization).toContain("Never pass the versioned predecessor to Claude.");
    expect(normalization).toContain("without writing user files");
    expect(normalization).toContain("`/setup-pstack` will rewrite it");
    expect(normalization).toContain("runner rejects a missed rolling-alias version pin");
    expect(normalization).toContain("A kept predecessor in the catalog matches its family. Dispatch it with the sheet's model");
    expect(normalization).toContain("Do not rewrite its model in memory.");
  });

  it("keeps setup's fail-closed reconfiguration order", () => {
    let previous = -1;
    for (const heading of [
      "### 2. Load current state",
      "### 3. Parse per-family efforts",
      "### 4. Collect one requested effort per family",
      "### 5. Probe the requested pairs",
      "### 6. Render, preserving role families",
      "### 7. Confirm and commit",
    ]) {
      const current = setup.indexOf(heading);
      expect(current).toBeGreaterThan(previous);
      previous = current;
    }
    for (const rule of [
      "Do not invent a precedence rule.",
      "Do not probe or write while any inconsistency is unresolved.",
      "A failed probe writes nothing:",
      "Run one probe per family",
      "normalized complete role map from step 2",
      "Match in this order: an exact model-matrix row, then a kept predecessor, then a rolling-alias revision.",
      "such as a registered exact pin, is never migratable",
      "starts with a rolling alias's versioned-predecessor prefix",
      "preserving the provider, effort, role, and lane order",
      "Show any rolling-alias migrations",
      "An effort-only rerun cannot change a role's family.",
      "<!-- pstack:models:begin -->",
      "<!-- pstack:models:end -->",
    ]) {
      expect(setup).toContain(rule);
    }
  });

  it("refuses a read-only-only provider for every role whose lanes write files", () => {
    const writers = Object.entries(ROLE_POINTERS)
      .filter(([file]) => file.includes("/playbooks/"))
      .filter(([file]) => readFileSync(join(PLUGIN_ROOT, file), "utf8").includes("`isolated-write`"))
      .flatMap(([, roles]) => roles);
    expect(new Set(writers)).toEqual(new Set(["feature, refactoring", "bug-fix", "perf-issue", "hillclimb"]));
    const rule = section(setup, "### 3. Parse per-family efforts", "### 4. Collect one requested effort per family");
    expect(rule).toContain("Lanes for these roles write files: `feature, refactoring`, `bug-fix`, `perf-issue`, and `hillclimb`, whose playbooks delegate with `isolated-write`; `hardest tasks`, which takes the hardest code changes; and `arena runners`, `architect runners` and `swarm workers`, which write to their own worktrees or output directories.");
    expect(readFileSync(join(PLUGIN_ROOT, "skills/poteto-mode/SKILL.md"), "utf8")).toContain("the hardest changes read `hardest tasks`");
    expect(readFileSync(join(PLUGIN_ROOT, "skills/arena/SKILL.md"), "utf8")).toContain("Give each candidate its own output location (a git worktree");
    expect(readFileSync(join(PLUGIN_ROOT, "skills/swarm/SKILL.md"), "utf8")).toContain("in the worker's own worktree");
    expect(readFileSync(join(PLUGIN_ROOT, "skills/architect/SKILL.md"), "utf8")).toContain("Take the runners from `architect runners` in the current harness's pstack model sheet, in place of Arena's `arena runners`.");
    expect(rule).toContain("lacks `isolated-write`: name the role and the provider, and say why.");
    expect(rule).toContain("The runner refuses that provider's writer lane before launch");
    expect(REGISTRY.adapters.filter((adapter) => !adapter.launch.supports.includes("isolated-write")).map((adapter) => adapter.id))
      .toEqual(["devin", "opencode", "dsh", "amp", "agy", "cursor"]);
    const devinRoute = renderCatalog(REGISTRY).content.split("\n").find((line) => line.startsWith("| devin |"));
    expect(devinRoute).toContain("| `read-only` |");
  });

  it("proposes a kept predecessor's current model at the same effort and keeps it on a decline", () => {
    expect(setup).toContain("model-catalog.md#kept-predecessors-and-normalization) is not inconsistent state.");
    expect(setup).toContain("propose replacing every occurrence with its family's current model at the same effort, and ask.");
    expect(setup).toContain("that family's model stays the kept predecessor for steps 3 to 7: probe it, render it, and write it unchanged.");
    expect(setup).toContain("matching a kept predecessor to its family");
    expect(REGISTRY.families.flatMap((entry) => (entry.predecessors ?? []).map((kept) => `${entry.provider}:${kept.model}`)))
      .toEqual(expect.arrayContaining(["codex:gpt-5.6-sol", "grok:grok-4.6"]));
  });

  it("passes full access only to an opted-in external Codex writer, and setup keeps the setting line", () => {
    const rule = section(dispatch, "### Codex writer sandbox", "### Host and parent prerequisites");
    expect(rule).toContain("`codex writer sandbox: full-access` or `codex writer sandbox: bounded`");
    expect(rule).toContain("Append `--writer-sandbox full-access` only when that line says `full-access` and the lane is an external Codex `isolated-write` lane.");
    expect(rule).toContain("the setting never moves a native lane to the runner");
    expect(rule).toContain("Never add the flag, or retry with it, after a sandbox failure");
    expect(rule).toContain("it confines nothing");
    expect(dispatch).not.toMatch(/Bash sandbox, Codex `workspace-write`, and/);
    const load = section(setup, "### 2. Load current state", "### 3. Parse per-family efforts");
    expect(load.indexOf("Set it aside before the role overlay, the retired-role rule, and descriptor validation"))
      .toBeLessThan(load.indexOf("is from a retired role. Drop it"));
    expect(load).toContain("Record `codex writer sandbox: full-access` on a yes and `codex writer sandbox: bounded` on a decline");
    expect(load).toContain("When the line exists, keep it unless the operator names a change, and do not ask.");
    expect(setup).toContain("Keep the setting line from step 2 where the loaded sheet had it.");
    expect(setup).not.toContain("Every non-alias value must match");
  });

});

const REPO_ROOT = join(PLUGIN_ROOT, "../..");
const ROLE_DEFAULTS = "model-catalog.md#role-defaults";
const ROLE_POINTERS: Record<string, readonly string[]> = {
  "skills/arena/SKILL.md": ["arena runners", "arena cross-judge pool"],
  "skills/architect/SKILL.md": ["architect runners"],
  "skills/how/SKILL.md": ["how explorer", "how explainer"],
  "skills/interrogate/SKILL.md": ["interrogate reviewers"],
  "skills/swarm/SKILL.md": ["swarm workers"],
  "skills/poteto-mode/SKILL.md": ["feature, refactoring", "bug-fix", "perf-issue", "hillclimb", "hardest tasks", "judgment and prose"],
  "skills/poteto-mode/playbooks/bug-fix.md": ["bug-fix"],
  "skills/poteto-mode/playbooks/feature.md": ["feature, refactoring"],
  "skills/poteto-mode/playbooks/hillclimb.md": ["hillclimb"],
  "skills/poteto-mode/playbooks/perf-issue.md": ["perf-issue"],
  "skills/poteto-mode/playbooks/refactoring.md": ["feature, refactoring"],
  "skills/poteto-mode/references/codex-tools.md": [],
  "skills/setup-pstack/SKILL.md": [],
};

function walk(dir: string, keep: (name: string) => boolean): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : walk(path, keep);
    return keep(entry.name) ? [path] : [];
  });
}

const escape = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

describe("role pointers and text scans", () => {
  it("point each Cursor-derived site at role defaults that exist", () => {
    const roles = new Set(REGISTRY.roleDefaults.map((entry) => entry.role));
    for (const [file, named] of Object.entries(ROLE_POINTERS)) {
      const text = readFileSync(join(PLUGIN_ROOT, file), "utf8");
      expect([file, text.includes(ROLE_DEFAULTS)]).toEqual([file, true]);
      for (const role of named) {
        expect([file, role, roles.has(role), text.includes(`\`${role}\``)]).toEqual([file, role, true, true]);
      }
    }
  });

  it("find no descriptor or versioned model name outside the generated catalog and agents", () => {
    const generated = new Set([CATALOG_PATH, ...renderNativeAgents(REGISTRY).map((file) => file.path)]
      .map((path) => join(PLUGIN_ROOT, path)));
    const files = [...walk(PLUGIN_ROOT, (name) => name.endsWith(".md")), join(REPO_ROOT, "README.md"), join(REPO_ROOT, "docs/reference.md")]
      .filter((path) => !generated.has(path));
    const descriptor = new RegExp(`\\b(?:${REGISTRY.adapters.map((adapter) => adapter.id).join("|")}):[A-Za-z0-9._/-]+@[a-z]+`);
    const versioned = REGISTRY.families
      .flatMap((entry) => [entry.model, ...(entry.predecessors ?? []).map((kept) => kept.model)])
      .filter((model) => /[0-9]/.test(model))
      .map((model) => new RegExp(model.split("-").map(escape).join("[-\\s]"), "i"));
    const hits = files.flatMap((path) => readFileSync(path, "utf8").split("\n").flatMap((line, at) =>
      [descriptor, ...versioned].some((pattern) => pattern.test(line)) ? [`${relative(REPO_ROOT, path)}:${at + 1}: ${line}`] : []));
    expect(hits).toEqual([]);
  });

  it("keep versioned Claude literals in non-test code to registry/models.ts", () => {
    const prefixes = REGISTRY.families.flatMap((entry) => entry.rolling === undefined ? [] : [escape(entry.rolling.revisionPrefix)]);
    const literal = new RegExp(`["'\`:](?:${prefixes.join("|")})[0-9]`);
    const hits = walk(PLUGIN_ROOT, (name) => /\.(?:ts|js|mjs)$/.test(name) && !/\.test\.(?:ts|js)$/.test(name))
      .filter((path) => path !== join(RUNNER, "registry/models.ts") && literal.test(readFileSync(path, "utf8")))
      .map((path) => relative(PLUGIN_ROOT, path));
    expect(hits).toEqual([]);
  });
});

describe("resolveLane", () => {
  it("passes an unregistered pair to the CLI unchanged with any listed effort", () => {
    const lane = resolveLane(request({ parent: "claude", provider: "grok", model: "grok-4.5", effort: "high" }));
    expect(lane.family).toBeNull();
    expect(lane.model).toBe("grok-4.5");
    expect(lane.adapter.launch.argv(lane, { sharedGitDir: null, providerSidecar: null }))
      .toEqual(expect.arrayContaining(["--model", "grok-4.5", "--reasoning-effort", "high"]));
    expect(resolveLane(request({ parent: "claude", provider: "grok", model: "grok-4.5", effort: "default" })).effort)
      .toBe("default");
  });

  it("rejects an effort that a registered family or kept predecessor does not list", () => {
    expect(() => resolveLane(request({ effort: "ultra" })))
      .toThrow("effort ultra is not offered for claude:opus; choose one of: low, medium, high, xhigh, max");
    expect(() => resolveLane(request({ effort: "default" }))).toThrow("effort default is not offered");
    expect(() => resolveLane(request({ parent: "claude", provider: "grok", model: "grok-4.6", effort: "ultra" })))
      .toThrow("effort ultra is not offered for grok:grok-4.6");
    expect(resolveLane(request({ parent: "claude", provider: "codex", model: "gpt-5.6-sol", effort: "ultra" })).family?.name)
      .toBe("sol");
  });

  it("rejects an effort outside the global list", () => {
    expect(() => resolveLane(request({ provider: "grok", model: "grok-4.5", effort: "none" })))
      .toThrow(`effort must be one of: ${EFFORTS.join(", ")}`);
  });

  it("refuses an unnormalized Claude revision with today's message", () => {
    for (const [model, alias] of [
      ["claude-opus-5", "opus"],
      ["claude-fable-9-9", "fable"],
      ["claude-sonnet-5-5", "sonnet"],
    ]) {
      expect(() => resolveLane(request({ model })))
        .toThrow(`Claude model ${model} is a version pin; normalize it to ${alias} before invoking the runner`);
    }
    expect(resolveLane(request({ model: "claude-opus-beta" })).family).toBeNull();
  });

  it("resolves the registered Opus 5.5 pin before the opus revision pattern", () => {
    expect(resolveModel("claude", "claude-opus-5-5")).toEqual({
      kind: "current",
      family: REGISTRY.families.find((entry) => entry.name === "opus-5-5")!,
    });
    for (const model of ["claude-opus-5", "claude-opus-5-6", "claude-opus-5-5-1"]) {
      const match = resolveModel("claude", model);
      expect([model, match.kind, match.kind === "stale-revision" ? match.family.name : null])
        .toEqual([model, "stale-revision", "opus"]);
    }
    const lane = resolveLane(request({ model: "claude-opus-5-5" }));
    expect([lane.family?.name, lane.family?.rolling, lane.model]).toEqual(["opus-5-5", null, "claude-opus-5-5"]);
    expect(lane.adapter.launch.argv(lane, { sharedGitDir: null, providerSidecar: null })).toEqual(expect.arrayContaining(["claude-opus-5-5"]));
  });

  it("resolves the registered Haiku 5.5 model for external Claude lanes", () => {
    const match = resolveModel("claude", "claude-haiku-5-5");
    expect([match.kind, match.kind === "current" ? match.family.name : null])
      .toEqual(["current", "haiku-5-5"]);
    const lane = resolveLane(request({ model: "claude-haiku-5-5" }));
    expect([lane.family?.name, lane.model, lane.cliModel, lane.effort])
      .toEqual(["haiku-5-5", "claude-haiku-5-5", "claude-haiku-5-5", "max"]);
  });

  it("resolves Sonnet and Luna, and rejects ultra for both", () => {
    expect(resolveLane(request({ model: "sonnet", effort: "low" })).family?.name).toBe("sonnet");
    const luna = resolveLane(request({ parent: "claude", provider: "codex", model: "gpt-6-luna" }));
    expect([luna.family?.name, luna.effort]).toEqual(["luna", "max"]);
    expect(() => resolveLane(request({ parent: "claude", provider: "codex", model: "gpt-6-luna", effort: "ultra" })))
      .toThrow("effort ultra is not offered for codex:gpt-6-luna; choose one of: low, medium, high, xhigh, max");
    expect(() => resolveLane(request({ model: "sonnet", effort: "ultra" })))
      .toThrow("effort ultra is not offered for claude:sonnet");
  });

  it("maps each Devin effort to its CLI model ID and keeps the descriptor's model for the receipt", () => {
    const devin = (model: string, effort: string, mode = "read-only") =>
      resolveLane(request({ parent: "claude", provider: "devin", model, effort, mode }));
    for (const [model, effort, cliModel] of [
      ["swe-2", "medium", "swe-2-medium"], ["swe-2", "high", "swe-2-high"], ["swe-2", "max", "swe-2-max"],
      ["swe-1.6", "default", "swe-1-6"],
    ]) {
      const lane = devin(model!, effort!);
      expect([lane.family?.name, lane.model, lane.cliModel]).toEqual([model, model, cliModel]);
    }
    expect(() => devin("swe-2", "default")).toThrow("effort default is not offered for devin:swe-2; choose one of: medium, high, max");
    expect([devin("swe-1-7-medium", "default").cliModel, devin("swe-1-7-medium", "default").family]).toEqual(["swe-1-7-medium", null]);
    expect(() => devin("swe-1-7-medium", "max")).toThrow("effort max is not offered for devin:swe-1-7-medium; choose one of: default");
    expect(() => devin("swe-2", "max", "isolated-write"))
      .toThrow("provider devin does not support isolated-write; it supports only: read-only");
    for (const [provider, model] of [["codex", "gpt-6.1-sol"], ["grok", "grok-4.7"], ["grok", "grok-4.5"]]) {
      expect(resolveLane(request({ parent: "claude", provider, model })).cliModel).toBe(model);
    }
  });

  it("builds a bounded writer unless full access is requested, and refuses full access off a Codex writer", () => {
    const codex = (overrides: Partial<LaneRequest>) =>
      resolveLane(request({ parent: "claude", provider: "codex", model: "gpt-6.1-sol", ...overrides }));
    expect(codex({}).access).toEqual({ mode: "read-only" });
    expect(codex({ writerSandbox: "bounded" }).access).toEqual({ mode: "read-only" });
    expect(codex({ mode: "isolated-write" }).access).toEqual({ mode: "isolated-write", sandbox: "bounded" });
    expect(codex({ mode: "isolated-write", writerSandbox: "bounded" }).access).toEqual({ mode: "isolated-write", sandbox: "bounded" });
    expect(codex({ mode: "isolated-write", writerSandbox: "full-access" }).access)
      .toEqual({ mode: "isolated-write", sandbox: "full-access" });
    expect(() => codex({ writerSandbox: "full-access" })).toThrow("writer sandbox full-access requires mode isolated-write");
    expect(() => codex({ mode: "isolated-write", writerSandbox: "danger-full-access" }))
      .toThrow("writer-sandbox must be one of: bounded, full-access");
    expect(REGISTRY.adapters.filter((adapter) => adapter.launch.supports.includes("isolated-write-full-access"))
      .map((adapter) => adapter.id)).toEqual(["codex"]);
    for (const [parent, provider, model] of [["codex", "claude", "opus"], ["claude", "grok", "grok-4.7"]]) {
      expect(() => resolveLane(request({ parent, provider, model, mode: "isolated-write", writerSandbox: "full-access" })))
        .toThrow(`provider ${provider} does not support isolated-write-full-access; it supports only: read-only, isolated-write`);
    }
    expect(() => resolveLane(request({ parent: "claude", provider: "devin", model: "swe-2", mode: "isolated-write", writerSandbox: "full-access" })))
      .toThrow("provider devin does not support isolated-write-full-access; it supports only: read-only");
  });

  it("rejects same-provider recursion and unknown names", () => {
    expect(() => resolveLane(request({ parent: "claude" })))
      .toThrow("provider claude is native to parent claude; use the parent subagent primitive");
    expect(() => resolveLane(request({ provider: "kiro" }))).toThrow("provider must be one of: claude, codex, grok, devin, opencode, dsh, amp, agy, cursor");
    expect(() => resolveLane(request({ parent: "grok" }))).toThrow("parent must be one of: claude, codex");
    expect(() => resolveLane(request({ mode: "full" }))).toThrow("mode must be one of: read-only, isolated-write");
    expect(() => resolveLane(request({ model: " " }))).toThrow("model is required");
  });
});

describe("module boundaries", () => {
  function sources(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return sources(path);
      return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [path] : [];
    });
  }

  it("imports providers/* only from registry/providers.ts outside providers/", () => {
    const providers = join(RUNNER, "providers");
    const importers = sources(RUNNER)
      .filter((path) => !path.startsWith(`${providers}/`))
      .filter((path) => [...readFileSync(path, "utf8").matchAll(/from\s+"([^"]+)"/g)]
        .some(([, specifier]) => specifier!.startsWith(".")
          && resolve(dirname(path), specifier!).startsWith(`${providers}/`)))
      .map((path) => relative(RUNNER, path));
    expect(importers).toEqual(["registry/providers.ts"]);
  });

  it("keeps child-provider names out of run.ts except the parent sandbox diagnostic", () => {
    const run = readFileSync(join(RUNNER, "run.ts"), "utf8");
    const names = REGISTRY.adapters.map((adapter) => adapter.id).join("|");
    expect([...run.matchAll(new RegExp(`["'\`](?:${names})["'\`]`, "g"))].map(([literal]) => literal))
      .toEqual(['"codex"']);
    expect(run).toContain('lane.parent === "codex"');
  });
});

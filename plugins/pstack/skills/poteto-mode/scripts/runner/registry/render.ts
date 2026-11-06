import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { type AccessKind, PARENTS, type Parent } from "../types.ts";
import { access, type EnvPolicy, type ProviderAdapter } from "./contract.ts";
import { defaultDescriptor, effortsOf, modelIds, REGISTRY, type Registry } from "./index.ts";

export interface GeneratedFile {
  readonly path: string;
  readonly content: string;
}

export const CATALOG_PATH = "skills/poteto-mode/references/model-catalog.md";
export const WRITE_COMMAND = "bun runner/registry/render.ts --write";
const WRITE_HINT = `Run \`${WRITE_COMMAND}\` from plugins/pstack/skills/poteto-mode/scripts.`;
const PLUGIN_ROOT = join(import.meta.dir, "../../../../..");
const AGENT = /^pstack-.*\.md$/;

const SHEET_HEADER = [
  "# pstack model configuration",
  "",
  "Provider-qualified per-role choices. Read the installed pstack provider-dispatch reference before dispatching a configured role. Every documented role remains present. `inherit-parent` and `auto` use the parent model natively and still count as one panel lane.",
];

const code = (value: string): string => `\`${value}\``;
const row = (cells: readonly string[]): string => `| ${cells.join(" | ")} |`;
const table = (header: readonly string[], rows: readonly (readonly string[])[]): string[] => [
  row(header),
  row(header.map(() => "---")),
  ...rows.map(row),
];

function route(adapter: ProviderAdapter, parent: Parent): string {
  return adapter.id === parent ? `native ${code(PARENTS[parent].native)}` : "external runner";
}

function policy(value: EnvPolicy, long: boolean): string {
  if (value.kind === "inherit") {
    return value.dropPrefixes.length === 0
      ? "inherited"
      : `inherited without ${value.dropPrefixes.map((prefix) => code(`${prefix}*`)).join(", ")}`;
  }
  if (!long) return "allowlist";
  const set = Object.entries(value.set ?? {}).map(([name, setting]) => code(`${name}=${setting}`));
  return `only ${value.names.map(code).join(" ")}, and variables starting with ${value.prefixes.map(code).join(", ")}`
    + (set.length === 0 ? "" : `; sets ${set.join(", ")}`);
}

function accessOf(kind: AccessKind) {
  return kind === "isolated-write-full-access" ? access("isolated-write", "full-access") : access(kind);
}

function environment(adapter: ProviderAdapter, long: boolean): string {
  const sidecarDir = adapter.launch.sidecar === null ? null : "<receipt>.provider";
  const policies = adapter.launch.supports.map((kind) => [kind, policy(adapter.environment(accessOf(kind), sidecarDir), long)] as const);
  return new Set(policies.map(([, rendered]) => rendered)).size === 1
    ? policies[0]![1]
    : policies.map(([kind, rendered]) => `${kind}: ${rendered}`).join("; ");
}

const list = (items: readonly string[]): string => items.length === 0 ? "none" : items.join("; ");

export function renderCatalog(registry: Registry): GeneratedFile {
  const named = new Set<string>(registry.roleDefaults.flatMap((entry) => entry.lanes));
  const parents = Object.keys(PARENTS) as Parent[];
  const lines = [
    `<!-- Generated from registry/models.ts and registry/providers.ts; do not edit. ${WRITE_HINT} -->`,
    "",
    "# Model catalog",
    "",
    "Model and provider facts for [`provider-dispatch.md`](provider-dispatch.md), which holds the dispatch rules.",
    "",
    "## Model matrix",
    "",
    ...table(
      ["Family", "Label", "Provider", "Model", "Default effort", "Selectable efforts", "Claude-native agents", "Status", "Upstream pstack choice"],
      registry.families.map((family) => [
        family.name,
        family.label,
        family.provider,
        family.model,
        family.defaultEffort,
        effortsOf(family).join(" "),
        family.provider === "claude" ? code(`pstack-${family.name}-<effort>`) : "-",
        named.has(family.name) ? "default" : "optional",
        family.upstream ?? "-",
      ])
    ),
    "",
    "A family is `default` when a role default names it and `optional` otherwise. A Claude-native agent exists for each selectable effort of a Claude family.",
    "",
    "Effort in the model ID: for these families the effort selects the CLI model, and argv carries no effort flag.",
    "",
    ...table(
      ["Family", "Effort", "CLI model"],
      registry.families.flatMap((family) => effortsOf(family).flatMap((effort) => {
        const id = modelIds(family)?.[effort];
        return id === undefined ? [] : [[family.name, effort, code(id)]];
      }))
    ),
    "",
    "## Kept predecessors and normalization",
    "",
    ...table(
      ["Provider", "Kept model", "Family", "Current model", "Selectable efforts"],
      registry.families.flatMap((family) => (family.predecessors ?? []).map((kept) => [
        family.provider,
        kept.model,
        family.name,
        family.model,
        kept.efforts.join(" "),
      ]))
    ),
    "",
    "Rolling aliases:",
    "",
    ...table(
      ["Family", "Alias", "Versioned predecessor"],
      registry.families.flatMap((family) => family.rolling === undefined ? [] : [[
        family.name,
        code(family.model),
        `${code(`${family.rolling.revisionPrefix}<revision>`)}, where the revision contains only digits and hyphens`,
      ]])
    ),
    "",
    "## Routes",
    "",
    ...table(
      ["Provider", ...parents.map((parent) => `${PARENTS[parent].harness} parent`), "Access modes", "Prompt", "Model proof", "Child environment", "Host prerequisites"],
      registry.adapters.map((adapter) => [
        adapter.id,
        ...parents.map((parent) => route(adapter, parent)),
        adapter.launch.supports.map(code).join(", "),
        adapter.launch.prompt,
        adapter.proof.report === "required" ? "provider report" : "pinned argv",
        environment(adapter, false),
        adapter.docs.hostPrerequisites.length === 0 ? "-" : adapter.docs.hostPrerequisites.join("; "),
      ])
    ),
    "",
    "The runner refuses an access mode outside a provider's Access modes cell before launch. `isolated-write-full-access` is a writer capability, not a `--mode` value: the runner takes it as `--mode isolated-write --writer-sandbox full-access`, which a parent passes only when the model sheet opts in, as [`provider-dispatch.md`](provider-dispatch.md#writer-sandbox) says. A provider whose cell lists `isolated-write-full-access` without `isolated-write` has no confined writer and writes only with that opt-in.",
    "",
    "## Provider notes",
    ...registry.adapters.flatMap((adapter) => [
      "",
      `### ${adapter.id}: ${adapter.docs.name}`,
      "",
      `- Executable: ${code(adapter.executable)}.`,
      `- Host prerequisites: ${list(adapter.docs.hostPrerequisites)}.`,
      `- State paths: ${list(adapter.docs.statePaths)}.`,
      `- Child environment: ${environment(adapter, true)}.`,
      ...adapter.docs.notes.map((note) => `- ${note}`),
    ]),
    "",
    "## Role defaults",
    "",
    "The complete first-run sheet. A sheet that lacks a role uses that role's line here.",
    "",
    "```markdown",
    ...SHEET_HEADER,
    "",
    ...registry.roleDefaults.map(({ role, lanes }) => `${role}: ${lanes.map((name) => {
      const family = registry.families.find((entry) => entry.name === name);
      return family === undefined ? name : defaultDescriptor(family);
    }).join(", ")}`),
    "```",
    "",
  ];
  return { path: CATALOG_PATH, content: lines.join("\n") };
}

export function renderNativeAgents(registry: Registry): readonly GeneratedFile[] {
  return registry.families.filter((family) => family.provider === "claude").flatMap((family) =>
    effortsOf(family).map((effort) => {
      const name = `pstack-${family.name}-${effort}`;
      return {
        path: `agents/${name}.md`,
        content: [
          "---",
          `name: ${name}`,
          `description: Native Claude lane for pstack roles configured as ${family.provider}:${family.model}@${effort}.`,
          `model: ${family.model}`,
          `effort: ${effort}`,
          "disallowedTools: Agent, Task",
          "---",
          "",
          `# pstack ${family.label} lane`,
          "",
          "Execute only the task and path scope the parent assigns. Read the grounding artifacts by path. Do not choose another model, spawn another agent, or start a pstack workflow. If the assignment is read-only, do not modify files. Return the requested artifact or verdict plus a concise rationale.",
          "",
        ].join("\n"),
      };
    })
  );
}

function generated(registry: Registry): readonly GeneratedFile[] {
  return [renderCatalog(registry), ...renderNativeAgents(registry)];
}

function read(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function strays(registry: Registry, pluginRoot: string): string[] {
  const expected = new Set(renderNativeAgents(registry).map((file) => file.path));
  const agents = join(pluginRoot, "agents");
  return (existsSync(agents) ? readdirSync(agents) : [])
    .filter((name) => AGENT.test(name))
    .map((name) => `agents/${name}`)
    .filter((path) => !expected.has(path))
    .sort();
}

export function driftReport(registry: Registry, pluginRoot: string): readonly string[] {
  const report = generated(registry).flatMap((file) => {
    const actual = read(join(pluginRoot, file.path));
    if (actual === null) return [`missing ${file.path}`];
    return actual === file.content ? [] : [`stale ${file.path}`];
  });
  return [...report, ...strays(registry, pluginRoot).map((path) => `stray ${path}`)];
}

export function driftMessage(report: readonly string[]): string {
  return report.length === 0 ? "" : [...report, WRITE_HINT].join("\n");
}

export function writeGenerated(registry: Registry, pluginRoot: string): void {
  for (const file of generated(registry)) {
    const path = join(pluginRoot, file.path);
    if (read(path) === file.content) continue;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, file.content);
  }
  for (const path of strays(registry, pluginRoot)) rmSync(join(pluginRoot, path));
}

export function main(argv: readonly string[], pluginRoot = PLUGIN_ROOT): number {
  if (argv.length === 1 && argv[0] === "--write") {
    writeGenerated(REGISTRY, pluginRoot);
    return 0;
  }
  if (argv.length === 1 && argv[0] === "--check") {
    const message = driftMessage(driftReport(REGISTRY, pluginRoot));
    if (message === "") return 0;
    process.stderr.write(`${message}\n`);
    return 1;
  }
  process.stderr.write("Usage: bun runner/registry/render.ts --write | --check\n");
  return 64;
}

if (import.meta.main) process.exit(main(Bun.argv.slice(2)));

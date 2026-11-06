import { ACCESS_MODES, EFFORTS, PARENTS, type Parent, UsageError, WRITER_SANDBOXES } from "../types.ts";
import { access, accessKind, isRevision, type Lane, type ProviderAdapter } from "./contract.ts";
import { effortsOf, type FamilyEntry, type KeptPredecessor, modelIds, type ReleasedPair, type RoleDefault } from "./family.ts";
import { FAMILIES, type FamilyName, RELEASED_PAIRS, ROLE_DEFAULTS } from "./models.ts";
import { ADAPTERS } from "./providers.ts";

export type { Lane, LaunchFacts, ParseResult } from "./contract.ts";
export { effortsOf, modelIds } from "./family.ts";

export interface Registry {
  readonly families: readonly FamilyEntry[];
  readonly adapters: readonly ProviderAdapter[];
  readonly roleDefaults: readonly RoleDefault<FamilyName>[];
  readonly releasedPairs: readonly ReleasedPair<FamilyName>[];
}
export const REGISTRY: Registry = {
  families: FAMILIES,
  adapters: ADAPTERS,
  roleDefaults: ROLE_DEFAULTS,
  releasedPairs: RELEASED_PAIRS,
};

export interface LaneRequest {
  readonly parent: string;
  readonly provider: string;
  readonly model: string;
  readonly effort: string;
  readonly mode: string;
  readonly writerSandbox?: string;
  readonly promptPath: string;
  readonly cwd: string;
  readonly outputPath: string;
  readonly receiptPath: string;
  readonly timeoutMs: number | null;
}

export type ModelMatch =
  | { readonly kind: "current"; readonly family: FamilyEntry }
  | { readonly kind: "kept"; readonly family: FamilyEntry; readonly predecessor: KeptPredecessor }
  | { readonly kind: "stale-revision"; readonly family: FamilyEntry }
  | { readonly kind: "unregistered" };

export function resolveModel(provider: string, model: string): ModelMatch {
  const families = REGISTRY.families.filter((entry) => entry.provider === provider);
  const current = families.find((entry) => entry.model === model);
  if (current !== undefined) return { kind: "current", family: current };
  for (const entry of families) {
    const predecessor = entry.predecessors?.find((kept) => kept.model === model);
    if (predecessor !== undefined) return { kind: "kept", family: entry, predecessor };
  }
  const stale = families.find((entry) => entry.rolling !== undefined && isRevision(entry.rolling, model));
  return stale === undefined ? { kind: "unregistered" } : { kind: "stale-revision", family: stale };
}

function oneOf<T extends string>(name: string, value: string, choices: readonly T[]): T {
  if (!choices.includes(value as T)) {
    throw new UsageError(`${name} must be one of: ${choices.join(", ")}`);
  }
  return value as T;
}

export function resolveLane(request: LaneRequest): Lane {
  const laneAccess = access(
    oneOf("mode", request.mode, ACCESS_MODES),
    request.writerSandbox === undefined ? undefined : oneOf("writer-sandbox", request.writerSandbox, WRITER_SANDBOXES)
  );
  const parent = oneOf("parent", request.parent, Object.keys(PARENTS) as Parent[]);
  const adapter = REGISTRY.adapters.find((entry) => entry.id === request.provider);
  if (adapter === undefined) {
    throw new UsageError(`provider must be one of: ${REGISTRY.adapters.map((entry) => entry.id).join(", ")}`);
  }
  if (request.model.trim().length === 0) throw new UsageError("model is required");
  const effort = oneOf("effort", request.effort, EFFORTS);
  if (adapter.id === parent && !PARENTS[parent].externalSelf) {
    throw new UsageError(
      `provider ${adapter.id} is native to parent ${parent}; use the parent subagent primitive`
    );
  }
  const match = resolveModel(adapter.id, request.model);
  if (match.kind === "stale-revision") {
    throw new UsageError(
      `Claude model ${request.model} is a version pin; normalize it to ${match.family.model} before invoking the runner`
    );
  }
  const family = match.kind === "unregistered" ? null : match.family;
  const offered = match.kind === "kept"
    ? match.predecessor.efforts
    : family === null
      ? adapter.effortIn === "model-id" ? ["default" as const] : EFFORTS
      : effortsOf(family);
  if (!offered.includes(effort)) {
    throw new UsageError(
      `effort ${effort} is not offered for ${adapter.id}:${request.model}; choose one of: ${offered.join(", ")}`
    );
  }
  const kind = accessKind(laneAccess);
  if (!adapter.launch.supports.includes(kind)) {
    throw new UsageError(
      `provider ${adapter.id} does not support ${kind}; it supports only: ${adapter.launch.supports.join(", ")}`
    );
  }
  return {
    parent,
    adapter,
    family: family === null ? null : {
      name: family.name,
      label: family.label,
      model: family.model,
      rolling: family.rolling ?? null,
    },
    model: request.model,
    cliModel: (family === null ? undefined : modelIds(family)?.[effort]) ?? request.model,
    effort,
    access: laneAccess,
    promptPath: request.promptPath,
    cwd: request.cwd,
    outputPath: request.outputPath,
    receiptPath: request.receiptPath,
    timeoutMs: request.timeoutMs,
  } as Lane;
}

export function defaultDescriptor(family: FamilyEntry): string {
  return `${family.provider}:${family.model}@${family.defaultEffort}`;
}

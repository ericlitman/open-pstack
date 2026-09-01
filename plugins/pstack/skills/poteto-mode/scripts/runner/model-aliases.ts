export type RollingClaudeAlias = "fable" | "opus";

export function isRollingClaudeAlias(
  model: string
): model is RollingClaudeAlias {
  return model === "fable" || model === "opus";
}

export function versionedClaudeAlias(
  model: string
): RollingClaudeAlias | null {
  if (/^claude-fable-[0-9]+(?:-[0-9]+)*$/.test(model)) return "fable";
  if (/^claude-opus-[0-9]+(?:-[0-9]+)*$/.test(model)) return "opus";
  return null;
}

export function concreteModelMatchesRollingAlias(
  requested: string,
  reported: string
): boolean {
  return versionedClaudeAlias(reported) === requested;
}

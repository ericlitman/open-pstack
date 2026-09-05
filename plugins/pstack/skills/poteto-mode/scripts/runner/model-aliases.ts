export const ROLLING_CLAUDE_ALIASES = ["fable", "opus", "sonnet"] as const;
export type RollingClaudeAlias = (typeof ROLLING_CLAUDE_ALIASES)[number];

export function isRollingClaudeAlias(
  model: string
): model is RollingClaudeAlias {
  return ROLLING_CLAUDE_ALIASES.includes(model as RollingClaudeAlias);
}

export function versionedClaudeAlias(
  model: string
): RollingClaudeAlias | null {
  if (/^claude-fable-[0-9]+(?:-[0-9]+)*$/.test(model)) return "fable";
  if (/^claude-opus-[0-9]+(?:-[0-9]+)*$/.test(model)) return "opus";
  if (/^claude-sonnet-[0-9]+(?:-[0-9]+)*$/.test(model)) return "sonnet";
  return null;
}

export function concreteModelMatchesRollingAlias(
  requested: string,
  reported: string
): boolean {
  return versionedClaudeAlias(reported) === requested;
}

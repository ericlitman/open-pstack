export const REPO = 'ericlitman/open-pstack';
export const HARNESSES = ['claude', 'codex'] as const;
export type CoreHarness = typeof HARNESSES[number];
export const LIVE_HARNESSES = [...HARNESSES, 't3'] as const;
export const WRITER_PROVIDERS = ['devin', 'dsh', 'opencode', 'agy', 'cursor', 'amp', 'muse'] as const;
export type Harness = typeof LIVE_HARNESSES[number];
export type Phase = 'resolve' | 'classify' | 'prepare' | 'exercise' | 'publish' | 'failed' | 'head-moved';
export interface Pull {
  number: number; head: { sha: string }; base: { sha: string };
  state: string; headRepo: string;
}
export interface ChangedFile {
  filename: string; previous_filename?: string;
  versionOnly?: boolean;
}
export interface Registry {
  skills: string[];
  shared: string[];
  catalog: string[];
  assets: string[];
  setup: string[];
  runner: string[];
  tools: string[];
  project: string[];
  nonRuntime: string[];
}
export interface Selection { paths: string[]; skills: string[]; features: string[]; noRuntime: boolean }
export interface Observation {
  harness: Harness; feature: string; surface: string; action: string; observed: string;
  transcript: string; transcriptHash: string; reviewer: 'recipe'; assertions: string[];
  artifacts: { path: string; sha256: string }[];
}
export interface Installation {
  harness: Harness; cliVersion: string; pluginVersion: string; sha: string;
  location: string; treeHash: string; home: string; sourceHash?: string;
}
export interface Receipt {
  schema: 1; repo: string; pr: number; sha: string; base: string; phase: Phase;
  selection: Selection;
  runFeatures: string[];
  sessions: number; wide?: string;
  installations: Installation[]; observations: Observation[];
  selfTest: boolean; artifactRoot: string; publisherRevision?: string; failure?: string;
  commentUrl?: string; status?: 'success' | 'failure'; cleanup: string; started: string;
}
export interface GitHub {
  pull(pr: number): Promise<Pull>;
  files(base: string, head: string): Promise<ChangedFile[]>;
  comment(pr: number, body: string): Promise<string>;
  status(sha: string, state: 'success' | 'failure', target: string, description: string): Promise<void>;
}
export interface SessionRecord {
  harness: Harness; exitCode: number; started: number;
  skills: string[];
  commands: string[];
  tools: { name: string; id: string; input: Record<string, any>; parent: string | null; result?: string; failed: boolean }[];
  context: string[];
}
export interface Driver {
  preflight(receipt: Receipt): Promise<void>;
  prepare(receipt: Receipt): Promise<Installation[]>;
  exercise(receipt: Receipt): Promise<Observation[]>;
  cleanup?(receipt: Receipt): Promise<void>;
}

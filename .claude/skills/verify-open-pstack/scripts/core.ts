import { HARNESSES, REPO, type ChangedFile, type Receipt, type Registry, type Selection } from './types.ts';

export function validateRegistry(value: unknown): Registry {
  if (!value || typeof value !== 'object') throw new Error('Invalid feature registry');
  const r = value as Registry;
  for (const key of ['skills', 'shared', 'setup', 'runner', 'tools', 'project', 'nonRuntime'] as const) {
    if (!Array.isArray(r[key]) || r[key].some(v => typeof v !== 'string' || !v || v.includes('..'))) {
      throw new Error(`Invalid registry.${key}`);
    }
    if (new Set(r[key]).size !== r[key].length) throw new Error(`Duplicate registry.${key}`);
  }
  if (!r.skills.length || r.skills.some(v => !/^[a-z][a-z0-9-]+$/.test(v))) throw new Error('Invalid skills');
  return r;
}

// Only a terminal /** is supported: unknown paths cannot match an accidental broad glob.
export function matches(path: string, pattern: string): boolean {
  return pattern.endsWith('/**') ? path.startsWith(pattern.slice(0, -2)) : path === pattern;
}

export function classify(files: ChangedFile[], registry: Registry): Selection {
  const paths = [...new Set(files.flatMap(f => [f.filename, ...(f.previous_filename ? [f.previous_filename] : [])]))].sort();
  const skills = new Set<string>(), features = new Set<string>();
  for (const path of paths) {
    if (!path || path.startsWith('/') || path.split('/').includes('..')) throw new Error(`Unsafe path: ${path}`);
    let covered = false;
    if (registry.shared.some(p => matches(path, p))) {
      registry.skills.forEach(s => skills.add(s));
      ['setup', 'runner', 'shipped-tools'].forEach(f => features.add(f));
      covered = true;
    }
    for (const [key, feature] of [['setup', 'setup'], ['runner', 'runner'], ['tools', 'shipped-tools'], ['project', 'project-skill']] as const) {
      if (registry[key].some(p => matches(path, p))) { features.add(feature); covered = true; }
    }
    const skill = /^plugins\/pstack\/skills\/([^/]+)\/(.+)$/.exec(path);
    if (skill && registry.skills.includes(skill[1]!)) {
      const leaf = skill[2]!;
      if (leaf === 'SKILL.md' || leaf.startsWith('references/') || leaf.startsWith('playbooks/')) {
        skills.add(skill[1]!); covered = true;
      }
    }
    // Runtime ownership always takes precedence over documentation exemptions.
    if (!covered && !registry.nonRuntime.some(p => matches(path, p))) throw new Error(`Unmapped path: ${path}`);
  }
  skills.forEach(s => features.add(`skill-invocation:${s}`));
  return { paths, skills: [...skills].sort(), features: [...features].sort(), noRuntime: !features.size };
}

export function newReceipt(pr: number, sha: string, base: string, selfTest: boolean, artifactRoot: string): Receipt {
  if (!Number.isSafeInteger(pr) || pr < 1 || !/^[a-f0-9]{40}$/.test(sha) || !/^[a-f0-9]{40}$/.test(base)) throw new Error('Invalid PR/SHA');
  return { schema: 1, repo: REPO, pr, sha, base, selfTest, artifactRoot, phase: 'resolve',
    selection: { paths: [], skills: [], features: [], noRuntime: false }, installations: [], observations: [],
    started: new Date().toISOString(), cleanup: 'Run state retained; operator owns cleanup.' };
}

export function requiredFeatures(receipt: Receipt): string[] {
  return [...new Set([...receipt.selection.features, ...(receipt.selfTest ? ['project-skill'] : [])])];
}

export function completeEvidence(receipt: Receipt): void {
  const features = requiredFeatures(receipt);
  if (!features.length && !receipt.selection.noRuntime) throw new Error('No classification');
  for (const harness of features.length ? HARNESSES : []) {
    const installs = receipt.installations.filter(i => i.harness === harness && i.sha === receipt.sha);
    if (installs.length !== 1 || !installs[0]!.location || !/^[a-f0-9]{64}$/.test(installs[0]!.treeHash) || !installs[0]!.cliVersion || !installs[0]!.pluginVersion || !installs[0]!.home) throw new Error(`Missing installation: ${harness}`);
    for (const feature of features) {
      const records = receipt.observations.filter(o => o.harness === harness && o.feature === feature);
      if (records.length !== 1) throw new Error(`Missing/duplicate evidence: ${harness}/${feature}`);
      const o = records[0]!;
      if (o.reviewer !== 'operator' || !o.surface.trim() || !o.action.trim() || !o.observed.trim() ||
          !o.transcript || !/^[a-f0-9]{64}$/.test(o.transcriptHash) || !o.artifacts.length ||
          o.artifacts.some(a => !a.path || !/^[a-f0-9]{64}$/.test(a.sha256))) throw new Error(`Incomplete evidence: ${harness}/${feature}`);
    }
  }
  if (receipt.installations.length !== (features.length ? HARNESSES.length : 0) || receipt.observations.length !== features.length * HARNESSES.length) throw new Error('Extra installation or evidence');
  if (receipt.failure) throw new Error(receipt.failure);
}

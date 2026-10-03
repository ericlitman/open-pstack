import { describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import registryData from '../features/registry.json';
import { classify, completeEvidence, matches, newReceipt, validateRegistry } from './core.ts';
import { HARNESSES, type Receipt } from './types.ts';

export const SHA = 'a'.repeat(40), BASE = 'b'.repeat(40);
export const registry = validateRegistry(registryData);
export function receipt(selfTest = false): Receipt {
  const r = newReceipt(90, SHA, BASE, selfTest, '/tmp/evidence');
  r.selection = classify([{ filename: 'README.md' }], registry);
  return r;
}
export function evidence(r: Receipt): void {
  for (const harness of HARNESSES) {
    r.installations.push({ harness, sha: r.sha, cliVersion: 'test', pluginVersion: '1.5.0',
      location: '/tmp/candidate/plugin', home: `/tmp/${harness}`, treeHash: 'c'.repeat(64) });
    for (const feature of new Set([...r.selection.features, ...(r.selfTest ? ['project-skill'] : [])])) {
      r.observations.push({ harness, feature, surface: 'native skill', action: 'invoke', observed: 'fixture changed',
        transcript: '/tmp/log', transcriptHash: 'c'.repeat(64), reviewer: 'operator',
        artifacts: [{ path: '/tmp/artifact', sha256: 'd'.repeat(64) }] });
    }
  }
}

describe('registry and ownership', () => {
  test('all tracked plugin files are covered, including consumed markdown', () => {
    const root = resolve(import.meta.dir, '../../../..');
    const paths = execFileSync('git', ['ls-files', '-z', 'plugins/pstack', '.claude-plugin', '.agents/plugins'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
    expect(paths.length).toBeGreaterThan(100);
    for (const filename of paths) expect(() => classify([{ filename }], registry)).not.toThrow();
  });
  test('validates external registry shape', () => {
    for (const value of [null, {}, { ...registry, skills: ['../bad'] }, { ...registry, tools: ['x', 'x'] }, { ...registry, shared: [3] }]) {
      expect(() => validateRegistry(value)).toThrow();
    }
  });
  test('terminal prefix cannot match sibling directory', () => {
    expect(matches('skills/x/file', 'skills/x/**')).toBe(true);
    expect(matches('skills/xyz/file', 'skills/x/**')).toBe(false);
  });
  test('markdown instructions are runtime', () => {
    for (const filename of ['plugins/pstack/skills/architect/SKILL.md', 'plugins/pstack/skills/architect/references/guide.md']) {
      const s = classify([{ filename }], registry);
      expect(s.features).toContain('skill-invocation:architect');
      expect(s.noRuntime).toBe(false);
    }
  });
  test('shared references select every dependent skill and executable surface', () => {
    const s = classify([{ filename: 'plugins/pstack/skills/poteto-mode/references/codex-tools.md' }], registry);
    expect(s.skills).toEqual([...registry.skills].sort());
    for (const feature of ['setup', 'runner', 'shipped-tools']) expect(s.features).toContain(feature);
  });
  test('asset-only installed logo changes require real harness surfaces', () => {
    const s = classify([{ filename: 'plugins/pstack/assets/logo.png' }], registry);
    expect(s.noRuntime).toBe(false);
    expect(s.skills).toEqual([...registry.skills].sort());
    for (const feature of ['setup', 'runner', 'shipped-tools']) expect(s.features).toContain(feature);
  });
  test('bootstrap changes require its shipped tool consumers, not the unrelated runner', () => {
    const s = classify([{ filename: 'plugins/pstack/skills/poteto-mode/scripts/bootstrap.ts' }], registry);
    expect(s.noRuntime).toBe(false);
    expect(s.features).toEqual(['shipped-tools']);
    expect(s.features).not.toContain('runner');
  });
  test('rename and deletion preserve old runtime ownership', () => {
    const s = classify([{ filename: 'docs/old.md', previous_filename: 'plugins/pstack/skills/architect/SKILL.md' }], registry);
    expect(s.features).toContain('skill-invocation:architect');
    expect(classify([{ filename: 'plugins/pstack/skills/architect/SKILL.md' }], registry).noRuntime).toBe(false);
  });
  test('unmapped paths and new executable leaves fail closed', () => {
    for (const filename of ['plugins/pstack/new.ts', 'plugins/pstack/skills/architect/scripts/new.ts', '/absolute', '../escape', 'plugins/pstack/skills/new/SKILL.md']) {
      expect(() => classify([{ filename }], registry)).toThrow();
    }
  });
  test('project-local verification changes cannot bypass their native self-test', () => {
    const r = receipt(true);
    r.selection = classify([{ filename: '.claude/skills/verify-open-pstack/scripts/verify.ts' }], registry);
    expect(r.selection.noRuntime).toBe(false);
    expect(r.selection.features).toEqual(['project-skill']);
    evidence(r);
    expect(() => completeEvidence(r)).not.toThrow();
  });
  test('ordinary repository documentation selects no harnesses', () => {
    const s = classify([{ filename: 'README.md' }, { filename: 'docs/guide.md' }], registry);
    expect(s.noRuntime).toBe(true);
    expect(s.features).toEqual([]);
  });
  test('consumed instructions and known verifier enforcement require native project proof', () => {
    for (const filename of ['AGENTS.md', 'CLAUDE.md', 'tests/skill-collision-repro.sh', '.mergify.yml']) {
      const s = classify([{ filename }], registry);
      expect(s.noRuntime).toBe(false);
      expect(s.features).toEqual(['project-skill']);
      expect(classify([{ filename: 'docs/moved.md', previous_filename: filename }], registry).noRuntime).toBe(false);
    }
  });
  test('unregistered CI, tests, and scripts fail closed instead of bypassing runtime proof', () => {
    for (const filename of ['.github/workflows/ci.yml', '.github/pull_request_template.md', 'tests/new-gate.sh', 'scripts/disable-proof.ts']) {
      expect(() => classify([{ filename }], registry)).toThrow();
      expect(() => classify([{ filename: 'README.md', previous_filename: filename }], registry)).toThrow();
    }
  });
});

describe('receipt and evidence boundaries', () => {
  test('validates exact immutable SHAs and PR', () => {
    for (const pr of [0, -1, 1.1, NaN]) expect(() => newReceipt(pr, SHA, BASE, false, '/tmp')).toThrow();
    for (const sha of ['main', 'a'.repeat(39), 'A'.repeat(40)]) expect(() => newReceipt(90, sha, BASE, false, '/tmp')).toThrow();
  });
  test('ordinary no-runtime has no install requirement', () => expect(() => completeEvidence(receipt())).not.toThrow());
  test('self-test is separate and required in both harnesses', () => {
    const r = receipt(true);
    expect(() => completeEvidence(r)).toThrow('Missing installation');
    evidence(r);
    expect(() => completeEvidence(r)).not.toThrow();
    r.observations.pop();
    expect(() => completeEvidence(r)).toThrow('Missing/duplicate');
  });
  test('each selected skill must have its own observation', () => {
    const r = receipt();
    r.selection = classify(registry.skills.slice(0, 2).map(s => ({ filename: `plugins/pstack/skills/${s}/SKILL.md` })), registry);
    evidence(r);
    expect(() => completeEvidence(r)).not.toThrow();
    r.observations.pop();
    expect(() => completeEvidence(r)).toThrow();
  });
  test('wrong SHA, duplicate and incomplete evidence cannot pass', () => {
    for (const damage of [
      (r: Receipt) => { r.installations[0]!.sha = BASE; },
      (r: Receipt) => { r.observations.push(r.observations[0]!); },
      (r: Receipt) => { r.observations[0]!.transcriptHash = ''; },
      (r: Receipt) => { r.observations[0]!.observed = ''; },
      (r: Receipt) => { r.observations[0]!.artifacts = []; },
      (r: Receipt) => { r.failure = 'provider unavailable'; },
    ]) {
      const r = receipt(true); evidence(r); damage(r);
      expect(() => completeEvidence(r)).toThrow();
    }
  });
});

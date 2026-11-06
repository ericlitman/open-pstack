import { describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import registryData from '../features/registry.json';
import { recipe } from '../features/recipes.ts';
import { classify, completeEvidence, matches, newReceipt, requiredFeatures, requiredHarnesses, validateRegistry } from './core.ts';
import { HARNESSES, LIVE_HARNESSES, type Receipt } from './types.ts';
import codexManifest from '../../../../plugins/pstack/.codex-plugin/plugin.json';
import claudeManifest from '../../../../plugins/pstack/.claude-plugin/plugin.json';

export const SHA = 'a'.repeat(40), BASE = 'b'.repeat(40);
export const registry = validateRegistry(registryData);
export function receipt(selfTest = false): Receipt {
  const r = newReceipt(90, SHA, BASE, selfTest, '/tmp/evidence');
  r.selection = classify([{ filename: 'README.md' }], registry);
  return r;
}
const both = (...features: string[]): string[] => HARNESSES.flatMap(h => features.map(f => `${h}:${f}`)).sort();
export function evidence(r: Receipt): void {
  for (const harness of requiredHarnesses(r)) {
    r.installations.push({ harness, sha: r.sha, cliVersion: 'test', pluginVersion: '1.5.0',
      location: '/tmp/candidate/plugin', home: `/tmp/${harness}`, treeHash: 'c'.repeat(64) });
    for (const feature of requiredFeatures(r, harness)) {
      r.observations.push({ harness, feature, surface: 'native skill', action: 'invoke', observed: 'fixture changed',
        transcript: '/tmp/log', transcriptHash: 'c'.repeat(64), reviewer: 'recipe', assertions: ['invoke:skill-loaded'],
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
    for (const value of [null, {}, { ...registry, skills: ['../bad'] }, { ...registry, tools: ['x', 'x'] }, { ...registry, shared: [3] }, { ...registry, assets: undefined }, { ...registry, assets: ['../asset'] }, { ...registry, assets: ['x', 'x'] }, { ...registry, catalog: undefined }]) {
      expect(() => validateRegistry(value)).toThrow();
    }
  });
  test('terminal prefix cannot match sibling directory', () => {
    expect(matches('skills/x/file', 'skills/x/**')).toBe(true);
    expect(matches('skills/xyz/file', 'skills/x/**')).toBe(false);
  });
  test('repository-root attribution files are not runtime', () => {
    for (const filename of ['NOTICE.md', 'README-UPSTREAM.md', 'REVIEW.md', 'LICENSE-cursor-team-kit', 'LICENSE-superpowers']) {
      expect(classify([{ filename }], registry).noRuntime).toBe(true);
    }
  });
  test('markdown instructions are runtime', () => {
    for (const filename of ['plugins/pstack/skills/architect/SKILL.md', 'plugins/pstack/skills/architect/references/guide.md']) {
      const s = classify([{ filename }], registry);
      expect(s.features).toEqual(both('skill-invocation:architect'));
      expect(s.noRuntime).toBe(false);
    }
  });
  test('shared references select every dependent skill and executable surface', () => {
    const s = classify([{ filename: 'plugins/pstack/skills/poteto-mode/references/codex-tools.md' }], registry);
    expect(s.skills).toEqual([...registry.skills].sort());
    for (const feature of both('setup', 'runner', 'shipped-tools', 'hook:startup')) expect(s.features).toContain(feature);
    expect(s.features).toContain('claude:agent-preload:poteto-agent');
    expect(s.features).not.toContain('codex:agent-preload:poteto-agent');
  });
  test('only the T3 dispatch surfaces reach t3:dispatch, and self-test never adds a T3 session', () => {
    const reach = (filename: string) => classify([{ filename }], registry).features.includes('t3:dispatch');
    for (const filename of ['plugins/pstack/skills/poteto-mode/references/provider-dispatch.md', 'plugins/pstack/skills/poteto-mode/references/codex-tools.md',
      'plugins/pstack/skills/setup-pstack/SKILL.md', '.claude/skills/verify-open-pstack/features/recipes.ts']) expect(reach(filename)).toBe(true);
    for (const filename of ['plugins/pstack/skills/poteto-mode/references/model-catalog.md', 'plugins/pstack/skills/poteto-mode/SKILL.md',
      'plugins/pstack/hooks/hooks.json', '.claude/skills/verify-open-pstack/scripts/harness.ts']) expect(reach(filename)).toBe(false);
    const r = receipt(true);
    expect(requiredHarnesses(r)).toEqual(['claude', 'codex']);
    r.runFeatures = ['t3:dispatch'];
    expect(requiredHarnesses(r)).toEqual(['claude', 'codex', 't3']);
    expect(requiredFeatures(r, 't3')).toEqual(['dispatch']);
  });
  test('poteto-mode SKILL.md also reaches the Claude agent that preloads it', () => {
    const s = classify([{ filename: 'plugins/pstack/skills/poteto-mode/SKILL.md' }], registry);
    expect(s.features).toEqual([...both('skill-invocation:poteto-mode'), 'claude:agent-preload:poteto-agent'].sort());
  });
  const CATALOG = 'plugins/pstack/skills/poteto-mode/references/model-catalog.md';
  test('catalog-only changes select catalog, setup and runner and no skill check', () => {
    for (const filename of [CATALOG, 'plugins/pstack/agents/pstack-opus-max.md', 'plugins/pstack/agents/pstack-fable-low.md',
      'plugins/pstack/agents/pstack-sonnet-max.md', 'plugins/pstack/agents/pstack-opus-5-5-low.md',
      'plugins/pstack/skills/poteto-mode/scripts/runner/registry/models.ts']) {
      const s = classify([{ filename }], registry);
      expect(s.skills).toEqual([]);
      expect(s.features).toEqual(both('catalog', 'runner', 'setup'));
    }
    expect(classify([{ filename: 'plugins/pstack/skills/poteto-mode/scripts/runner/providers/grok.ts' }], registry).features)
      .toEqual(both('catalog', 'runner', 'setup', 'writers'));
  });
  test('a renamed or deleted catalog path keeps catalog ownership', () => {
    for (const previous_filename of [CATALOG, 'plugins/pstack/agents/pstack-opus-max.md']) {
      expect(classify([{ filename: 'docs/moved.md', previous_filename }], registry).features).toEqual(both('catalog', 'runner', 'setup'));
    }
  });
  test('a catalog change mixed with a shared reference or a skill keeps their checks', () => {
    const shared = classify([{ filename: CATALOG }, { filename: 'plugins/pstack/skills/poteto-mode/references/provider-dispatch.md' }], registry);
    expect(shared.skills).toEqual([...registry.skills].sort());
    for (const feature of both('catalog', 'setup', 'runner', 'shipped-tools')) expect(shared.features).toContain(feature);
    const skill = classify([{ filename: 'plugins/pstack/agents/pstack-opus-max.md' }, { filename: 'plugins/pstack/skills/arena/SKILL.md' }], registry);
    expect(skill.features).toEqual(both('catalog', 'runner', 'setup', 'skill-invocation:arena'));
  });
  test('an unlisted generated agent fails closed', () => {
    expect(() => classify([{ filename: 'plugins/pstack/agents/pstack-retired-max.md' }], registry)).toThrow('Unmapped path');
    expect(classify([{ filename: 'plugins/pstack/agents/poteto-agent.md' }], registry).skills).toEqual([...registry.skills].sort());
  });
  test('installed logo changes require only their actual Codex manifest consumer', () => {
    expect(codexManifest.interface.logo).toBe('./assets/logo.png');
    expect(JSON.stringify(claudeManifest)).not.toContain('assets/logo.png');
    const r = receipt();
    r.selection = classify([{ filename: 'plugins/pstack/assets/logo.png' }], registry);
    expect(r.selection.noRuntime).toBe(false);
    expect(r.selection.skills).toEqual([]);
    expect(r.selection.features).toEqual(['codex:assets:codex']);
    r.runFeatures = ['codex:assets:codex'];
    expect(requiredHarnesses(r)).toEqual(['codex']);
    expect(requiredFeatures(r, 'claude')).toEqual([]);
    expect(requiredFeatures(r, 'codex')).toEqual(['assets:codex']);
    expect(() => completeEvidence(r)).toThrow('Missing installation: codex');
    evidence(r);
    expect(r.installations.map(i => i.harness)).toEqual(['codex']);
    expect(() => completeEvidence(r)).not.toThrow();
    r.observations.push({ ...r.observations[0]!, harness: 'claude' });
    expect(() => completeEvidence(r)).toThrow('Extra installation or evidence');
  });
  test('unknown assets fail closed rather than inheriting logo consumers', () => {
    for (const filename of ['plugins/pstack/assets/new.png', 'plugins/pstack/assets/nested/logo.png']) {
      expect(() => classify([{ filename }], registry)).toThrow('Unmapped asset consumer');
      expect(() => classify([{ filename: 'README.md', previous_filename: filename }], registry)).toThrow('Unmapped asset consumer');
    }
  });
  test('manifest changes classify as shared runtime unless they only bump the version', () => {
    for (const filename of ['plugins/pstack/.claude-plugin/plugin.json', 'plugins/pstack/.codex-plugin/plugin.json', '.claude-plugin/marketplace.json', '.agents/plugins/marketplace.json']) {
      expect(classify([{ filename }], registry).features).toContain('claude:setup');
    }
    expect(classify([{ filename: '.agents/plugins/marketplace.json', versionOnly: true }], registry).features).toContain('codex:setup');
    expect(classify([{ filename: 'plugins/pstack/.claude-plugin/plugin.json', versionOnly: true }], registry).features).toEqual(['claude:hook:startup']);
    expect(classify([{ filename: '.claude-plugin/marketplace.json', versionOnly: true }], registry).features).toEqual(['claude:hook:startup']);
    expect(classify([{ filename: 'plugins/pstack/.codex-plugin/plugin.json', versionOnly: true }], registry).features).toEqual(['codex:hook:startup']);
  });
  const RELEASE = [{ filename: '.claude-plugin/marketplace.json', versionOnly: true }, { filename: 'CHANGES.md' }, { filename: 'README.md' }, { filename: 'UPSTREAM.md' },
    { filename: 'docs/reference.md' }, { filename: 'plugins/pstack/.claude-plugin/plugin.json', versionOnly: true }, { filename: 'plugins/pstack/.codex-plugin/plugin.json', versionOnly: true }];
  test('a version-only release reaches only the startup hook in both harnesses', () => {
    expect(classify(RELEASE, registry).features).toEqual(['claude:hook:startup', 'codex:hook:startup']);
    const edited = RELEASE.map(f => f.filename === 'plugins/pstack/.codex-plugin/plugin.json' ? { filename: f.filename } : f);
    const s = classify(edited, registry);
    expect(s.skills).toEqual([...registry.skills].sort());
    for (const feature of both('setup', 'runner', 'shipped-tools', 'hook:startup')) expect(s.features).toContain(feature);
  });
  test('asset self-test requires both harnesses without fictitious Claude asset proof', () => {
    const r = receipt(true);
    r.selection = classify([{ filename: 'plugins/pstack/assets/logo.png' }], registry);
    r.runFeatures = ['codex:assets:codex'];
    expect(requiredHarnesses(r)).toEqual(['claude', 'codex']);
    expect(requiredFeatures(r, 'claude')).toEqual(['project-skill']);
    expect(requiredFeatures(r, 'codex')).toEqual(['assets:codex', 'project-skill']);
    evidence(r);
    expect(r.observations).toHaveLength(3);
    expect(() => completeEvidence(r)).not.toThrow();
    r.observations = r.observations.filter(o => o.harness !== 'claude');
    expect(() => completeEvidence(r)).toThrow('Missing/duplicate evidence: claude/project-skill');
  });
  test('bootstrap changes require its shipped tool consumers, not the unrelated runner', () => {
    const s = classify([{ filename: 'plugins/pstack/skills/poteto-mode/scripts/bootstrap.ts' }], registry);
    expect(s.noRuntime).toBe(false);
    expect(s.features).toEqual(both('shipped-tools'));
  });
  test('the transcript resolver belongs to Reflect rather than unrelated shipped tools', () => {
    const path = 'plugins/pstack/skills/poteto-mode/scripts/resolve-codex-transcript.ts';
    for (const file of [{ filename: path }, { filename: path.replace('.ts', '') }, { filename: 'docs/removed-resolver.md', previous_filename: path }]) {
      const s = classify([file], registry);
      expect(s.skills).toEqual(['reflect']);
      expect(s.features).toEqual(both('skill-invocation:reflect'));
    }
    expect(() => classify([{ filename: path.replace('.ts', '.py') }], registry)).toThrow('Unmapped path');
    expect(classify([{ filename: path.replace('.ts', '.test.ts') }], registry).noRuntime).toBe(true);
  });
  test('rename and deletion preserve old runtime ownership', () => {
    const s = classify([{ filename: 'docs/old.md', previous_filename: 'plugins/pstack/skills/architect/SKILL.md' }], registry);
    expect(s.features).toContain('claude:skill-invocation:architect');
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
    expect(r.selection.features).toEqual(both('project-skill'));
    evidence(r);
    expect(() => completeEvidence(r)).not.toThrow();
  });
  test('the shared recipe implementation reaches every implemented recipe and preserves project proof', () => {
    const path = '.claude/skills/verify-open-pstack/features/recipes.ts';
    const expected = [...both('catalog', 'setup', 'runner', 'shipped-tools', 'hook:startup', 'project-skill', 'writers',
      ...registry.skills.map(skill => `skill-invocation:${skill}`)), 'claude:agent-preload:poteto-agent', 't3:dispatch'].sort();
    for (const file of [{ filename: path }, { filename: 'docs/moved.md', previous_filename: path }]) {
      const s = classify([file], registry);
      expect(s.features).toEqual(expected);
      expect(s.skills).toEqual([...registry.skills].sort());
      expect(s.noRuntime).toBe(false);
      for (const harness of LIVE_HARNESSES) {
        for (const feature of s.features.filter(f => f.startsWith(`${harness}:`))) {
          expect(recipe(feature.slice(harness.length + 1), harness).length).toBeGreaterThan(0);
        }
      }
    }
  });
  test('nearby verifier documentation retains only project proof', () => {
    for (const filename of ['.claude/skills/verify-open-pstack/features/README.md',
      '.claude/skills/verify-open-pstack/features/skill-invocation.md']) {
      expect(classify([{ filename }], registry).features).toEqual(both('project-skill'));
    }
  });
  test('shared recipe expansion survives overlapping catalog ownership without broadening ordinary catalog paths', () => {
    const path = '.claude/skills/verify-open-pstack/features/recipes.ts';
    const overlapping = { ...registry, catalog: [...registry.catalog, path], shared: [...registry.shared, path] };
    expect(classify([{ filename: path }], overlapping)).toEqual(classify([{ filename: path }], registry));
    const catalog = registry.catalog[0]!;
    expect(classify([{ filename: catalog }], overlapping)).toEqual(classify([{ filename: catalog }], registry));
  });
  test('ordinary repository documentation selects no harnesses', () => {
    const s = classify([{ filename: 'README.md' }, { filename: 'docs/guide.md' }], registry);
    expect(s.noRuntime).toBe(true);
    expect(s.features).toEqual([]);
  });
  test('consumed instructions and known verifier enforcement require native project proof', () => {
    for (const filename of ['AGENTS.md', 'CLAUDE.md', 'tests/skill-collision-repro.sh', '.github/workflows/ci.yml', 'package.json']) {
      const s = classify([{ filename }], registry);
      expect(s.noRuntime).toBe(false);
      expect(s.features).toEqual(both('project-skill'));
      expect(classify([{ filename: 'docs/moved.md', previous_filename: filename }], registry).noRuntime).toBe(false);
    }
  });
  test('Mergify enforcement is not plugin runtime, including renamed paths', () => {
    for (const file of [{ filename: '.mergify.yml' }, { filename: 'docs/moved.md', previous_filename: '.mergify.yml' }]) {
      const r = receipt();
      r.selection = classify([file], registry);
      expect(r.selection.noRuntime).toBe(true);
      expect(requiredHarnesses(r)).toEqual([]);
      expect(() => completeEvidence(r)).not.toThrow();
    }
  });
  test('unregistered CI, tests, and scripts fail closed instead of bypassing runtime proof', () => {
    for (const filename of ['.github/workflows/new-gate.yml', '.github/pull_request_template.md', 'tests/new-gate.sh', 'scripts/disable-proof.ts']) {
      expect(() => classify([{ filename }], registry)).toThrow();
      expect(() => classify([{ filename: 'README.md', previous_filename: filename }], registry)).toThrow();
    }
  });
});

describe('receipt and evidence boundaries', () => {
  test('validates exact immutable SHAs, PR, and optional publisher revision', () => {
    for (const pr of [0, -1, 1.1, NaN]) expect(() => newReceipt(pr, SHA, BASE, false, '/tmp')).toThrow();
    for (const sha of ['main', 'a'.repeat(39), 'A'.repeat(40)]) expect(() => newReceipt(90, sha, BASE, false, '/tmp')).toThrow();
    expect(newReceipt(90, SHA, BASE, false, '/tmp', 'c'.repeat(40)).publisherRevision).toBe('c'.repeat(40));
    for (const revision of ['', 'main', 'c'.repeat(39), 'c'.repeat(64), 'C'.repeat(40)]) expect(() => newReceipt(90, SHA, BASE, false, '/tmp', revision)).toThrow('publisher revision');
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
    r.runFeatures = registry.skills.slice(0, 2).map(s => `claude:skill-invocation:${s}`);
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
      (r: Receipt) => { r.observations[0]!.assertions = []; },
      (r: Receipt) => { r.observations[0]!.artifacts = []; },
      (r: Receipt) => { r.failure = 'provider unavailable'; },
    ]) {
      const r = receipt(true); evidence(r); damage(r);
      expect(() => completeEvidence(r)).toThrow();
    }
  });
});

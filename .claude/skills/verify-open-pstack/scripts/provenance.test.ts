import { afterEach, expect, test } from 'bun:test';
import { chmod, mkdtemp, mkdir, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { command } from './io.ts';
import { sourceDigest, sourceHash } from './provenance.ts';

const roots: string[] = [];
const project = '.claude/skills/verify-open-pstack';
const plugin = 'plugins/pstack';
const alias = '.agents/skills/verify-open-pstack';
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture(): Promise<{ root: string; sha: string }> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pstack-provenance-'))); roots.push(root);
  await mkdir(join(root, project, 'scripts'), { recursive: true });
  await mkdir(join(root, plugin, 'skills/poteto-mode/scripts'), { recursive: true });
  await mkdir(join(root, '.agents/skills'), { recursive: true });
  await writeFile(join(root, project, 'SKILL.md'), 'native project skill\n');
  await writeFile(join(root, project, 'scripts/verify.sh'), '#!/bin/sh\ntrue\n', { mode: 0o755 });
  await writeFile(join(root, plugin, 'plugin.json'), '{"version":"1"}\n');
  await writeFile(join(root, plugin, 'skills/poteto-mode/scripts/bootstrap.ts'), 'bootstrap\n');
  await symlink('../../.claude/skills/verify-open-pstack', join(root, alias));
  for (const args of [
    ['git', 'init', '--quiet'], ['git', 'config', 'user.name', 'Provenance Test'],
    ['git', 'config', 'user.email', 'test@example.invalid'], ['git', 'add', '.'],
    ['git', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'fixture'],
  ]) await command(args, { cwd: root });
  return { root, sha: (await command(['git', 'rev-parse', 'HEAD'], { cwd: root })).trim() };
}

test('real pinned source remains stable after both permitted dependency bootstraps, including symlinks', async () => {
  const { root, sha } = await fixture(), before = await sourceHash(root, sha);
  const dependencyTarget = join(root, 'generated-dependency');
  await mkdir(dependencyTarget); await writeFile(join(dependencyTarget, 'runtime.js'), 'generated\n');
  for (const path of [`${project}/node_modules`, `${plugin}/skills/poteto-mode/scripts/node_modules`]) await symlink(dependencyTarget, join(root, path));
  expect(await sourceHash(root, sha)).toBe(before);
  await writeFile(join(dependencyTarget, 'runtime.js'), 'generated update\n');
  expect(await sourceHash(root, sha)).toBe(before);
  expect(before).toMatch(/^[a-f0-9]{64}$/);
  expect(await sourceDigest(root)).toBe(before);
});

test('canonical project code mutation and added source fail against pinned Git blobs', async () => {
  const { root, sha } = await fixture();
  await writeFile(join(root, project, 'SKILL.md'), 'changed instructions\n');
  await expect(sourceHash(root, sha)).rejects.toThrow('Source differs from pinned Git tree');
  await writeFile(join(root, project, 'SKILL.md'), 'native project skill\n');
  await writeFile(join(root, project, 'scripts/new.ts'), 'untracked candidate code\n');
  await expect(sourceHash(root, sha)).rejects.toThrow('Source differs from pinned Git tree');
});

test('plugin code mutation, executable-bit changes and missing source fail against the pinned tree', async () => {
  const { root, sha } = await fixture();
  await writeFile(join(root, plugin, 'plugin.json'), '{}\n');
  await expect(sourceHash(root, sha)).rejects.toThrow('Source differs from pinned Git tree');
  await writeFile(join(root, plugin, 'plugin.json'), '{"version":"1"}\n');
  await command(['git', 'config', 'core.filemode', 'false'], { cwd: root });
  await chmod(join(root, project, 'scripts/verify.sh'), 0o644);
  await expect(sourceHash(root, sha)).rejects.toThrow('Source differs from pinned Git tree');
  await chmod(join(root, project, 'scripts/verify.sh'), 0o755);
  await rm(join(root, project, 'SKILL.md'));
  await expect(sourceHash(root, sha)).rejects.toThrow('Source differs from pinned Git tree');
});

test('Codex alias target must be exact and canonical even when alternate spelling resolves identically', async () => {
  const { root, sha } = await fixture();
  await rm(join(root, alias));
  await symlink('../../.claude/skills/../skills/verify-open-pstack', join(root, alias));
  await expect(sourceHash(root, sha)).rejects.toThrow('Codex alias');
  await rm(join(root, alias));
  await mkdir(join(root, 'other-skill'));
  await symlink('../../other-skill', join(root, alias));
  await expect(sourceHash(root, sha)).rejects.toThrow('Codex alias');
});

test('generated exclusions are narrow and source symlinks are not accepted', async () => {
  const { root, sha } = await fixture();
  await mkdir(join(root, project, 'scripts/node_modules'));
  await writeFile(join(root, project, 'scripts/node_modules/hidden.ts'), 'unexpected\n');
  await expect(sourceHash(root, sha)).rejects.toThrow('Source differs from pinned Git tree');
  await rm(join(root, project, 'scripts/node_modules'), { recursive: true });
  await rm(join(root, project, 'SKILL.md'));
  await symlink(join(root, plugin, 'plugin.json'), join(root, project, 'SKILL.md'));
  await expect(sourceHash(root, sha)).rejects.toThrow('Source differs from pinned Git tree');
});

test('filesystem-only rechecks cannot be spoofed by modified Git metadata or a forged Git executable', async () => {
  const { root, sha } = await fixture(), pinned = await sourceHash(root, sha);
  expect(await sourceDigest(root)).toBe(pinned);
  await rm(join(root, '.git'), { recursive: true });
  await mkdir(join(root, '.git'));
  await writeFile(join(root, '.git/HEAD'), 'forged pinned metadata\n');
  const bin = join(root, 'bin'), invoked = join(root, 'git-invoked');
  await mkdir(bin);
  await writeFile(join(bin, 'git'), `#!/bin/sh\nprintf invoked > '${invoked}'\nprintf '${sha}\\n'\n`, { mode: 0o755 });
  const path = process.env.PATH;
  try {
    process.env.PATH = bin;
    expect(await sourceDigest(root)).toBe(pinned);
    await writeFile(join(root, project, 'SKILL.md'), 'forged project source\n');
    expect(await sourceDigest(root)).not.toBe(pinned);
    expect(await Bun.file(invoked).exists()).toBe(false);
  } finally {
    if (path === undefined) delete process.env.PATH;
    else process.env.PATH = path;
  }
});

test('filesystem digest detects plugin/source additions, deletions, and executable mode changes', async () => {
  const { root, sha } = await fixture(), pinned = await sourceHash(root, sha);
  const manifest = join(root, plugin, 'plugin.json');
  await writeFile(manifest, 'changed plugin\n');
  expect(await sourceDigest(root)).not.toBe(pinned);
  await writeFile(manifest, '{"version":"1"}\n');
  expect(await sourceDigest(root)).toBe(pinned);
  const added = join(root, project, 'scripts/extra.ts');
  await writeFile(added, 'extra code\n');
  expect(await sourceDigest(root)).not.toBe(pinned);
  await rm(added);
  await chmod(join(root, project, 'scripts/verify.sh'), 0o644);
  expect(await sourceDigest(root)).not.toBe(pinned);
  await chmod(join(root, project, 'scripts/verify.sh'), 0o755);
  expect(await sourceDigest(root)).toBe(pinned);
  await rm(manifest);
  expect(await sourceDigest(root)).not.toBe(pinned);
});

test('filesystem rechecks reject a candidate workspace redirected to an untouched pinned copy', async () => {
  const { root, sha } = await fixture(), pinned = await sourceHash(root, sha);
  const untouched = `${root}-untouched`;
  await rename(root, untouched); roots.push(untouched);
  await symlink(untouched, root);
  expect(await sourceDigest(untouched)).toBe(pinned);
  await expect(sourceDigest(root)).rejects.toThrow('workspace root must not be redirected');
});

test('filesystem rechecks reject noncanonical aliases and source symlinks including ancestor directories', async () => {
  const { root } = await fixture();
  await rm(join(root, alias));
  await symlink('../../.claude/skills/../skills/verify-open-pstack', join(root, alias));
  await expect(sourceDigest(root)).rejects.toThrow('Codex alias');
  await rm(join(root, alias));
  await symlink('../../.claude/skills/verify-open-pstack', join(root, alias));
  await rm(join(root, project, 'SKILL.md'));
  await symlink(join(root, plugin, 'plugin.json'), join(root, project, 'SKILL.md'));
  await expect(sourceDigest(root)).rejects.toThrow('source symlink');
  await rm(join(root, project, 'SKILL.md'));
  await writeFile(join(root, project, 'SKILL.md'), 'native project skill\n');
  await rm(join(root, '.agents/skills'), { recursive: true });
  await mkdir(join(root, 'redirected-skills'));
  await symlink('../../.claude/skills/verify-open-pstack', join(root, 'redirected-skills/verify-open-pstack'));
  await symlink(join(root, 'redirected-skills'), join(root, '.agents/skills'));
  await expect(sourceDigest(root)).rejects.toThrow('source directory');
});

test('filesystem digest does not exclude dependency-like directories outside the two permitted paths', async () => {
  const { root, sha } = await fixture(), pinned = await sourceHash(root, sha);
  await mkdir(join(root, project, 'scripts/node_modules'));
  await writeFile(join(root, project, 'scripts/node_modules/source.ts'), 'unexpected code\n');
  expect(await sourceDigest(root)).not.toBe(pinned);
  await rm(join(root, project, 'scripts/node_modules/source.ts'));
  await symlink(join(root, plugin, 'plugin.json'), join(root, project, 'scripts/node_modules/source.ts'));
  await expect(sourceDigest(root)).rejects.toThrow('source symlink');
});

test('HEAD must match exact pinned source and committed dependency directories cannot be excluded', async () => {
  const { root, sha } = await fixture();
  await expect(sourceHash(root, 'a'.repeat(40))).rejects.toThrow('HEAD differs');
  await expect(sourceHash(root, 'HEAD')).rejects.toThrow('exact pinned SHA');
  await mkdir(join(root, project, 'node_modules'));
  await writeFile(join(root, project, 'node_modules/committed.ts'), 'tracked runtime\n');
  await command(['git', 'add', '.'], { cwd: root });
  await command(['git', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'tracked dependencies'], { cwd: root });
  const changed = (await command(['git', 'rev-parse', 'HEAD'], { cwd: root })).trim();
  await expect(sourceHash(root, sha)).rejects.toThrow('HEAD differs');
  await expect(sourceHash(root, changed)).rejects.toThrow('Pinned source files missing');
});

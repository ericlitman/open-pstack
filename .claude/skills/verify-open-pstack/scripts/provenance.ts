import { createHash } from 'node:crypto';
import { lstat, readFile, readlink, readdir, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { command, sha256, treeHash, type Command } from './io.ts';

const plugin = 'plugins/pstack';
const project = '.claude/skills/verify-open-pstack';
const alias = '.agents/skills/verify-open-pstack';
const aliasTarget = '../../.claude/skills/verify-open-pstack';
const generated = new Set([
  'plugins/pstack/skills/poteto-mode/scripts/node_modules',
  '.claude/skills/verify-open-pstack/node_modules',
]);

export async function sourceDigest(workspace: string): Promise<string> {
  const root = await realpath(workspace);
  if (root !== resolve(workspace) || (await lstat(workspace)).isSymbolicLink()) throw new Error('Pinned workspace root must not be redirected');
  for (const path of ['plugins', plugin, '.claude', '.claude/skills', project, '.agents', '.agents/skills']) {
    const stat = await lstat(join(root, path));
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`Pinned source directory refused: ${path}`);
  }
  const aliasPath = join(root, alias);
  if (!(await lstat(aliasPath)).isSymbolicLink() || await readlink(aliasPath) !== aliasTarget || await realpath(aliasPath) !== join(root, project)) {
    throw new Error('Codex alias does not resolve to the canonical pinned project skill');
  }
  const entries: string[] = [];
  async function walk(path: string): Promise<void> {
    if (generated.has(path)) return;
    const actual = join(root, path), stat = await lstat(actual);
    if (stat.isSymbolicLink()) throw new Error(`Pinned source symlink refused: ${path}`);
    if (stat.isDirectory()) {
      for (const name of (await readdir(actual)).sort()) await walk(`${path}/${name}`);
    } else if (stat.isFile()) {
      entries.push(`${path}\0${stat.mode & 0o111 ? '100755' : '100644'}\0${sha256(await readFile(actual))}`);
    } else throw new Error(`Non-file in pinned source tree: ${path}`);
  }
  await walk(plugin);
  await walk(project);
  entries.push([alias, '120000', sha256(Buffer.from(await readlink(aliasPath)))].join('\0'));
  return sha256(entries.sort().join('\n'));
}

export async function sourceHash(workspace: string, sha: string, run: Command = command): Promise<string> {
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error('Source provenance requires an exact pinned SHA');
  const git = ['git', '--no-replace-objects', '-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null'];
  if ((await run([...git, 'rev-parse', 'HEAD'], { cwd: workspace })).trim() !== sha) {
    throw new Error('Project source HEAD differs from pinned SHA');
  }
  const aliasPath = join(workspace, alias);
  if (!(await lstat(aliasPath)).isSymbolicLink() || await readlink(aliasPath) !== aliasTarget || await realpath(aliasPath) !== await realpath(join(workspace, project))) {
    throw new Error('Codex alias does not resolve to the canonical pinned project skill');
  }
  try {
    await run([...git, 'diff', '--quiet', '--no-ext-diff', '--no-textconv', sha, '--', plugin, project, alias], { cwd: workspace });
  } catch {
    throw new Error('Source differs from pinned Git tree');
  }
  const tree = await run([...git, 'ls-tree', '-rz', '--full-tree', sha, '--', plugin, project, alias], { cwd: workspace });
  const expected = new Map<string, { mode: string; blob: string }>();
  for (const entry of tree.split('\0').filter(Boolean)) {
    const tab = entry.indexOf('\t'), fields = entry.slice(0, tab).split(' '), path = entry.slice(tab + 1);
    if (tab < 0 || fields.length !== 3 || fields[1] !== 'blob' || !/^(100644|100755|120000)$/.test(fields[0]!) || !/^[a-f0-9]{40}$/.test(fields[2]!)) {
      throw new Error('Unrecognized pinned source tree');
    }
    if (path !== alias && !path.startsWith(plugin + '/') && !path.startsWith(project + '/')) throw new Error('Pinned source path escaped coverage');
    if (expected.has(path)) throw new Error('Duplicate pinned source path');
    expected.set(path, { mode: fields[0]!, blob: fields[2]! });
  }
  if (!expected.has(alias) || ![...expected.keys()].some(path => path.startsWith(project + '/')) || ![...expected.keys()].some(path => path.startsWith(plugin + '/'))) {
    throw new Error('Pinned source tree lacks plugin, canonical project skill, or Codex alias');
  }
  const entries: string[] = [];
  function accept(path: string, mode: string, bytes: Uint8Array): void {
    const pinned = expected.get(path);
    const blob = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    if (!pinned || pinned.mode !== mode || pinned.blob !== blob) throw new Error(`Source differs from pinned Git tree: ${path}`);
    expected.delete(path);
    entries.push(`${path}\0${mode}\0${sha256(bytes)}`);
  }
  async function walk(path: string): Promise<void> {
    // Only these two untracked dependency directories may vary after bootstrap.
    if (generated.has(path)) return;
    const actual = join(workspace, path), stat = await lstat(actual);
    if (stat.isSymbolicLink()) throw new Error(`Pinned source symlink refused: ${path}`);
    if (stat.isDirectory()) {
      for (const name of (await readdir(actual)).sort()) await walk(`${path}/${name}`);
    } else if (stat.isFile()) {
      accept(path, stat.mode & 0o111 ? '100755' : '100644', await readFile(actual));
    } else throw new Error(`Non-file in pinned source tree: ${path}`);
  }
  const pluginHash = await treeHash(join(workspace, plugin), ['skills/poteto-mode/scripts/node_modules']);
  await walk(plugin);
  if (sha256(entries.map(entry => entry.slice(plugin.length + 1)).join('\n')) !== pluginHash) throw new Error('Plugin source changed while checking provenance');
  await walk(project);
  accept(alias, '120000', Buffer.from(await readlink(aliasPath)));
  if (expected.size) throw new Error(`Pinned source files missing: ${[...expected.keys()].join(', ')}`);
  return sha256(entries.sort().join('\n'));
}

import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';

export type Command = (args: string[], options?: { cwd?: string; env?: Record<string, string>; interactive?: boolean; allowInterrupted?: boolean }) => Promise<string>;
export const interruption = new AbortController();
const activeCommands = new Map<number, Promise<number>>();
let interrupting: Promise<void> | undefined;
export function interruptCommands(signal: 'SIGINT' | 'SIGTERM'): Promise<void> {
  if (interrupting) return interrupting;
  interruption.abort(new Error(`Interrupted by ${signal}`));
  interrupting = (async () => {
    const children = [...activeCommands];
    for (const [pid] of children) {
      try { process.kill(-pid, 'SIGKILL'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
    }
    await Promise.all(children.map(([, exited]) => exited));
  })();
  return interrupting;
}
export const command: Command = async (args, options = {}) => {
  if (!options.allowInterrupted) interruption.signal.throwIfAborted();
  const child = Bun.spawn(args, { cwd: options.cwd, env: options.env, detached: true,
    stdin: options.interactive ? 'inherit' : 'ignore', stdout: options.interactive ? 'inherit' : 'pipe',
    stderr: options.interactive ? 'inherit' : 'pipe' });
  if (!options.allowInterrupted) activeCommands.set(child.pid, child.exited);
  try {
    const [output, error] = options.interactive ? ['', ''] : await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(),
    ]);
    const code = await child.exited;
    if (!options.allowInterrupted) interruption.signal.throwIfAborted();
    if (code !== 0) throw new Error(`${args[0]} failed: ${redact(error).slice(0, 1500)}`);
    return output;
  } finally {
    activeCommands.delete(child.pid);
  }
};
const secrets = new Set<string>();
export function registerSecrets(values: string[]): void {
  for (const value of values) if (value) secrets.add(value);
}
function redactSecrets(text: string): string {
  for (const secret of [...secrets].sort((a, b) => b.length - a.length)) text = text.split(secret).join('[REDACTED]');
  return text;
}
export function redact(text: string): string {
  return redactSecrets(text).replace(/(?:gh[pousr]_[\w]+|github_pat_[\w]+|sk-[\w-]+|Bearer[ \t]+[^\s"'<>()[\]{},;]+)/gi, '[REDACTED]');
}
export function isolatedEnv(home: string, harness?: 'claude' | 'codex'): Record<string, string> {
  if (!isAbsolute(home)) throw new Error('Candidate HOME must be an absolute run-owned directory');
  const env: Record<string, string> = { PATH: [join(home, 'bin'), ...(process.env.PATH ?? '').split(':').filter(isAbsolute)].join(':'),
    HOME: home, TMPDIR: join(home, 'tmp'), TERM: process.env.TERM ?? 'xterm-256color',
    XDG_CONFIG_HOME: join(home, '.config'), XDG_CACHE_HOME: join(home, '.cache'),
    GH_CONFIG_DIR: join(home, '.config/gh'),
    GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'credential.helper', GIT_CONFIG_VALUE_0: '',
    CLAUDE_CONFIG_DIR: join(home, '.claude'), CODEX_HOME: join(home, '.codex') };
  for (const name of ['USER', 'LOGNAME']) {
    if (process.env[name] !== undefined) env[name] = process.env[name];
  }
  return env;
}
export async function save(path: string, value: unknown): Promise<void> {
  const pathKeys = new Set(['path', 'paths', 'skill', 'workspace', 'featureMap', 'home', 'location', 'artifactRoot', 'transcript']);
  const pathArrays = new WeakSet<object>();
  const json = JSON.stringify(value, function (key, item) {
    if (pathKeys.has(key) && Array.isArray(item)) pathArrays.add(item);
    return typeof item === 'string' ? (pathKeys.has(key) || pathArrays.has(this) ? redactSecrets(item) : redact(item)) : item;
  }, 2);
  await writeFile(path + '.tmp', json + '\n', { mode: 0o600 });
  await rename(path + '.tmp', path);
}
export async function freshRoot(path: string, repository: string): Promise<string> {
  if (!isAbsolute(path)) throw new Error('Output must be an absolute fresh directory outside the repository');
  const parent = await realpath(resolve(path, '..'));
  const root = join(parent, path.split('/').at(-1)!);
  const repo = await realpath(repository);
  if (root === repo || root.startsWith(repo + '/')) throw new Error('Output must be outside the repository');
  await mkdir(root, { mode: 0o700 }); // EEXIST deliberately rejects reuse and symlinks.
  return root;
}
export function sha256(data: string | Uint8Array): string { return createHash('sha256').update(data).digest('hex'); }
export async function treeHash(root: string, excludePaths: string[] = []): Promise<string> {
  const generated = new Set([
    'skills/poteto-mode/scripts/node_modules',
    'plugins/pstack/skills/poteto-mode/scripts/node_modules',
    '.claude/skills/verify-open-pstack/node_modules',
  ]);
  if (excludePaths.some(path => !generated.has(path))) throw new Error('Only explicit generated dependency directories may be excluded');
  const excluded = new Set(excludePaths);
  const rootStat = await lstat(root);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw new Error('Plugin tree root must be a real directory');
  const entries: string[] = [];
  async function walk(dir: string): Promise<void> {
    for (const name of (await readdir(dir)).sort()) {
      const path = join(dir, name), entry = relative(root, path);
      if (excluded.has(entry)) continue;
      const stat = await lstat(path);
      if (stat.isSymbolicLink()) throw new Error(`Plugin tree symlink refused: ${path}`);
      if (stat.isDirectory()) await walk(path);
      else if (stat.isFile()) entries.push(`${entry}\0${stat.mode & 0o111 ? '100755' : '100644'}\0${sha256(await readFile(path))}`);
      else throw new Error(`Non-file in plugin tree: ${path}`);
    }
  }
  await walk(root);
  if (!entries.length) throw new Error('Empty plugin tree');
  return sha256(entries.join('\n'));
}
export async function retainedFile(root: string, path: string): Promise<{ path: string; sha256: string }> {
  const output = await realpath(root);
  const actual = await realpath(isAbsolute(path) ? path : join(output, path));
  const state = await realpath(join(output, 'state')).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
    return join(output, 'state');
  });
  if (!actual.startsWith(output + '/') || actual === state || actual.startsWith(state + '/')) throw new Error('Evidence must be retained outside isolated state, within output');
  const stat = await lstat(actual);
  if (!stat.isFile() || !stat.size) throw new Error('Evidence file must be a nonempty regular file');
  const bytes = await readFile(actual);
  if ([...secrets].some(secret => bytes.includes(Buffer.from(secret))) || redact(bytes.toString('latin1')) !== bytes.toString('latin1')) {
    await unlink(actual);
    throw new Error('Evidence contains credentials; contaminated external file removed');
  }
  return { path: relative(output, actual), sha256: sha256(bytes) };
}

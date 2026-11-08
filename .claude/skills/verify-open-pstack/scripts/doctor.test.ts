import { afterEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, readlink, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { doctor, LoginRequired } from './doctor.ts';
import { command, type Command } from './io.ts';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pstack-doctor-'))); roots.push(root);
  return root;
}
const capability = (args: string[]): string | undefined => args.includes('--version') ? 'version' : args.includes('--help') ? '--plugin-dir --settings --setting-sources --json local path' : undefined;
async function loggedInCodex(root: string): Promise<void> {
  await mkdir(join(root, 'daily-codex'), { mode: 0o700 }); await writeFile(join(root, 'daily-codex/auth.json'), 'opaque existing login');
  process.env.CODEX_HOME = join(root, 'daily-codex');
}
const codexHome = process.env.CODEX_HOME;
afterEach(() => { if (codexHome === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = codexHome; });
test('candidate doctor is capabilities-only', async () => {
  const root = await fixture(), calls: string[][] = [];
  const run: Command = async args => {
    calls.push(args);
    const output = capability(args); if (output !== undefined) return output;
    throw new Error(`Unexpected command: ${args.join(' ')}`);
  };
  await doctor(root, run, 'darwin', true);
  expect(calls.every(args => args.includes('--version') || args.includes('--help'))).toBe(true);
  expect(calls.some(args => args.includes('auth') || args.includes('login') || args.includes('status'))).toBe(false);
  expect(calls.some(args => args[0] === 'gh')).toBe(false);
  expect(JSON.parse(await readFile(join(root, 'doctor.json'), 'utf8')).result).toBe('pass');
});
test('parent doctor records both harness login checks from CLI output only', async () => {
  const root = await fixture(), calls: string[][] = []; await loggedInCodex(root);
  const run: Command = async (args, options) => {
    calls.push(args);
    if (args.join(' ') === 'codex login status') { expect(await readlink(join(options!.env!.CODEX_HOME!, 'auth.json'))).toBe(join(root, 'daily-codex/auth.json')); return ''; }
    if (args.join(' ') === 'claude auth status') { expect(options!.env!.HOME).toBe(process.env.HOME!); return '{"loggedIn": true, "email": "operator@example.com"}'; }
    return capability(args)!;
  };
  await doctor(root, run, 'darwin');
  const text = await readFile(join(root, 'doctor.json'), 'utf8'), report = JSON.parse(text);
  expect(report.result).toBe('pass'); expect(calls.some(args => args[0] === 'gh')).toBe(true);
  expect(report.checks['claude login']).toBe('logged in'); expect(text).not.toContain('operator@example.com'); expect(report.checks['codex login']).toBe('logged in');
  await expect(stat(join(root, 'probe-home/.codex'))).rejects.toThrow('ENOENT');
  expect(await readFile(join(root, 'daily-codex/auth.json'), 'utf8')).toBe('opaque existing login');
});
// A logged-out `claude auth status` prints {"loggedIn": false} and exits 1, so the real command() rejects.
const loggedOut = () => command([process.execPath, '-e', 'console.log(JSON.stringify({ loggedIn: false })); process.exit(1)']);
const CLAUDE_FAILED = 'Claude login check failed: `claude auth status` did not report "loggedIn": true; run `claude auth login` from a shell on this Mac, not over SSH';
test.each([
  ['claude', 'logged out', CLAUDE_FAILED],
  ['claude', 'loggedIn false with exit 0', CLAUDE_FAILED],
  ['claude', 'malformed output', CLAUDE_FAILED],
  ['codex', 'nonzero exit', 'run `codex login` on this Mac'],
] as const)('parent doctor blocks %s on %s with the fix', async (harness, failure, message) => {
  const root = await fixture(); await loggedInCodex(root);
  const run: Command = async args => {
    if (args.join(' ') === 'claude auth status') {
      if (harness === 'claude' && failure === 'logged out') return loggedOut();
      return harness === 'claude' ? failure === 'malformed output' ? 'Logged in' : '{"loggedIn": false}' : '{"loggedIn": true}';
    }
    if (args.join(' ') === 'codex login status') throw new Error('codex failed: Not logged in');
    return capability(args)!;
  };
  const checked = doctor(root, run, 'darwin', false, [harness]);
  await expect(checked).rejects.toThrow(message); await expect(checked).rejects.toBeInstanceOf(LoginRequired);
  const report = JSON.parse(await readFile(join(root, 'doctor.json'), 'utf8'));
  expect(report.result).toBe('blocked'); expect(report.reason).toContain(message);
  await expect(stat(join(root, harness === 'codex' ? 'probe-home/.codex' : 'probe-home/.codex/auth.json'))).rejects.toThrow('ENOENT');
  expect(await readFile(join(root, 'daily-codex/auth.json'), 'utf8')).toBe('opaque existing login');
});
test('doctor records blocked capability checks', async () => {
  const root = await fixture();
  await expect(doctor(root, async () => { throw new Error('Missing binary'); }, 'darwin')).rejects.toThrow('Missing binary');
  expect(JSON.parse(await readFile(join(root, 'doctor.json'), 'utf8')).result).toBe('blocked');
});
test('doctor refuses non-Mac live verification before commands', async () => {
  const root = await fixture(), calls: string[][] = [];
  await expect(doctor(root, async args => { calls.push(args); return ''; }, 'linux')).rejects.toThrow('operator Mac');
  expect(calls).toEqual([]);
});
test('parent doctor checks Grok only when a grok feature is named, from CLI output only', async () => {
  const root = await fixture(), calls: string[][] = [];
  const run: Command = async args => {
    calls.push(args);
    if (args.join(' ') === 'grok models') return 'You are logged in with grok.com.\n\nAvailable models:\n  * grok-4.7 (default)\n';
    if (args.join(' ') === 'grok agent --help') return '--plugin-dir --no-leader --model --reasoning-effort';
    if (args.join(' ') === 'claude auth status') return '{"loggedIn": true}';
    return capability(args)!;
  };
  await doctor(root, run, 'darwin', false, ['claude']);
  expect(calls.some(args => args[0] === 'grok')).toBe(false);
  await rm(join(root, 'doctor.json'));
  await doctor(root, run, 'darwin', false, ['grok']);
  const report = JSON.parse(await readFile(join(root, 'doctor.json'), 'utf8'));
  expect(report.checks['grok login']).toBe('logged in');
  expect(calls.filter(args => args[0] === 'grok').map(args => args.join(' '))).toEqual(['grok --version', 'grok agent --help', 'grok models']);
  await expect(doctor(await fixture(), async args => args.join(' ') === 'grok models' ? 'Not logged in' : run(args), 'darwin', false, ['grok'])).rejects.toBeInstanceOf(LoginRequired);
  await expect(doctor(await fixture(), async args => args.join(' ') === 'grok agent --help' ? '--model' : run(args), 'darwin', false, ['grok'])).rejects.toThrow('Grok agent missing --plugin-dir');
});

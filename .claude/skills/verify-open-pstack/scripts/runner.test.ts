import { afterEach, expect, test } from 'bun:test';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { recipe, type Fixture } from '../features/recipes.ts';
import { command } from './io.ts';
import type { SessionRecord } from './types.ts';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

const FAKE_CLAUDE = `#!/usr/bin/env bun
if (process.argv[2] === 'auth') { console.log(JSON.stringify({ loggedIn: true })); process.exit(0); }
await Bun.write('WRITTEN.md', 'PONG\\n');
console.log(JSON.stringify({ result: 'DONE', modelUsage: { 'claude-opus-9': {} } }));
`;

async function launch(f: Fixture, prompt: string): Promise<string> {
  const args = /wait for it to exit: (--parent .*?)\. Work only inside/.exec(prompt)![1]!.split(' ');
  const bin = join(f.dir, 'bin');
  await mkdir(bin);
  await writeFile(join(bin, 'claude'), FAKE_CLAUDE); await chmod(join(bin, 'claude'), 0o755);
  const launcher = join(f.location, 'skills/poteto-mode/scripts/runner/pstack-runner');
  const child = Bun.spawn([launcher, ...args], { env: { ...process.env, PATH: `${bin}:${process.env.PATH}` }, stdout: 'pipe', stderr: 'pipe' });
  const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  expect(code, stderr).toBe(0);
  return `${launcher} ${args.join(' ')}`;
}

test('the runner recipe adds one linked-worktree writer case for a Codex parent only', async () => {
  expect(recipe('runner', 'claude').map(c => c.id)).toEqual(['route-1', 'full-access-writer', 'bounded-writer']);
  expect(recipe('runner', 'codex').map(c => c.id)).toEqual(['route-1', 'linked-worktree-writer']);
  expect(recipe('writers', 'claude').map(c => c.id))
    .toEqual(['devin-writer', 'dsh-writer', 'opencode-writer', 'agy-writer', 'cursor-writer', 'muse-writer', 'muse-reader']);

  const dir = await realpath(await mkdtemp(join(tmpdir(), 'pstack-runner-recipe-'))); roots.push(dir);
  const workspace = resolve(import.meta.dir, '../../../..');
  const f: Fixture = { harness: 'codex', dir, workspace, location: join(workspace, 'plugins/pstack'), configHome: dir, run: command };
  const writer = recipe('runner', 'codex')[1]!;
  await writer.prepare!(f);
  const record: SessionRecord = { harness: 'codex', exitCode: 0, started: Date.now() - 1000, skills: ['pstack:poteto-mode'], tools: [],
    commands: [await launch(f, writer.prompt(f))], context: [] };

  expect((await writer.assert(record, f)).assertions).toEqual(['runner-ran', 'receipt-complete', 'shared-git-denied', 'file:WRITTEN.md']);

  const path = join(dir, 'writer.receipt.json'), receipt = JSON.parse(await readFile(path, 'utf8'));
  const settings = receipt.argv.indexOf('--settings');
  await writeFile(path, JSON.stringify({ ...receipt, argv: [...receipt.argv.slice(0, settings), ...receipt.argv.slice(settings + 2)] }));
  await expect(writer.assert(record, f)).rejects.toThrow('shared-git-not-denied');
});

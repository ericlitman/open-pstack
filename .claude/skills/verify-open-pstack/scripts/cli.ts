import { readFile } from 'node:fs/promises';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { validateRegistry } from './core.ts';
import { doctor } from './doctor.ts';
import { Publisher } from './github.ts';
import { MacDriver } from './harness.ts';
import { freshRoot, interruption, interruptCommands, redact, save } from './io.ts';
import { verify } from './verify.ts';
import { sourceDigest, sourceHash } from './provenance.ts';
import type { GitHub } from './types.ts';

export function publisherCode(repository: string): string {
  const hash = createHash('sha256');
  const scripts = join(repository, '.claude/skills/verify-open-pstack/scripts');
  for (const name of readdirSync(scripts).sort()) {
    if (!name.endsWith('.ts')) continue;
    const path = join(scripts, name), stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Publisher module must be a regular file');
    hash.update(name + '\0').update(readFileSync(path)).update('\0');
  }
  return hash.digest('hex');
}
// Capture loaded module provenance synchronously, before main yields to freshRoot or GitHub.
const loadedCode = publisherCode(resolve(import.meta.dir, '../../../..'));

export async function bindPublisher(repository: string, pr: number, github: GitHub, startupCode = loadedCode): Promise<GitHub> {
  const loadedSource = await sourceDigest(repository);
  const pull = await github.pull(pr);
  const pinnedSource = await sourceHash(repository, pull.head.sha);
  if (pinnedSource !== loadedSource || publisherCode(repository) !== startupCode) throw new Error('Publisher source changed while binding the pinned head');
  const recheck = async (): Promise<void> => {
    if (await sourceHash(repository, pull.head.sha) !== pinnedSource) throw new Error('Publisher source changed after pinning');
  };
  const checkPr = (number: number): void => {
    if (number !== pr) throw new Error('Publisher is bound to one PR');
  };
  return {
    pull: number => { checkPr(number); return github.pull(number); },
    async files(base, head) {
      if (base !== pull.base.sha || head !== pull.head.sha) throw new Error('Publisher pin differs from classification SHAs');
      await recheck(); return github.files(base, head);
    },
    async comment(number, body) { checkPr(number); await recheck(); return github.comment(number, body); },
    async status(sha, state, target, description) {
      if (sha !== pull.head.sha) throw new Error('Publisher status differs from pinned SHA');
      // Failure compensation must remain possible even after source changes or interruption.
      if (state === 'success') await recheck();
      await github.status(sha, state, target, description);
    },
    async ready(number) { checkPr(number); await recheck(); await github.ready(number); },
  };
}
type Options = { mode: 'doctor'; output: string; pr: number; selfTest: boolean; candidate: boolean }
  | { mode: 'run'; output: string; pr: number; selfTest: boolean; claudeAccount: string; codexAccount: string };
export function parse(args: string[]): Options {
  const mode = args[0];
  if (mode !== 'doctor' && mode !== 'run') throw new Error('Usage: verify.sh doctor [--candidate] --output /fresh/path | run --pr NUMBER --claude-account EMAIL --codex-account EMAIL [--self-test] --output /fresh/path');
  let output = '', pr = 0, selfTest = false, candidate = false, claudeAccount = '', codexAccount = '';
  const seen = new Set<string>();
  for (let i = 1; i < args.length; i++) {
    const arg = args[i]!;
    if (seen.has(arg)) throw new Error(`Duplicate option: ${arg}`); seen.add(arg);
    if (arg === '--self-test' && mode === 'run') selfTest = true;
    else if (arg === '--candidate' && mode === 'doctor') candidate = true;
    else if (arg === '--output' || mode === 'run' && ['--pr', '--claude-account', '--codex-account'].includes(arg)) {
      const value = args[++i]; if (!value || value.startsWith('--')) throw new Error(`Missing value: ${arg}`);
      if (arg === '--output') output = value;
      else if (arg === '--pr') { if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error('PR must be a positive integer'); pr = Number(value); }
      else {
        if (value.length > 254 || value.split('@')[0]!.length > 64 || value.includes('..') || !/^[A-Za-z0-9][A-Za-z0-9._+-]*@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/.test(value)) throw new Error(`Account must be a safe email: ${arg}`);
        if (arg === '--claude-account') claudeAccount = value; else codexAccount = value;
      }
    } else throw new Error(`Unknown option: ${arg}`);
  }
  if (!output || mode === 'run' && !pr) throw new Error('Output and (for run) PR are required');
  if (mode === 'run') {
    if (!claudeAccount || !codexAccount) throw new Error('Run requires --claude-account and --codex-account');
    return { mode, output, pr, selfTest, claudeAccount, codexAccount };
  }
  return { mode, output, pr, selfTest, candidate };
}
async function main(): Promise<void> {
  let root: string | undefined, interrupted: 'SIGINT' | 'SIGTERM' | undefined;
  const onInterrupt = (signal: 'SIGINT' | 'SIGTERM'): void => {
    interrupted ??= signal;
    process.exitCode = interrupted === 'SIGINT' ? 130 : 143;
    void interruptCommands(signal).catch(error => {
      console.error(redact(String(error))); process.exitCode = 1;
    });
  };
  const onInt = (): void => onInterrupt('SIGINT'), onTerm = (): void => onInterrupt('SIGTERM');
  process.on('SIGINT', onInt); process.on('SIGTERM', onTerm);
  try {
    const options = parse(process.argv.slice(2)), repository = resolve(import.meta.dir, '../../../..');
    root = await freshRoot(options.output, repository);
    if (options.mode === 'doctor') await doctor(root, undefined, undefined, options.candidate);
    else {
      const github = await bindPublisher(repository, options.pr, new Publisher());
      const registry = validateRegistry(JSON.parse(await readFile(join(import.meta.dir, '../features/registry.json'), 'utf8')));
      const receipt = await verify({ pr: options.pr, selfTest: options.selfTest, root, registry, github, driver: new MacDriver(undefined, undefined, { claude: options.claudeAccount, codex: options.codexAccount }), persist: r => save(join(root!, 'receipt.json'), r) });
      console.log(`Pinned ${receipt.sha}: live-gate=${receipt.status}; evidence ${receipt.commentUrl}`);
    }
    interruption.signal.throwIfAborted();
    console.log(`Retained evidence: ${root}`);
  } catch (error) {
    const failure = redact(error instanceof Error ? error.message : String(error));
    if (root) await save(join(root, 'failure.json'), { result: 'failed', reason: failure });
    console.error(failure); process.exitCode = interrupted === 'SIGINT' ? 130 : interrupted === 'SIGTERM' ? 143 : 1;
  } finally {
    process.off('SIGINT', onInt); process.off('SIGTERM', onTerm);
  }
}
if (import.meta.main) await main();

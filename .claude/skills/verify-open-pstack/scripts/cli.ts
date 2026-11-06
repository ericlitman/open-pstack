import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { ROUTE } from '../features/recipes.ts';
import { validateRegistry } from './core.ts';
import { doctor, LoginRequired } from './doctor.ts';
import { Publisher } from './github.ts';
import { MacDriver } from './harness.ts';
import { command, freshRoot, interruption, interruptCommands, save, session } from './io.ts';
import { publishable, Refused, verify } from './verify.ts';
type Options = { mode: 'doctor'; output: string; pr: number; selfTest: boolean; candidate: boolean }
  | { mode: 'run'; output: string; pr: number; selfTest: boolean; routes: string[]; features: string[]; wide?: string };
export function parse(args: string[]): Options {
  const mode = args[0];
  if (mode !== 'doctor' && mode !== 'run') throw new Error('Usage: verify.sh doctor [--candidate] --output /fresh/path | run --pr NUMBER --feature HARNESS:FEATURE... [--self-test] [--runner-route PROVIDER:MODEL@EFFORT]... [--wide REASON] --output /fresh/path');
  let output = '', pr = 0, selfTest = false, candidate = false, wide: string | undefined;
  const seen = new Set<string>(), routes: string[] = [], features: string[] = [];
  for (let i = 1; i < args.length; i++) {
    const arg = args[i]!;
    if (arg !== '--runner-route' && arg !== '--feature') { if (seen.has(arg)) throw new Error(`Duplicate option: ${arg}`); seen.add(arg); }
    if (arg === '--self-test' && mode === 'run') selfTest = true;
    else if (arg === '--candidate' && mode === 'doctor') candidate = true;
    else if (arg === '--output' || mode === 'run' && (arg === '--pr' || arg === '--runner-route' || arg === '--feature' || arg === '--wide')) {
      const value = args[++i]; if (!value || value.startsWith('--')) throw new Error(`Missing value: ${arg}`);
      if (arg === '--output') output = value;
      else if (arg === '--runner-route') {
        if (!ROUTE.test(value) || routes.includes(value)) throw new Error('Runner route must be a distinct PROVIDER:MODEL@EFFORT');
        routes.push(value);
      } else if (arg === '--feature') {
        if (!/^(claude|codex|t3):[a-z][a-z0-9:-]+$/.test(value) || features.includes(value)) throw new Error('Feature must be a distinct HARNESS:FEATURE, such as claude:agent-preload:poteto-agent');
        features.push(value);
      } else if (arg === '--wide') {
        if (!value.trim() || !publishable(value)) throw new Error('Wide reason must be nonblank printable ASCII, at most 160 characters, without backticks or angle brackets');
        wide = value;
      } else { if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error('PR must be a positive integer'); pr = Number(value); }
    } else throw new Error(`Unknown option: ${arg}`);
  }
  if (!output || mode === 'run' && !pr) throw new Error('Output and (for run) PR are required');
  if (mode === 'run') return { mode, output, pr, selfTest, routes, features, ...(wide ? { wide } : {}) };
  return { mode, output, pr, selfTest, candidate };
}
async function main(): Promise<void> {
  let root: string | undefined, interrupted: 'SIGINT' | 'SIGTERM' | undefined;
  const onInterrupt = (signal: 'SIGINT' | 'SIGTERM'): void => {
    interrupted ??= signal;
    process.exitCode = interrupted === 'SIGINT' ? 130 : 143;
    void interruptCommands(signal).catch(() => {
      console.error('Failed to stop active verifier commands; inspect retained evidence.'); process.exitCode = 1;
    });
  };
  const onInt = (): void => onInterrupt('SIGINT'), onTerm = (): void => onInterrupt('SIGTERM');
  process.on('SIGINT', onInt); process.on('SIGTERM', onTerm);
  try {
    const options = parse(process.argv.slice(2)), repository = resolve(import.meta.dir, '../../../..');
    root = await freshRoot(options.output, repository);
    if (options.mode === 'doctor') await doctor(root, undefined, undefined, options.candidate);
    else {
      const publisherRevision = (await command(['git', 'rev-parse', 'HEAD'], { cwd: repository })).trim();
      const registry = validateRegistry(JSON.parse(await readFile(join(import.meta.dir, '../features/registry.json'), 'utf8')));
      const receipt = await verify({ pr: options.pr, selfTest: options.selfTest, features: options.features, routes: options.routes, wide: options.wide, root, registry, github: new Publisher(), driver: new MacDriver(command, session, options.routes), persist: r => save(join(root!, 'receipt.json'), r), publisherRevision });
      console.log(`Pinned ${receipt.sha}: live-gate=${receipt.status}; evidence ${receipt.commentUrl}`);
    }
    interruption.signal.throwIfAborted();
    console.log(`Retained evidence: ${root}`);
  } catch (error) {
    const failure = error instanceof Error ? error.message : String(error);
    if (root) await save(join(root, 'failure.json'), { result: 'failed', reason: failure });
    if (error instanceof LoginRequired || error instanceof Refused) console.error(failure);
    console.error(root ? 'Verification failed; inspect retained failure.json.' : 'Verification failed before evidence could be retained.');
    process.exitCode = interrupted === 'SIGINT' ? 130 : interrupted === 'SIGTERM' ? 143 : 1;
  } finally {
    process.off('SIGINT', onInt); process.off('SIGTERM', onTerm);
  }
}
if (import.meta.main) await main();

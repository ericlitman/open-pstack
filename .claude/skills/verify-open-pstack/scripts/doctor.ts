import { mkdir, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { command, isolatedEnv, save, type Command } from './io.ts';

export async function doctor(root: string, run: Command = command, platform = process.platform, candidate = false): Promise<void> {
  const report: Record<string, unknown> = { platform, candidate, date: new Date().toISOString(), skill: await realpath(join(import.meta.dir, '..')), checks: {} };
  const checks = report.checks as Record<string, string>;
  try {
    if (platform !== 'darwin') throw new Error('Live gate requires an operator Mac (Darwin)');
    const home = join(root, 'probe-home');
    for (const dir of ['tmp', '.claude', '.codex', '.config/gh', '.cache']) await mkdir(join(home, dir), { recursive: true, mode: 0o700 });
    const env = isolatedEnv(home);
    for (const binary of candidate ? ['bun', 'git', 'claude', 'codex'] : ['bun', 'git', 'claude', 'codex', 'gh']) checks[binary] = (await run([binary, '--version'], { env })).trim();
    const claude = await run(['claude', '--help'], { env });
    for (const flag of ['--plugin-dir', '--settings', '--setting-sources']) if (!claude.includes(flag)) throw new Error(`Claude isolation missing ${flag}`);
    checks.claudeHelp = claude;
    for (const args of [['codex', 'plugin', 'marketplace', 'add', '--help'], ['codex', 'plugin', 'add', '--help']]) {
      const help = await run(args, { env });
      if (!help.includes('--json')) throw new Error('Codex local plugin installation interface unavailable');
      if (args.includes('marketplace') && !/local path|local or Git|local marketplace/i.test(help)) throw new Error('Codex local marketplace interface unavailable');
      checks[args.join(' ')] = help;
    }
    // PR resolution checks publisher authentication; a child surface doctor has no GitHub credentials.
    report.result = 'pass';
  } catch (error) {
    report.result = 'blocked'; report.reason = String(error);
    throw error;
  } finally { await save(join(root, 'doctor.json'), report); }
}

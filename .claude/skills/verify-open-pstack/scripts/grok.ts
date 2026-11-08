import { existsSync } from 'node:fs';
import { copyFile, open, readdir, realpath } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { track, treeHash } from './io.ts';
import type { SessionRecord } from './types.ts';

export const GROK_PARENT = { model: 'grok-4.7', effort: 'low' } as const;
export const GROK_TOOLS = ['read_file', 'list_dir', 'grep', 'write', 'search_replace', 'todo_write', 'run_terminal_command', 'spawn_subagent', 'get_command_or_subagent_output'];
export const GROK_NATIVE_FILES = ['summary.json', 'tool_definitions.json', 'chat_history.jsonl'] as const;
const DEPENDENCIES = ['skills/poteto-mode/scripts/node_modules'];

type Message = Record<string, any>;

export function grokLaunch(location: string): string[] {
  return ['grok', 'agent', '--no-leader', '--plugin-dir', location, '--model', GROK_PARENT.model, '--reasoning-effort', GROK_PARENT.effort, 'stdio'];
}

export function permissionAnswer(params: Message, allowed: readonly string[]): string {
  const name = params.toolCall?._meta?.['x.ai/tool']?.name;
  const kind = allowed.includes(name) ? 'allow_once' : 'reject_once';
  const option = (params.options as Message[] | undefined)?.find(o => o.kind === kind);
  if (!option) throw new Error(`grok-permission-option-missing:${kind}`);
  return option.optionId;
}

export async function candidatePlugin(listed: Message, location: string, expected: string): Promise<void> {
  const plugins = (listed.result?.plugins ?? []) as Message[], pstack = plugins.filter(p => p.name === 'pstack');
  if (pstack.length !== 1 || pstack[0]!.enabled !== true || typeof pstack[0]!.root !== 'string' || await realpath(pstack[0]!.root) !== await realpath(location)) {
    throw new Error('grok-candidate-not-loaded: the --plugin-dir candidate did not win the pstack name clash');
  }
  if (await treeHash(pstack[0]!.root, DEPENDENCIES) !== expected) throw new Error('grok-candidate-tree-mismatch');
}

export function parentServed(summary: Message): void {
  if (summary.current_model_id !== GROK_PARENT.model || summary.reasoning_effort !== GROK_PARENT.effort) {
    throw new Error(`grok-parent-model-mismatch:${summary.current_model_id}@${summary.reasoning_effort}`);
  }
}

type Options = { location: string; tree: string; cwd: string; env: Record<string, string>; prompt: string; transcript: string; stderr: string; prefix: string };

export async function grokSession(options: Options): Promise<{ exitCode: number; files: string[] }> {
  const transcript = await open(options.transcript, 'wx', 0o600), stderr = await open(options.stderr, 'wx', 0o600);
  const child = Bun.spawn(grokLaunch(options.location), { cwd: options.cwd, env: options.env, detached: true, stdin: 'pipe', stdout: 'pipe', stderr: stderr.fd });
  const untrack = track(child.pid, child.exited);
  const pending = new Map<number, { resolve: (message: Message) => void; reject: (error: Error) => void }>();
  let next = 0;
  const send = async (message: Message): Promise<void> => {
    await transcript.write(JSON.stringify({ from: 'client', message }) + '\n');
    child.stdin.write(JSON.stringify(message) + '\n');
    await child.stdin.flush();
  };
  const request = (method: string, params: Message): Promise<Message> => new Promise((resolve, reject) => {
    const id = ++next;
    pending.set(id, { resolve: message => message.error ? reject(new Error(`grok-acp:${method}:${message.error.message}`)) : resolve(message.result), reject });
    send({ jsonrpc: '2.0', id, method, params }).catch(reject);
  });
  const reader = (async () => {
    let buffer = '';
    for await (const chunk of child.stdout) {
      buffer += Buffer.from(chunk).toString('utf8');
      for (let end = buffer.indexOf('\n'); end >= 0; end = buffer.indexOf('\n')) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        if (!line.trim()) continue;
        const message = JSON.parse(line) as Message;
        await transcript.write(JSON.stringify({ from: 'agent', message }) + '\n');
        if (message.method === undefined) { pending.get(message.id)?.resolve(message); pending.delete(message.id); }
        else if (message.id !== undefined && message.method === 'session/request_permission') {
          await send({ jsonrpc: '2.0', id: message.id, result: { outcome: { outcome: 'selected', optionId: permissionAnswer(message.params, GROK_TOOLS) } } });
        } else if (message.id !== undefined) await send({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Method not found' } });
      }
    }
  })().catch((error: unknown) => error).then(error => {
    for (const { reject } of pending.values()) reject(error instanceof Error ? error : new Error('grok-exited-before-response'));
    pending.clear();
  });
  const files: string[] = [];
  try {
    await request('initialize', { protocolVersion: 1, clientCapabilities: {} });
    const { sessionId } = await request('session/new', { cwd: options.cwd, mcpServers: [] });
    if (typeof sessionId !== 'string' || !/^[0-9a-f-]{36}$/.test(sessionId)) throw new Error('grok-session-id-missing');
    const listed = await request('_x.ai/plugins/list', { sessionId }), plugins = `${options.prefix}.plugins.json`;
    await Bun.write(plugins, JSON.stringify(listed, null, 2));
    files.push(plugins);
    await candidatePlugin(listed, options.location, options.tree);
    const turn = await request('session/prompt', { sessionId, prompt: [{ type: 'text', text: options.prompt }] });
    if (turn.stopReason !== 'end_turn') throw new Error(`grok-stop-reason:${turn.stopReason}`);
    child.stdin.end();
    const exitCode = await child.exited;
    await reader;
    const sessions = join(options.env.GROK_HOME ?? join(options.env.HOME!, '.grok'), 'sessions');
    const folder = (await readdir(sessions)).find(cwd => existsSync(join(sessions, cwd, sessionId, 'summary.json')));
    if (!folder) throw new Error('grok-session-record-missing');
    const record = join(sessions, folder, sessionId);
    for (const name of GROK_NATIVE_FILES) {
      const copy = `${options.prefix}.${name}`;
      await copyFile(join(record, name), copy);
      files.push(copy);
    }
    parentServed(JSON.parse(await Bun.file(`${options.prefix}.summary.json`).text()));
    return { exitCode, files };
  } finally {
    if (child.exitCode === null) {
      try { process.kill(-child.pid, 'SIGTERM'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
      await child.exited;
    }
    await reader;
    untrack();
    await transcript.close(); await stderr.close();
  }
}

export function referencedSkills(chatHistory: string): string[] {
  return chatHistory.split('\n').filter(line => line.trim()).map(line => JSON.parse(line) as Message)
    .filter(entry => entry.type === 'user' && Array.isArray(entry.content))
    .flatMap(entry => entry.content.map((part: Message) => typeof part.text === 'string' ? part.text : '').join('\n')
      .match(/<skills_referenced>[\s\S]*?<\/skills_referenced>/g) ?? [])
    .flatMap(block => [...block.matchAll(/<skill name="[^"]+" path="([^"]+)"\/>/g)].map(match => dirname(resolve(match[1]!))));
}

export function parseGrok(text: string, exitCode: number, started: number, toolDefinitions: string, chatHistory: string): SessionRecord {
  if (exitCode !== 0) throw new Error(`exit:${exitCode}`);
  const lines = text.split('\n').filter(line => line.trim()).map(line => JSON.parse(line) as { from: 'agent' | 'client'; message: Message });
  const agent = lines.filter(l => l.from === 'agent').map(l => l.message), client = lines.filter(l => l.from === 'client').map(l => l.message);
  const opened = client.find(m => m.method === 'session/new')?.id;
  const main = agent.find(m => m.method === undefined && m.id === opened)?.result?.sessionId;
  if (typeof main !== 'string') throw new Error('grok-session-id-missing');
  const asked = new Map(agent.filter(m => m.method === 'session/request_permission').map(m => [m.id, m.params.toolCall?.toolCallId as string]));
  const refused = new Set(client.filter(m => asked.has(m.id) && String(m.result?.outcome?.optionId ?? '').startsWith('reject')).map(m => asked.get(m.id)!));
  const calls = new Map<string, { name: string; input: Message; session: string; status?: string; output?: unknown }>();
  const finished = new Set<string>(), seen = new Set<string>();
  for (const { method, params } of agent) {
    const update = params?.update, session = params?.sessionId;
    if (method === '_x.ai/session_notification' && update?.sessionUpdate === 'turn_completed') finished.add(session);
    if (method !== 'session/update') continue;
    seen.add(session);
    if (update?.sessionUpdate === 'tool_call') {
      calls.set(update.toolCallId, { name: update._meta?.['x.ai/tool']?.name ?? update.title, input: update.rawInput ?? {}, session, status: update.status ?? undefined });
    } else if (update?.sessionUpdate === 'tool_call_update') {
      const call = calls.get(update.toolCallId);
      if (!call) continue;
      if (update.status) call.status = update.status;
      if (update.rawOutput != null) call.output = update.rawOutput;
    }
  }
  for (const [id, call] of calls) if (call.status !== 'completed' && call.status !== 'failed' && !refused.has(id)) throw new Error(`grok-tool-pending:${call.name}`);
  for (const session of seen) if (session !== main && !finished.has(session)) throw new Error('grok-children-pending');
  const spawned = new Map([...calls].flatMap(([id, call]) => {
    const child = (call.output as Message | undefined)?.subagent_id;
    return call.name === 'spawn_subagent' && typeof child === 'string' ? [[child, id] as const] : [];
  }));
  const tools = [...calls].map(([id, call]) => ({ name: call.name, id, input: call.input, failed: call.status === 'failed' || refused.has(id),
    parent: call.session === main ? null : spawned.get(call.session) ?? call.session,
    result: call.output === undefined ? undefined : typeof call.output === 'string' ? call.output : JSON.stringify(call.output) }));
  const skills = [...calls.values()].filter(call => call.session === main && call.name === 'read_file' && call.status === 'completed' &&
    typeof call.input.target_file === 'string' && call.input.target_file.endsWith('/SKILL.md'))
    .map(call => dirname((call.output as Message | undefined)?.FileContent?.absolute_path ?? call.input.target_file))
    .concat(referencedSkills(chatHistory));
  const definitions = JSON.parse(toolDefinitions) as Message[];
  const agents = definitions.find(d => d.function?.name === 'spawn_subagent')?.function.parameters?.properties?.subagent_type?.enum;
  return { harness: 'grok', exitCode, started, skills, context: [], agents: Array.isArray(agents) ? agents : [],
    commands: tools.filter(t => t.name === 'run_terminal_command' && !t.failed && typeof t.input.command === 'string').map(t => t.input.command as string), tools };
}

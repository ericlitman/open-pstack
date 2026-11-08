import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { grokAgents, grokReceipt } from '../features/recipes.ts';
import { candidatePlugin, grokLaunch, parentServed, parseGrok, permissionAnswer } from './grok.ts';
import { treeHash } from './io.ts';

const MAIN = '01a1bc71-6890-7753-8fe5-126e7a38df5c', CHILD = '01a1bc71-7514-7380-a5ac-8381a8802b0c';
const agent = (message: Record<string, unknown>) => JSON.stringify({ from: 'agent', message });
const client = (message: Record<string, unknown>) => JSON.stringify({ from: 'client', message });
const update = (sessionId: string, value: Record<string, unknown>) => agent({ method: 'session/update', params: { sessionId, update: value } });
const call = (sessionId: string, toolCallId: string, name: string, rawInput: Record<string, unknown>) =>
  update(sessionId, { sessionUpdate: 'tool_call', toolCallId, title: name, rawInput, _meta: { 'x.ai/tool': { name } } });
const done = (sessionId: string, toolCallId: string, rawOutput: unknown, status = 'completed') => update(sessionId, { sessionUpdate: 'tool_call_update', toolCallId, status, rawOutput });
const turn = (sessionId: string) => agent({ method: '_x.ai/session_notification', params: { sessionId, update: { sessionUpdate: 'turn_completed' } } });
const opened = [client({ jsonrpc: '2.0', id: 2, method: 'session/new', params: {} }), agent({ jsonrpc: '2.0', id: 2, result: { sessionId: MAIN } })];
const DEFINITIONS = JSON.stringify([{ function: { name: 'spawn_subagent', parameters: { properties: { subagent_type: { enum: ['pstack:poteto-agent', 'pstack:comment-sicko'] } } } } }]);

describe('ACP stream parsing', () => {
  const stream = [...opened,
    call(MAIN, 'skill', 'read_file', { target_file: '/candidate/plugins/pstack/skills/poteto-mode/SKILL.md' }),
    done(MAIN, 'skill', { type: 'ReadFile', FileContent: { absolute_path: '/private/candidate/plugins/pstack/skills/poteto-mode/SKILL.md' } }),
    call(MAIN, 'spawn', 'spawn_subagent', { subagent_type: 'pstack:poteto-agent', prompt: 'read' }),
    call(CHILD, 'child-read', 'read_file', { target_file: '/fixture/marker-1.txt' }),
    done(CHILD, 'child-read', { type: 'ReadFile' }), turn(CHILD),
    done(MAIN, 'spawn', { type: 'SubagentCompleted', subagent_id: CHILD, subagent_type: 'pstack:poteto-agent', output: 'marker' }),
    call(MAIN, 'runner', 'run_terminal_command', { command: 'pstack-runner --parent grok' }), done(MAIN, 'runner', { type: 'Bash' }),
    call(MAIN, 'mcp', 'use_tool', { tool_name: 'gmail' }),
    agent({ jsonrpc: '2.0', id: 0, method: 'session/request_permission', params: { toolCall: { toolCallId: 'mcp' } } }),
    client({ jsonrpc: '2.0', id: 0, result: { outcome: { outcome: 'selected', optionId: 'reject-once' } } }),
  ].join('\n');

  test('maps native tool calls, child calls to their spawn call, skill loads and commands', () => {
    const record = parseGrok(stream, 0, 1, DEFINITIONS);
    expect(record.skills).toEqual(['/private/candidate/plugins/pstack/skills/poteto-mode']);
    expect(record.commands).toEqual(['pstack-runner --parent grok']);
    expect(record.agents).toEqual(['pstack:poteto-agent', 'pstack:comment-sicko']);
    expect(record.tools.find(t => t.id === 'child-read')?.parent).toBe('spawn');
    expect(record.tools.find(t => t.id === 'spawn')).toMatchObject({ parent: null, failed: false });
    expect(JSON.parse(record.tools.find(t => t.id === 'spawn')!.result!).output).toBe('marker');
    expect(record.tools.find(t => t.id === 'mcp')?.failed).toBe(true);
  });

  test('a refused or failed skill read does not count as a load', () => {
    const failed = [...opened, call(MAIN, 'skill', 'read_file', { target_file: '/x/SKILL.md' }), done(MAIN, 'skill', null, 'failed')].join('\n');
    expect(parseGrok(failed, 0, 1, DEFINITIONS).skills).toEqual([]);
  });

  test('a turn that ends while a tool call or a child session is still running fails', () => {
    expect(() => parseGrok([...opened, call(MAIN, 'spawn', 'spawn_subagent', {})].join('\n'), 0, 1, DEFINITIONS)).toThrow('grok-tool-pending:spawn_subagent');
    const orphan = [...opened, call(CHILD, 'child-read', 'read_file', {}), done(CHILD, 'child-read', {})].join('\n');
    expect(() => parseGrok(orphan, 0, 1, DEFINITIONS)).toThrow('grok-children-pending');
    expect(() => parseGrok(stream, 3, 1, DEFINITIONS)).toThrow('exit:3');
  });
});

describe('session policy', () => {
  const options = [{ optionId: 'allow-once', kind: 'allow_once' }, { optionId: 'reject-once', kind: 'reject_once' }];
  test('allows only the listed tools and refuses the rest without a prompt', () => {
    expect(permissionAnswer({ toolCall: { _meta: { 'x.ai/tool': { name: 'spawn_subagent' } } }, options }, ['spawn_subagent'])).toBe('allow-once');
    expect(permissionAnswer({ toolCall: { _meta: { 'x.ai/tool': { name: 'use_tool' } } }, options }, ['spawn_subagent'])).toBe('reject-once');
    expect(() => permissionAnswer({ toolCall: {}, options: [] }, [])).toThrow('grok-permission-option-missing');
  });
  test('launches one process-only candidate on the explicit cheap parent model', () => {
    expect(grokLaunch('/c/plugins/pstack')).toEqual(['grok', 'agent', '--no-leader', '--plugin-dir', '/c/plugins/pstack', '--model', 'grok-4.7', '--reasoning-effort', 'low', 'stdio']);
    expect(() => parentServed({ current_model_id: 'grok-4.7', reasoning_effort: 'low' })).not.toThrow();
    expect(() => parentServed({ current_model_id: 'grok-4.7', reasoning_effort: 'high' })).toThrow('grok-parent-model-mismatch');
  });
});

describe('candidate plugin identity', () => {
  const roots: string[] = [];
  afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
  test('requires the one loaded pstack to be the candidate by path and tree hash', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'pstack-grok-'))); roots.push(root);
    const candidate = join(root, 'candidate'), installed = join(root, 'installed');
    for (const dir of [candidate, installed]) { await mkdir(dir); await writeFile(join(dir, 'SKILL.md'), dir); }
    const expected = await treeHash(candidate);
    const listed = (...plugins: Record<string, unknown>[]) => ({ result: { plugins } });
    await candidatePlugin(listed({ name: 'pstack', root: candidate, enabled: true }, { name: 'e2e', root: installed, enabled: true }), candidate, expected);
    await expect(candidatePlugin(listed({ name: 'pstack', root: installed, enabled: true }), candidate, expected)).rejects.toThrow('grok-candidate-not-loaded');
    await expect(candidatePlugin(listed({ name: 'pstack', root: candidate, enabled: true }, { name: 'pstack', root: installed, enabled: true }), candidate, expected)).rejects.toThrow('grok-candidate-not-loaded');
    await expect(candidatePlugin(listed(), candidate, expected)).rejects.toThrow('grok-candidate-not-loaded');
    await writeFile(join(candidate, 'SKILL.md'), 'changed');
    await expect(candidatePlugin(listed({ name: 'pstack', root: candidate, enabled: true }), candidate, expected)).rejects.toThrow('grok-candidate-tree-mismatch');
  });
});

describe('grok:dispatch predicates', () => {
  test('the subagent enum offers the model-free agents and no Claude lane agent', () => {
    expect(grokAgents(['pstack:poteto-agent', 'pstack:comment-sicko', 'e2e:runner'])).toBe('agents:model-free-only');
    expect(() => grokAgents(['pstack:poteto-agent'])).toThrow('grok-model-free-agents-missing');
    expect(() => grokAgents(undefined)).toThrow('grok-model-free-agents-missing');
    expect(() => grokAgents(['pstack:poteto-agent', 'pstack:comment-sicko', 'pstack:pstack-opus-low'])).toThrow('grok-claude-lane-agent-offered:pstack:pstack-opus-low');
  });
  test('a runner lane receipt must be complete, on its route, provider-verified and from this session', () => {
    const lane = { provider: 'grok', model: 'grok-4.7', effort: 'low' };
    const receipt = { status: 'complete', parent: 'grok', ...lane, mode: 'read-only', modelVerified: true, modelEvidence: 'provider-report', outputPath: '/f/out.md', startedAt: '2026-11-08T00:00:01Z' };
    const started = Date.parse('2026-11-08T00:00:00Z');
    expect(() => grokReceipt(receipt, lane, '/f/out.md', started)).not.toThrow();
    expect(() => grokReceipt({ ...receipt, parent: 'claude' }, lane, '/f/out.md', started)).toThrow('receipt-route-mismatch:grok');
    expect(() => grokReceipt({ ...receipt, modelVerified: false, modelEvidence: 'pinned-argv' }, lane, '/f/out.md', started)).toThrow('receipt-model-unverified:grok');
    expect(() => grokReceipt({ ...receipt, status: 'failed' }, lane, '/f/out.md', started)).toThrow('receipt-status:failed');
    expect(() => grokReceipt(receipt, lane, '/f/out.md', started + 5000)).toThrow('receipt-not-this-session:grok');
  });
});

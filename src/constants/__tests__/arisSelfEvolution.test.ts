import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';
import { AUTO_RESEARCH_PACKS } from '../autoResearchPacks';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const infra = join(root, 'skills/aris-infra');
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const json = (path: string) => JSON.parse(read(path));
const skills = ['aris-meta-optimize', 'aris-meta-apply'];
let temp: string;
let project: string;
let home: string;
let env: NodeJS.ProcessEnv;

beforeEach(() => {
  temp = mkdtempSync(join(tmpdir(), 'aris-offline-'));
  project = join(temp, 'research project');
  home = join(temp, 'home');
  mkdirSync(project); mkdirSync(home);
  // No real HOME/config, API keys or CLI binaries are used by these helper tests.
  env = { PATH: process.env.PATH, HOME: home, CLAUDE_PROJECT_DIR: project,
    PYTHONDONTWRITEBYTECODE: '1', ARIS_META_GLOBAL_LOG: '0' };
});
afterEach(() => rmSync(temp, { recursive: true, force: true }));

function run(command: string, args: string[], input = '', extraEnv = {}) {
  const result = spawnSync(command, args, { cwd: project, env: { ...env, ...extraEnv }, input, encoding: 'utf8', timeout: 10000 });
  expect(result.error).toBeUndefined();
  return result;
}
const py = (script: string, args: string[] = []) => run('python3', [join(infra, script), ...args]);
const configure = (...args: string[]) => py('tools/meta_opt/configure.py', ['--project', project, ...args]);
const hook = (payload: unknown, extraEnv = {}) => run('bash', [join(infra, 'tools/meta_opt/log_event.sh')], JSON.stringify(payload), extraEnv);
const ready = () => run('bash', [join(infra, 'tools/meta_opt/check_ready.sh')]);
function records(path = join(project, '.aris/meta/events.jsonl')) {
  return readFileSync(path, 'utf8').trim().split('\n').map(row => JSON.parse(row));
}
function pythonCode(code: string) {
  return run('python3', ['-c', `import sys, pathlib, importlib.util, json\nsys.path.insert(0, ${JSON.stringify(join(infra, 'tools'))})\n${code}`]);
}

describe('ARIS Workflow M registration and bundled contracts', () => {
  it('exposes one producer workflow from the constant used by Hub and both Chat menus', () => {
    const pack = AUTO_RESEARCH_PACKS.find(pack => pack.name === 'ARIS')!;
    expect(pack.skills).toEqual(expect.arrayContaining(skills));
    expect(pack.workflows.filter(w => w.command === '/aris-meta-optimize')).toHaveLength(1);
    expect(pack.workflows.some(w => w.command === '/aris-meta-apply')).toBe(false);
    const workflow = pack.workflows.find(w => w.command === '/aris-meta-optimize')!;
    for (const locale of ['en', 'zh', 'ko'] as const) expect(workflow.description[locale]).toBeTruthy();
    for (const file of ['src/components/AutoResearchHub.tsx', 'src/components/chat/view/subcomponents/AutoResearchDropdown.tsx', 'src/components/chat/view/subcomponents/GuidedPromptStarter.tsx']) {
      expect(read(file)).toMatch(/import.*AUTO_RESEARCH_PACKS.*autoResearchPacks/);
    }
    expect(pack.mcp.find(m => m.key === 'codex')!.register).toContain('aris-infra/mcp-servers/codex-exec/server.py');
    expect(read('skills/aris-infra/setup.sh')).not.toContain('codex mcp-server');
    expect(read('skills/aris-infra/setup.sh')).not.toContain('configure.py');
    expect(read('skills/aris-infra/setup.sh')).not.toMatch(/settings\.json.*>|cp .*settings\.json/);
  });

  it('registers maintenance skills without auto-inserting the applier into a research stage', () => {
    const catalog = json('skills/skills-catalog-v2.json');
    expect(catalog.totalSkills).toBe(catalog.skills.length);
    const map = json('skills/stage-skill-map.json');
    const tags = json('skills/skill-tag-mapping.json');
    for (const name of skills) {
      const entries = catalog.skills.filter((item: {name: string}) => item.name === name);
      expect(entries).toHaveLength(1);
      expect(existsSync(join(root, entries[0].legacy.skillFile))).toBe(true);
      expect(map.skillOrigins[name]).toBe('imported');
      expect(tags.stageOverrides[name]).toBeTruthy();
      for (const stage of ['survey', 'ideation', 'experiment', 'publication', 'promotion']) {
        expect(JSON.stringify(map[stage])).not.toContain(name);
      }
    }
  });

  it('separates frontmatter grants, manual landing, safety gates and license attribution', () => {
    const producer = matter(read('skills/aris-meta-optimize/SKILL.md'));
    const applier = matter(read('skills/aris-meta-apply/SKILL.md'));
    for (const [name, parsed] of [[skills[0], producer], [skills[1], applier]] as const) {
      expect(parsed.data.name).toBe(name);
      expect(parsed.data.description).toBeTruthy();
      expect(parsed.data.license).toBe('MIT');
      expect(parsed.data.metadata['upstream-commit']).toBe('f1bd907b58f653131ebe6807c482e2554e07f9b9');
    }
    expect(producer.data['allowed-tools']).not.toMatch(/\b(Write|Edit|Agent)\b/);
    expect(applier.data['disable-model-invocation']).toBe(true);
    expect(applier.data['allowed-tools']).toMatch(/Write, Edit/);
    expect(producer.content).not.toContain('/aris-meta-optimize apply');
    expect(producer.content).toContain('sandbox: read-only');
    expect(producer.content).toContain('bottleneck_log.jsonl');
    expect(producer.content).toContain('TARGET-SPECIFIC');
    expect(applier.content).toContain('before mutation');
    expect(applier.content).toContain('sandbox: read-only');
    expect(applier.content).toContain('ignore it for the landing decision');
    expect(read('skills/aris-infra/shared-references/reviewer-routing.md')).toContain('Never downgrade/retry on timeout');
    expect(read('skills/aris-infra/LICENSE')).toContain('Copyright (c) 2026 wanshuiyin');
  });

  it('has no broken local Markdown references in Workflow M and its scoped contracts', () => {
    const files = [
      ...skills.map(name => `skills/${name}/SKILL.md`), 'docs/aris-self-evolution.md',
      'skills/aris-infra/UPSTREAM.md', 'skills/aris-infra/mcp-servers/codex-exec/README.md',
      ...readdirSync(join(infra, 'shared-references')).map(name => `skills/aris-infra/shared-references/${name}`),
    ];
    for (const file of files) {
      const content = read(file);
      expect(content).not.toContain('https://aris-arxiv.org');
      for (const match of content.matchAll(/\]\(([^)]+)\)/g)) {
        const target = match[1].split('#')[0];
        if (!target || /^[a-z]+:/i.test(target)) continue;
        expect(existsSync(resolve(root, dirname(file), target)), `${file} → ${target}`).toBe(true);
      }
    }
  });

  it('records all imported assets and retains untouched upstream helper bytes', () => {
    const manifest = json('skills/aris-infra/workflow-m-sources.json');
    expect(manifest.commit).toBe('f1bd907b58f653131ebe6807c482e2554e07f9b9');
    for (const file of manifest.files) {
      expect(existsSync(join(root, file.bundled)), file.bundled).toBe(true);
      if (!file.adapted) expect(createHash('sha256').update(readFileSync(join(root, file.bundled))).digest('hex')).toBe(file.upstreamSha256);
    }
    const scenarios = json('skills/aris-infra/tools/meta_opt/trigger_evals.sample.json');
    for (const name of Object.keys(scenarios).filter(name => !name.startsWith('_'))) {
      expect(existsSync(join(root, 'skills', name, 'SKILL.md'))).toBe(true);
    }
  });

  it('resolves helpers from a downstream project skill link with strict shell flags', () => {
    mkdirSync(join(project, '.claude/skills'), { recursive: true });
    symlinkSync(infra, join(project, '.claude/skills/aris-infra'), 'dir');
    const block = read('skills/aris-infra/shared-references/integration-contract.md').match(/```bash\n([\s\S]*?)```/)![1];
    const result = run('bash', ['-euc', block + '\n[ -f "$PROVENANCE" ] && [ -f "$CAPTURE_FILTER" ] && [ -f "$TRACE_HELPER" ] && [ -f "$TRIGGER_EVAL" ]']);
    expect(result.status, result.stderr).toBe(0);
    expect(readdirSync(home)).toEqual([]);
  });
});

describe('explicit, preserving hook setup', () => {
  it('previews without writes and backs up/merges existing settings idempotently', () => {
    mkdirSync(join(project, '.claude'));
    const original = '{"permissions":{"deny":["Read(secrets)"]},"env":{"KEEP":"yes"},"hooks":{"SessionStart":[{"hooks":[{"type":"command","command":"echo keep"}]}]}}\n';
    const settings = join(project, '.claude/settings.json');
    writeFileSync(settings, original);
    const preview = configure('--logging', '--guard');
    expect(preview.status, preview.stderr).toBe(0);
    expect(preview.stdout).toContain('PREVIEW only');
    expect(readFileSync(settings, 'utf8')).toBe(original);
    expect(readdirSync(join(project, '.claude'))).toEqual(['settings.json']);
    expect(configure('--logging', '--guard', '--apply').status).toBe(0);
    const merged = JSON.parse(readFileSync(settings, 'utf8'));
    expect(merged.permissions.deny).toEqual(['Read(secrets)']);
    expect(merged.env).toEqual({ KEEP: 'yes' });
    expect(merged.hooks.SessionStart[0].hooks[0].command).toBe('echo keep');
    const commands = Object.values(merged.hooks).flatMap((entries: any) => entries.flatMap((entry: any) => entry.hooks.map((hook: any) => hook.command)));
    expect(commands.some((c: any) => c.includes('ARIS_META_GLOBAL_LOG=0'))).toBe(true);
    const backups = readdirSync(join(project, '.claude')).filter(name => name.startsWith('settings.json.aris-backup-'));
    expect(backups).toHaveLength(1);
    expect(readFileSync(join(project, '.claude', backups[0]), 'utf8')).toBe(original);
    expect(configure('--logging', '--guard', '--apply').stdout).toContain('Already configured');
    expect(readdirSync(home)).toEqual([]);
    expect(existsSync(join(project, '.aris'))).toBe(false);
  });

  it('runs generated hooks from a copied bundle with spaces in the path', () => {
    const copiedInfra = join(temp, 'copied infra with spaces');
    cpSync(infra, copiedInfra, { recursive: true });
    const result = run('python3', [join(copiedInfra, 'tools/meta_opt/configure.py'), '--project', project, '--logging', '--apply']);
    expect(result.status, result.stderr).toBe(0);
    const settings = JSON.parse(readFileSync(join(project, '.claude/settings.json'), 'utf8'));
    const command = settings.hooks.SessionStart[0].hooks[0].command;
    const logged = run('bash', ['-c', command], JSON.stringify({ hook_event_name: 'SessionStart', model: 'fixture' }));
    expect(logged.status, logged.stderr).toBe(0);
    expect(records()[0].model).toBe('fixture');
    expect(readdirSync(home)).toEqual([]);
  });

  it('refuses invalid existing settings and symlinked settings without overwriting', () => {
    mkdirSync(join(project, '.claude'));
    const settings = join(project, '.claude/settings.json');
    for (const invalid of ['not json', '{"hooks": []}', '{"hooks":{"SessionStart":{}}}']) {
      writeFileSync(settings, invalid);
      expect(configure('--logging', '--apply').status).not.toBe(0);
      expect(readFileSync(settings, 'utf8')).toBe(invalid);
    }
    rmSync(settings);
    const external = join(home, 'settings.json'); writeFileSync(external, '{}');
    symlinkSync(external, settings);
    expect(configure('--guard', '--apply').status).not.toBe(0);
    expect(readFileSync(external, 'utf8')).toBe('{}');
  });

  it('requires explicit feature selection and refuses global HOME setup', () => {
    expect(configure('--apply').status).not.toBe(0);
    expect(configure('--global-log').status).not.toBe(0);
    expect(py('tools/meta_opt/configure.py', ['--project', home, '--logging', '--apply']).status).not.toBe(0);
    expect(existsSync(join(project, '.claude'))).toBe(false);
  });

  it('ships hook commands whose helper files exist, without any workflow auto-run', () => {
    const logging = json('skills/aris-infra/templates/claude-hooks/meta_logging.json');
    expect(Object.keys(logging.hooks)).toEqual(['PostToolUse', 'PostToolUseFailure', 'UserPromptSubmit', 'SessionStart', 'SessionEnd']);
    for (const name of ['meta_logging', 'corpus_write_guard']) {
      const template = json(`skills/aris-infra/templates/claude-hooks/${name}.json`);
      for (const entries of Object.values(template.hooks) as any[]) for (const entry of entries) for (const hook of entry.hooks) {
        const command = hook.command.replace(/\$\{?CLAUDE_PROJECT_DIR\}?/g, root);
        const file = command.match(/"([^"]+)"/)![1];
        expect(existsSync(file), command).toBe(true);
        expect(command).not.toMatch(/claude -p|aris-meta-apply|aris-meta-optimize/);
      }
    }
  });
});

describe('offline helper behavior in temporary HOME', () => {
  it('logs successful skills, failures, slash commands and models, project-only by default', () => {
    for (const payload of [
      { hook_event_name: 'SessionStart', model: 'claude-opus-4-8', source: 'startup' },
      { hook_event_name: 'PostToolUse', tool_name: 'Skill', tool_input: { skill: 'aris-research-lit', args: 'topic' } },
      { hook_event_name: 'PostToolUseFailure', tool_name: 'Skill', tool_input: { skill: 'aris-research-lit' } },
      { hook_event_name: 'PostToolUseFailure', tool_name: 'mcp__codex__codex', tool_input: { prompt: 'review' } },
      { hook_event_name: 'UserPromptSubmit', prompt: '/aris-meta-optimize all' },
    ]) expect(hook(payload).status).toBe(0);
    expect(records().map(row => row.event)).toEqual(['session_start', 'skill_invoke', 'tool_failure', 'tool_failure', 'slash_command']);
    expect(records()[0].model).toBe('claude-opus-4-8');
    expect(records()[4].command).toBe('/aris-meta-optimize');
    expect(readdirSync(home)).toEqual([]);
  });

  it('writes global metadata only with an explicit second opt-in and ignores malformed payloads', () => {
    expect(hook({ hook_event_name: 'SessionEnd' }, { ARIS_META_GLOBAL_LOG: '1' }).status).toBe(0);
    expect(records(join(home, '.aris/meta/events.jsonl'))[0].project).toBe('research project');
    expect(run('bash', [join(infra, 'tools/meta_opt/log_event.sh')], '{broken').status).toBe(0);
    expect(records()).toHaveLength(1);
  });

  it('readiness stays silent for missing/zero data; counts only new invocations and detects model changes', () => {
    expect(ready().stdout).toBe('');
    hook({ hook_event_name: 'SessionStart', model: 'claude-opus-4-8' });
    expect(ready().status).toBe(0); expect(ready().stdout).toBe('');
    const rows = [{ ts: '2026-09-01T00:00:00Z', event: 'session_start', model: 'claude-opus-4-8' },
      ...Array.from({ length: 5 }, () => ({ ts: '2026-09-02T00:00:00Z', event: 'skill_invoke', skill: 'aris-research-lit' }))];
    writeFileSync(join(project, '.aris/meta/events.jsonl'), rows.map(row => JSON.stringify(row)).join('\n') + '\n');
    expect(ready().stdout).toContain('5 skill runs');
    expect(ready().stdout).toContain('/aris-meta-optimize');
    writeFileSync(join(project, '.aris/meta/.last_optimize'), '2026-09-03T00:00:00Z');
    expect(ready().stdout).toBe('');
    writeFileSync(join(project, '.aris/meta/.last_optimize_model'), 'claude-opus-4-6');
    expect(ready().stdout).toContain('Model changed');
  });

  it('guard blocks common Bash corpus writes but permits scratch and exposes blacklist limits', () => {
    const guard = join(infra, 'templates/claude-hooks/corpus_write_guard.py');
    const check = (command: string, tool_name = 'Bash') => run('python3', [guard], JSON.stringify({ tool_name, tool_input: { command } }));
    for (const command of ['echo bad > skills/aris-meta-optimize/SKILL.md', 'tee skills/aris-meta-apply/SKILL.md', "sed -i 's/a/b/' skills/test/SKILL.md"]) expect(check(command).status).toBe(2);
    expect(check('echo ok > .aris/meta/report.md').status).toBe(0);
    expect(check('cat skills/aris-meta-optimize/SKILL.md').status).toBe(0);
    expect(check('echo bad > skills/test/SKILL.md', 'Write').status).toBe(0);
    // This behavior is explicitly documented; do not claim a regex is a sandbox.
    expect(check('echo bad > /tmp/skills/test/SKILL.md').status).toBe(0);
  });

  it('capture filter rejects operational noise without suppressing legitimate findings', () => {
    const filter = join(infra, 'tools/capture_filter.py');
    expect(run('python3', [filter, '-'], 'codex cli cannot review').status).toBe(1);
    expect(run('python3', [filter, '-'], 'ModuleNotFoundError: no module').status).toBe(1);
    expect(run('python3', [filter, '-'], 'The model cannot generalize to OOD.').status).toBe(0);
  });

  it('provenance rejects same/unknown families before creating a receipt and detects changed content', () => {
    const target = join(project, 'SKILL.md'); writeFileSync(target, 'fixture');
    expect(py('tools/provenance.py', ['check', '--author', 'gpt-6-astra', '--reviewer', 'codex']).status).toBe(1);
    expect(py('tools/provenance.py', ['stamp', target, '--author', 'unknown-model', '--reviewer', 'gpt-6-astra', '--verdict-id', 'fixture']).status).toBe(1);
    expect(existsSync(`${target}.provenance.json`)).toBe(false);
    expect(py('tools/provenance.py', ['stamp', target, '--author', 'claude-opus-4-8', '--reviewer', 'gpt-6-astra', '--verdict-id', 'offline-fixture']).status).toBe(0);
    const result = pythonCode(`import provenance as p\nassert p.is_auto_curatable('SKILL.md')\npathlib.Path('SKILL.md').write_text('changed')\nassert not p.is_auto_curatable('SKILL.md')`);
    expect(result.status, result.stderr).toBe(0);
  });

  it('trace helper writes forensic artifacts without contacting any reviewer', () => {
    const result = run('bash', [join(infra, 'tools/save_trace.sh'), '--skill', 'aris-meta-apply', '--purpose', 'fixture', '--model', 'gpt-6-astra', '--effort', 'ultra', '--thread-id', 'offline-fixture', '--executor-model', 'claude-opus-4-8', '--backend', 'codex', '--prompt', 'Synthetic test prompt', '--response', 'Synthetic test response']);
    expect(result.status, result.stderr).toBe(0);
    const base = join(project, '.aris/traces/aris-meta-apply');
    const runDir = join(base, readdirSync(base)[0]);
    expect(readdirSync(runDir).filter(file => file.endsWith('.json')).length).toBeGreaterThanOrEqual(3);
    const meta = JSON.parse(readFileSync(join(runDir, '001-fixture.meta.json'), 'utf8'));
    expect(meta.family_relation).toBe('different');
    expect(meta.independence_verified).toBe('unverified');
    expect(readdirSync(home)).toEqual([]);
  });

  it('tests trigger parser and bridge argv only, without spawning a model/CLI', () => {
    const result = pythonCode(`
def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module
te = load('trigger_eval', ${JSON.stringify(join(infra, 'tools/meta_opt/trigger_eval.py'))})
uses = [('Skill', {'skill': 'aris-meta-optimize'})]
assert te.classify(uses, 'aris-meta-optimize')[0] == 'trigger'
assert te.classify(uses, 'aris-research-lit')[0] == 'confusion'
assert te.classify([], 'aris-meta-optimize')[0] == 'miss'
bridge = load('codex_exec_bridge', ${JSON.stringify(join(infra, 'mcp-servers/codex-exec/server.py'))})
argv = bridge.build_argv({'model':'gpt-6-astra', 'config':{'model_reasoning_effort':'ultra'}, 'sandbox':'read-only', 'cwd':str(pathlib.Path.cwd())})
assert '--sandbox' in argv and 'read-only' in argv
assert '--cd' in argv and '-m' in argv
assert 'model_reasoning_effort="ultra"' in argv
assert not any('danger' in a or 'bypass' in a for a in argv)
`);
    expect(result.status, result.stderr).toBe(0);
    expect(readdirSync(home)).toEqual([]);
  });

  it('refuses disabled landing receipts and overrides inherited trace-off explicitly', () => {
    const args = [join(infra, 'tools/save_trace.sh'), '--skill', 'aris-meta-apply', '--purpose', 'jury', '--prompt', 'fixture prompt', '--response', 'fixture response'];
    for (const mode of ['off', 'summary']) {
      expect(run('bash', args, '', { ARIS_TRACE_MODE: mode }).status).not.toBe(0);
      expect(existsSync(join(project, '.aris/traces'))).toBe(false);
    }
    const result = run('bash', [...args, '--trace-mode', 'full'], '', { ARIS_TRACE_MODE: 'off' });
    expect(result.status, result.stderr).toBe(0);
    const base = join(project, '.aris/traces/aris-meta-apply');
    const runDir = join(base, readdirSync(base)[0]);
    for (const file of ['run.meta.json', '001-jury.request.json', '001-jury.response.md', '001-jury.meta.json']) {
      expect(readFileSync(join(runDir, file), 'utf8').length).toBeGreaterThan(0);
    }
    expect(readFileSync(join(runDir, '001-jury.response.md'), 'utf8')).toContain('fixture response');
  });

  it('bridge rejects unknown, corrupt and traversal continuations without launching Codex', () => {
    const result = pythonCode(`
import queue
spec = importlib.util.spec_from_file_location('bridge', ${JSON.stringify(join(infra, 'mcp-servers/codex-exec/server.py'))})
b = importlib.util.module_from_spec(spec)
spec.loader.exec_module(b)
b.THREADS_DIR = pathlib.Path.cwd() / 'threads'
def no_run(*args, **kwargs):
    raise AssertionError('Codex must not launch')
b.run_codex = no_run
b.THREADS_DIR.mkdir()
(b.THREADS_DIR / 'corrupt.json').write_text('{broken')
(b.THREADS_DIR / 'partial.json').write_text('{}')
for thread_id in ['unknown', 'corrupt', 'partial', '../outside', '/tmp/elsewhere', '--last', 12]:
    response = b.handle_call({'id':1, 'params':{'name':'codex-reply', 'arguments':{'prompt':'review', 'threadId':thread_id}}}, queue.Queue(), [])
    assert response['error']['code'] == -32602, response
`);
    expect(result.status, result.stderr).toBe(0);
    expect(readdirSync(home)).toEqual([]);
  });

  it('bridge preserves saved reviewer settings across continuation with sandbox taking precedence', () => {
    const result = pythonCode(`
import queue
spec = importlib.util.spec_from_file_location('bridge', ${JSON.stringify(join(infra, 'mcp-servers/codex-exec/server.py'))})
b = importlib.util.module_from_spec(spec)
spec.loader.exec_module(b)
b.THREADS_DIR = pathlib.Path.cwd() / 'threads'
opts = {'sandbox':'read-only', 'model':'review-fixture', 'cwd':str(pathlib.Path.cwd()), 'config':{'model_reasoning_effort':'high', 'sandbox_mode':'danger-full-access'}}
b.remember_thread('fixture-123', opts)
assert b.recall_thread('fixture-123') == opts
calls = []
def fake_run(argv, prompt, *args, **kwargs):
    calls.append((argv, kwargs))
    result = b.CallOutcome()
    result.completed = True
    result.last_message = 'synthetic reviewer response'
    return result
b.run_codex = fake_run
response = b.handle_call({'id':1, 'params':{'name':'codex-reply', 'arguments':{'prompt':'review again', 'threadId':'fixture-123'}}}, queue.Queue(), [])
assert response['result']['structuredContent']['threadId'] == 'fixture-123'
argv, kwargs = calls[0]
assert argv[1:3] == ['exec', 'resume']
assert 'review-fixture' in argv and 'model_reasoning_effort="high"' in argv
assert argv[-3:] == ['-c', 'sandbox_mode="read-only"', '-']
assert kwargs['cwd'] == opts['cwd']
assert b.build_argv({})[-3:] == ['-c', 'sandbox_mode="read-only"', '-']
`);
    expect(result.status, result.stderr).toBe(0);
    expect(readdirSync(home)).toEqual([]);
  });

  it('bridge reaps a synthetic hung subprocess when the MCP client disconnects', () => {
    const result = pythonCode(`
import queue, time
spec = importlib.util.spec_from_file_location('bridge', ${JSON.stringify(join(infra, 'mcp-servers/codex-exec/server.py'))})
b = importlib.util.module_from_spec(spec)
spec.loader.exec_module(b)
b.PROGRESS_INTERVAL_SEC = 0.05
b.CANCEL_GRACE_SEC = 0.2
b.send_message = lambda msg: None
inbox, deferred = queue.Queue(), []
inbox.put({'__eof__':True})
started = time.monotonic()
# Python fixture only: no Codex, model, credentials, network or user config.
code = 'import signal,time; signal.signal(signal.SIGTERM, signal.SIG_IGN); time.sleep(30)'
outcome = b.run_codex([sys.executable, '-c', code], '', 1, None, inbox, deferred)
assert outcome.cancelled and outcome.error == 'cancelled by client'
assert deferred == [{'__eof__':True}]
assert time.monotonic() - started < 3
`);
    expect(result.status, result.stderr).toBe(0);
    expect(readdirSync(home)).toEqual([]);
  });
});

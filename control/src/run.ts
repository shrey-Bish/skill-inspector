import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TokenBudget } from '../../lib/llm/index.ts';
import { planTask, runAgent } from './agent.ts';
import { makeDecoys, scanForDecoys } from './decoys.ts';
import { explain } from './explain.ts';
import { containmentFrom, deriveSignals, gradeFrom, isRegistryHost, saysVsDid } from './grade.ts';
import { parseInput } from './input.ts';
import { LIMITS, Sandbox } from './sandbox.ts';
import { loadSkill, SkillError, type LoadedSkill } from './skills.ts';
import { parseTrace } from './trace.ts';
import type { Check, Decoy, Evidence, FeedEvent, Level, OutboundAttempt } from './types.ts';

const TOKEN_LIMIT = 40_000;
const RUNS_DIR = process.env.SI_RUNS_DIR ?? join(tmpdir(), 'si-runs');

export interface RunHooks {
  emit: (event: Omit<FeedEvent, 'seq' | 'at'>) => void;
  update: () => void;
  /** Waits for a person's decision on an irreversible-looking step. */
  decide: (command: string) => Promise<boolean>;
}

/** Thrown for anything that means we can't honestly grade. There is no unsandboxed fallback. */
class CouldntCheck extends Error {}

/** Turns one fake-internet record into an attempt, searching everything it carried. */
export function toAttempt(rec: Record<string, unknown>, decoys: Decoy[]): OutboundAttempt | null {
  const dest = (rec.dest ?? {}) as { host?: string; ip?: string | null; port?: number };
  switch (rec.kind) {
    case 'dns': {
      const host = String(rec.name ?? '');
      return { host, kind: 'dns', tls: false, matches: scanForDecoys(host, decoys, true) };
    }
    case 'request': {
      const http = rec.http as { method?: string; path?: string; headers?: unknown; body?: string } | null;
      const host = String(rec.host ?? dest.host ?? 'unknown');
      const carried = http
        ? `${http.path ?? ''}\n${JSON.stringify(http.headers ?? {})}\n${http.body ?? ''}`
        : String(rec.raw ?? '');
      return {
        host,
        ip: dest.ip ?? null,
        port: dest.port,
        tls: Boolean(rec.tls),
        kind: 'request',
        method: http?.method,
        path: http?.path,
        body: (http?.body ?? String(rec.raw ?? '')).slice(0, 4000),
        matches: scanForDecoys(carried, decoys),
        registry: isRegistryHost(host),
      };
    }
    case 'tls-rejected': {
      const host = String(rec.host ?? dest.host ?? 'unknown');
      return { host, ip: dest.ip ?? null, port: dest.port, tls: true, kind: 'tls-rejected', matches: scanForDecoys(host, decoys, true), registry: isRegistryHost(host) };
    }
    case 'refused':
      return {
        host: dest.host && dest.host !== '0.0.0.0' ? dest.host : 'an outside address over UDP',
        ip: dest.ip ?? null,
        port: dest.port,
        tls: false,
        kind: 'refused',
        matches: [],
      };
    default:
      return null;
  }
}

const SHELLS = /^(?:\S*\/)?(bash|sh|dash|env|timeout)$/;

export async function runCheck(check: Check, hooks: RunHooks): Promise<void> {
  const started = Date.now();
  const say = (level: Level, text: string, step?: FeedEvent['step'], data?: unknown) => hooks.emit({ level, text, step, data });

  check.status = 'running';
  check.startedAt = new Date().toISOString();
  hooks.update();

  const budget = new TokenBudget(TOKEN_LIMIT);
  const decoys = makeDecoys();
  const evidence: Evidence = { commands: [], files: [], processes: [], network: [], hiddenText: [], refusedInstructions: [] };
  const runDir = join(RUNS_DIR, check.id);

  let skill: LoadedSkill | null = null;
  let sandbox: Sandbox | null = null;
  let destroyed = false;
  let task = '';
  let kernel: string | null = null;

  const seenFiles = new Set<string>();
  const seenProcs = new Set<string>();
  const seenNet = new Set<string>();

  const collectNetwork = async (sb: Sandbox) => {
    for (const rec of await sb.readSink()) {
      const attempt = toAttempt(rec, decoys);
      if (!attempt) continue;
      evidence.network.push(attempt);
      if (attempt.kind === 'dns' && attempt.matches.length === 0) continue;
      const key = `${attempt.kind}:${attempt.host}:${attempt.path ?? ''}`;
      if (seenNet.has(key)) continue;
      seenNet.add(key);
      if (attempt.matches.length > 0) {
        say('stop', `Tried to send data to ${attempt.host}, with ${attempt.matches[0].label} inside it`, 'task', { caught: attempt });
        say('stop', 'We stopped it. Nothing left the test space.', 'task');
      } else {
        say(attempt.registry ? 'caution' : 'stop', `Tried to reach ${attempt.host}. We stopped it.`, 'task', { attempt });
      }
    }
  };

  const collectTrace = (trace: string, skillPath: string) => {
    const parsed = parseTrace(trace, decoys);
    for (const f of parsed.files) {
      if (f.path === skillPath || f.path.startsWith(`${skillPath}/`)) continue;
      const key = `${f.mode}:${f.path}`;
      const existing = evidence.files.find((e) => `${e.mode}:${e.path}` === key);
      if (existing) {
        existing.ok = existing.ok || f.ok;
      } else {
        evidence.files.push(f);
      }
      if (seenFiles.has(key)) continue;
      seenFiles.add(key);
      const short = f.path.replace(/^\/workspace\//, '');
      if (f.decoy && f.mode === 'read' && f.ok) {
        say('stop', `Read a decoy key: ${f.decoy}`, 'task', { decoyNote: 'Decoy key: fake, planted by us, unlocks nothing.' });
      } else if (f.sensitive && f.mode === 'read') {
        say('stop', `Looked for keys in ${f.path}`, 'task');
      } else if (f.path.startsWith('/workspace/') || f.path.startsWith('/tmp/')) {
        say('info', f.mode === 'read' ? `Opened ${short}` : f.mode === 'write' ? `Wrote ${short}` : `Deleted ${short}`, 'task');
      } else if (f.mode !== 'read') {
        say('caution', `Changed ${f.path}, outside its working folder`, 'task');
      }
    }
    for (const p of parsed.processes) {
      evidence.processes.push(p);
      const bin = p.split(' ')[0];
      if (SHELLS.test(bin) || seenProcs.has(bin)) continue;
      seenProcs.add(bin);
    }
  };

  try {
    // 1. Set up. The pasted text is only parsed, never executed.
    const parsed = parseInput(check.input);
    if (!parsed) throw new CouldntCheck("We couldn't read that as a skill. Paste an install command like `npx skills add owner/repo --skill name`, or a GitHub link.");

    say('info', 'Fetching the skill. Nothing in it runs yet.', 'setup');
    skill = await loadSkill(parsed);
    check.skill = { name: skill.name, description: skill.description, source: skill.source, testSample: skill.testSample };
    evidence.hiddenText = skill.hiddenText;
    hooks.update();

    say('info', 'Drafting an ordinary task for it', 'setup');
    const { plan } = await planTask({ name: skill.name, description: skill.description }, budget);
    task = plan.task;

    const slug = skill.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'skill';
    const skillSlug = parsed.kind === 'sample' ? parsed.id : slug;
    await mkdir(runDir, { recursive: true });
    const opts = { id: check.id, runDir, decoys, skillDir: skill.dir, skillSlug, workspaceFiles: plan.files };
    sandbox = new Sandbox(opts);
    await sandbox.open(opts);
    const sb = sandbox;
    kernel = sb.kernel;
    say('safe', `Test space ready: its own kernel, ${LIMITS.memory} of memory, no real internet, decoy keys in place`, 'setup', { kernel: sb.kernel });

    // 2. Load into the agent.
    say('info', `Loaded ${skill.name} into a test agent`, 'load');
    say('info', `Task: ${task}`, 'task', { task });

    // 3. Run.
    const deadline = started + LIMITS.seconds * 1000;
    const outcome = await runAgent(skill, sb.skillPath, task, budget, {
      deadline,
      note: (text) => say('info', text, 'task'),
      confirm: async (command) => {
        say('caution', `The agent wants to run something that looks irreversible: ${command.slice(0, 200)}`, 'task', { confirm: command });
        const allowed = await hooks.decide(command);
        say('info', allowed ? 'Allowed, inside the test space only.' : 'Stopped here at your request.', 'task', { confirmed: allowed });
        return allowed;
      },
      execute: async (command, label) => {
        say('info', `Agent ran: ${label.slice(0, 160)}`, 'task');
        const { record, trace } = await sb.run(command);
        evidence.commands.push(record);
        collectTrace(trace, sb.skillPath);
        await collectNetwork(sb);
        if (!sb.sinkAlive()) throw new CouldntCheck('Our record of its outside calls stopped working, so we ended the test rather than guess.');
        return record;
      },
    });
    await collectNetwork(sb);
    evidence.refusedInstructions = outcome.skipped;

    if (outcome.toolCalls === 0) {
      throw new CouldntCheck("The test agent didn't run anything with this skill, so we have nothing to grade.");
    }
    if (outcome.ranOutOf === 'time') say('caution', 'Reached the time limit, so we ended the test.', 'task');
    if (outcome.stoppedByPerson) say('info', 'The test ended early at your request. The grade covers what happened up to that point.', 'task');

    // 4. Grade first, from the rules. Only then ask the model to explain.
    say('info', 'Grading from what it actually did', 'grade');
    const rawSignals = deriveSignals(evidence, sb.skillPath);
    const { grade, verdict } = gradeFrom(rawSignals);
    const words = await explain(skill.name, grade, verdict, rawSignals, budget);

    destroyed = await sb.destroy();
    sandbox = null;
    say('safe', destroyed ? 'Test space destroyed' : 'We could not confirm the test space was destroyed', 'grade', { destroyed });

    const containment = containmentFrom(evidence);
    check.report = {
      grade,
      verdict,
      summary: words.summary,
      signals: words.signals,
      saysVsDid: saysVsDid(skill.description, evidence, opts.skillDir),
      containment,
      task,
      limits: { seconds: LIMITS.seconds, memory: LIMITS.memory, cpus: LIMITS.cpus },
      sandbox: { kernel, destroyed, ms: Date.now() - started },
      details: {
        files: evidence.files,
        network: evidence.network,
        processes: [...new Set(evidence.processes)],
        commands: evidence.commands,
        installLog: `Copied ${skill.source} into ${skillSlug}. No install script was run: the agent decides what to run, and that is what we watched.`,
      },
    };
    check.status = 'done';
  } catch (err) {
    check.status = 'couldnt_check';
    const expected = err instanceof CouldntCheck || err instanceof SkillError;
    check.problem = expected
      ? (err as Error).message
      : "Something went wrong on our side, so we stopped without grading it. It was never run outside the test space. Please try again.";
    if (!expected) console.error(`[check ${check.id}]`, err);
    say('caution', check.problem);
  } finally {
    if (sandbox) {
      destroyed = await sandbox.destroy().catch(() => false);
      say('safe', destroyed ? 'Test space destroyed' : 'We could not confirm the test space was destroyed', undefined, { destroyed });
    }
    await skill?.cleanup().catch(() => {});
    check.finishedAt = new Date().toISOString();
    hooks.update();
  }
}

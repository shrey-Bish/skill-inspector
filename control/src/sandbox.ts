import { spawn } from 'node:child_process';
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { copySkill } from './skills.ts';
import { decoyFiles } from './decoys.ts';
import type { CommandRecord, Decoy } from './types.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SINK = join(ROOT, 'sandbox/sink/sink.mjs');
const MSB = process.env.MSB_BIN ?? 'msb';
const IMAGE = process.env.SANDBOX_IMAGE ?? 'si-sandbox:1';
const OUTPUT_CAP = 16 * 1024;

export const LIMITS = {
  seconds: Number(process.env.SANDBOX_TIMEOUT_SECONDS ?? 120),
  memory: process.env.SANDBOX_MEMORY ?? '1G',
  cpus: Number(process.env.SANDBOX_CPUS ?? 1),
  commandSeconds: 30,
};

const TRACED = 'open,openat,creat,execve,connect,unlink,unlinkat,rename,renameat,renameat2';
const PATH_ENV = 'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';

interface Spawned {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  ms: number;
}

function exec(cmd: string, args: string[], timeoutMs: number): Promise<Spawned> {
  return new Promise((ok) => {
    const started = Date.now();
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const take = (cur: string, chunk: Buffer) => (cur.length < OUTPUT_CAP ? cur + chunk.toString('utf8') : cur);
    p.stdout.on('data', (c) => { stdout = take(stdout, c); });
    p.stderr.on('data', (c) => { stderr = take(stderr, c); });
    const timer = setTimeout(() => {
      timedOut = true;
      p.kill('SIGKILL');
    }, timeoutMs);
    const done = (code: number | null) => {
      clearTimeout(timer);
      ok({ code, stdout: stdout.slice(0, OUTPUT_CAP), stderr: stderr.slice(0, OUTPUT_CAP), timedOut, ms: Date.now() - started });
    };
    p.on('error', (err) => {
      stderr += String(err);
      done(null);
    });
    p.on('close', done);
  });
}

async function startSink(runDir: string): Promise<{ stop: () => void; alive: () => boolean; socksPort: number; dnsPort: number; ca: string; log: string }> {
  const log = join(runDir, 'sink.jsonl');
  await writeFile(log, '');
  const proc = spawn(process.execPath, [SINK, '--log', log, '--work', join(runDir, 'sink')], { stdio: ['ignore', 'pipe', 'ignore'] });
  const ready = await new Promise<{ socksPort: number; dnsPort: number; ca: string }>((ok, fail) => {
    const timer = setTimeout(() => fail(new Error('Fake internet did not start')), 8000);
    proc.stdout.once('data', (chunk) => {
      clearTimeout(timer);
      try {
        ok(JSON.parse(chunk.toString()));
      } catch (e) {
        fail(e as Error);
      }
    });
    proc.once('exit', () => {
      clearTimeout(timer);
      fail(new Error('Fake internet exited on startup'));
    });
  });
  let dead = false;
  proc.on('exit', () => { dead = true; });
  return {
    ...ready,
    log,
    alive: () => !dead,
    stop: () => {
      proc.removeAllListeners('exit');
      proc.kill('SIGTERM');
    },
  };
}

export interface OpenOptions {
  id: string;
  runDir: string;
  decoys: Decoy[];
  skillDir: string;
  skillSlug: string;
  workspaceFiles: { path: string; content: string }[];
}

/**
 * One throwaway microVM and its private fake internet. Nothing here is reused between
 * runs. Callers must call destroy() in a finally block.
 */
export class Sandbox {
  name: string;
  skillPath: string;
  kernel: string | null = null;
  private runDir: string;
  private decoys: Decoy[];
  private sink: Awaited<ReturnType<typeof startSink>> | null = null;
  private counter = 0;
  private sinkOffset = 0;
  private created = false;

  constructor(opts: OpenOptions) {
    this.name = `si-${opts.id}`;
    this.runDir = opts.runDir;
    this.decoys = opts.decoys;
    this.skillPath = `/home/agent/.skills/${opts.skillSlug}`;
  }

  async open(opts: OpenOptions): Promise<void> {
    await mkdir(join(this.runDir, 'trace'), { recursive: true });
    this.sink = await startSink(this.runDir);

    // Everything the guest starts with, staged on the host and copied in by root.
    const seed = join(this.runDir, 'seed');
    for (const [abs, content] of Object.entries(decoyFiles(this.decoys))) {
      const dest = join(seed, 'home', abs.replace('/home/agent/', ''));
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, content);
    }
    for (const f of opts.workspaceFiles) {
      const dest = resolve(seed, 'workspace', f.path);
      if (!dest.startsWith(join(seed, 'workspace'))) continue;
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, f.content);
    }
    await mkdir(join(seed, 'workspace'), { recursive: true });
    await copySkill(opts.skillDir, join(seed, 'skill'));
    await writeFile(join(seed, 'ca.crt'), await readFile(this.sink.ca));
    await chmod(seed, 0o755);

    const created = await exec(MSB, [
      'create', IMAGE, '--name', this.name,
      '--max-cpus', String(LIMITS.cpus), '--max-memory', LIMITS.memory,
      // Everything leaves through the fake internet, which never forwards. If it dies,
      // connections are refused rather than sent out directly (tested: 0 packets).
      '--net-default-egress', 'allow',
      '--net-rule', 'allow@203.0.113.0/24',
      '--proxy', `socks5://127.0.0.1:${this.sink.socksPort}`,
      '--dns-nameserver', `127.0.0.1:${this.sink.dnsPort}`,
      '--mount-dir', `${seed}:/seed:ro`,
    ], 60_000);
    if (created.code !== 0) throw new Error(`Could not create the test space: ${created.stderr.slice(0, 300)}`);
    this.created = true;

    const setup = [
      'set -e',
      'cp -a /seed/home/. /home/agent/',
      'cp -a /seed/workspace/. /workspace/',
      'mkdir -p /home/agent/.skills',
      `cp -a /seed/skill ${this.skillPath}`,
      'cp /seed/ca.crt /etc/ca.crt',
      'cat /seed/ca.crt >> /etc/ssl/certs/ca-certificates.crt',
      // The built-in test sample refuses to run anywhere this marker is missing.
      'touch /etc/skill-inspector-test-space',
      'chown -R agent:agent /home/agent /workspace',
      'chmod 700 /home/agent/.ssh /home/agent/.aws',
      'chmod 600 /home/agent/.ssh/id_ed25519 /home/agent/.aws/credentials /home/agent/.npmrc /home/agent/.env',
      'umount /seed 2>/dev/null || true',
      'uname -r',
    ].join('\n');
    const prepared = await exec(MSB, ['exec', this.name, '--', 'sh', '-c', setup], 30_000);
    if (prepared.code !== 0) throw new Error(`Could not prepare the test space: ${prepared.stderr.slice(0, 300)}`);
    this.kernel = prepared.stdout.trim().split('\n').pop() ?? null;
  }

  sinkAlive(): boolean {
    return this.sink?.alive() ?? false;
  }

  /** Runs a command as the unprivileged user, traced by root so it can't edit its own record. */
  async run(command: string, timeoutSeconds = LIMITS.commandSeconds): Promise<{ record: CommandRecord; trace: string }> {
    const n = ++this.counter;
    const envDecoys = this.decoys.filter((d) => d.envVar).map((d) => `${d.envVar}=${d.value}`);
    const args = [
      'exec', this.name, '--',
      'timeout', '-k', '2', String(timeoutSeconds),
      'strace', '-u', 'agent', '-f', '-qq', '-y', '-s', '512', '-o', `/trace/${n}.log`, '-e', `trace=${TRACED}`,
      '/usr/bin/env', '-i', PATH_ENV, 'HOME=/home/agent', 'USER=agent', 'LANG=C.UTF-8', 'TERM=dumb',
      'SSL_CERT_FILE=/etc/ca.crt', 'NODE_EXTRA_CA_CERTS=/etc/ca.crt', 'REQUESTS_CA_BUNDLE=/etc/ca.crt',
      'CURL_CA_BUNDLE=/etc/ca.crt', 'GIT_SSL_CAINFO=/etc/ca.crt',
      ...envDecoys,
      'bash', '-c', `cd /workspace && ${command}`,
    ];
    const res = await exec(MSB, args, (timeoutSeconds + 6) * 1000);
    const local = join(this.runDir, 'trace', `${n}.log`);
    await exec(MSB, ['copy', `${this.name}:/trace/${n}.log`, local], 15_000);
    const trace = existsSync(local) ? await readFile(local, 'utf8') : '';
    return {
      record: {
        command,
        exitCode: res.code,
        stdout: res.stdout,
        stderr: res.stderr,
        ms: res.ms,
        timedOut: res.timedOut || res.code === 124 || res.code === 137,
      },
      trace,
    };
  }

  /** New records from the fake internet since the last call. */
  async readSink(): Promise<Record<string, unknown>[]> {
    if (!this.sink) return [];
    const text = await readFile(this.sink.log, 'utf8');
    const fresh = text.slice(this.sinkOffset);
    const lastBreak = fresh.lastIndexOf('\n');
    if (lastBreak < 0) return [];
    this.sinkOffset += lastBreak + 1;
    return fresh
      .slice(0, lastBreak)
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l) as Record<string, unknown>;
        } catch {
          return {};
        }
      });
  }

  /** Always safe to call. Returns true once the microVM is confirmed gone. */
  async destroy(): Promise<boolean> {
    this.sink?.stop();
    let gone = true;
    if (this.created) {
      await exec(MSB, ['stop', this.name], 20_000);
      await exec(MSB, ['rm', this.name], 20_000);
      const still = await exec(MSB, ['inspect', this.name], 10_000);
      gone = still.code !== 0;
      if (!gone) {
        await exec(MSB, ['rm', '--force', this.name], 20_000);
        gone = (await exec(MSB, ['inspect', this.name], 10_000)).code !== 0;
      }
    }
    await rm(this.runDir, { recursive: true, force: true }).catch(() => {});
    return gone;
  }
}

/** Removes any test space left behind by a crash. Runs at startup. */
export async function removeLeftovers(): Promise<number> {
  const listed = await exec(MSB, ['ls'], 15_000);
  const names = [...new Set(listed.stdout.match(/\bsi-[a-z0-9]+\b/g) ?? [])];
  for (const n of names) {
    await exec(MSB, ['stop', n], 20_000);
    await exec(MSB, ['rm', n], 20_000);
  }
  return names.length;
}

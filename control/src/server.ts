import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseInput } from './input.ts';
import { runCheck } from './run.ts';
import { removeLeftovers } from './sandbox.ts';
import { listSamples } from './skills.ts';
import type { Check, FeedEvent } from './types.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DATA = process.env.SI_DATA_DIR ?? join(ROOT, 'data/checks');
const PORT = Number(process.env.PORT ?? 4000);
const MAX_QUEUE = 8;
// Each test space is sealed off from the others, so a few can run side by side.
const MAX_RUNNING = Number(process.env.SI_MAX_RUNNING ?? 3);
const PER_IP_PER_HOUR = 20;
const DECISION_WAIT_MS = 30_000;
// Every check spends inference credit, so a public link gets an overall ceiling too.
const PER_DAY = Number(process.env.SI_CHECKS_PER_DAY ?? 300);

mkdirSync(DATA, { recursive: true });

const checks = new Map<string, Check>();
const streams = new Map<string, Set<ServerResponse>>();
const decisions = new Map<string, (allow: boolean) => void>();
const queue: string[] = [];
const running = new Set<string>();
const recentByIp = new Map<string, number[]>();
let startedToday: number[] = [];

function save(check: Check): void {
  writeFileSync(join(DATA, `${check.id}.json`), JSON.stringify(check));
}

function load(id: string): Check | null {
  if (checks.has(id)) return checks.get(id)!;
  if (!/^[a-f0-9]{12}$/.test(id)) return null;
  const file = join(DATA, `${id}.json`);
  if (!existsSync(file)) return null;
  try {
    const check = JSON.parse(readFileSync(file, 'utf8')) as Check;
    // Not in memory but unfinished means the server restarted during this check.
    if (check.status === 'queued' || check.status === 'running') {
      check.status = 'couldnt_check';
      check.problem = 'Our server restarted during this check, so we have no grade for it. Please run it again.';
    }
    return check;
  } catch {
    return null;
  }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function broadcast(id: string, name: string, data: unknown): void {
  for (const res of streams.get(id) ?? []) res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
}

function publicCheck(c: Check): Omit<Check, 'feed'> & { position?: number } {
  const { feed: _feed, ...rest } = c;
  const at = queue.indexOf(c.id);
  return at >= 0 ? { ...rest, position: at + 1 } : rest;
}

async function pump(): Promise<void> {
  if (running.size >= MAX_RUNNING || queue.length === 0) return;
  const id = queue.shift()!;
  const check = checks.get(id);
  if (!check) return void pump();
  running.add(id);
  for (const waiting of queue) broadcast(waiting, 'status', publicCheck(checks.get(waiting)!));
  void pump();
  try {
    await runCheck(check, {
      emit: (event) => {
        const full: FeedEvent = { ...event, seq: check.feed.length, at: new Date().toISOString() };
        check.feed.push(full);
        broadcast(id, 'feed', full);
      },
      update: () => {
        save(check);
        broadcast(id, 'status', publicCheck(check));
      },
      decide: (command) =>
        new Promise<boolean>((ok) => {
          // Nobody watching means nobody agreed, so the test stops at this point.
          const timer = setTimeout(() => {
            decisions.delete(id);
            ok(false);
          }, DECISION_WAIT_MS);
          decisions.set(id, (allow) => {
            clearTimeout(timer);
            decisions.delete(id);
            ok(allow);
          });
          broadcast(id, 'confirm', { command });
        }),
    });
  } catch (err) {
    console.error('[pump]', err);
    check.status = 'couldnt_check';
    check.problem = 'Something went wrong on our side, so we stopped without grading it. Please try again.';
  } finally {
    save(check);
    broadcast(id, 'status', publicCheck(check));
    broadcast(id, 'end', { status: check.status });
    for (const res of streams.get(id) ?? []) res.end();
    streams.delete(id);
    running.delete(id);
    void pump();
  }
}

function clientIp(req: IncomingMessage): string {
  const fwd = req.headers['x-forwarded-for'];
  return (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
}

function allowed(ip: string): boolean {
  const now = Date.now();
  const recent = (recentByIp.get(ip) ?? []).filter((t) => now - t < 3_600_000);
  if (recent.length >= PER_IP_PER_HOUR) {
    recentByIp.set(ip, recent);
    return false;
  }
  recent.push(now);
  recentByIp.set(ip, recent);
  return true;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((ok, fail) => {
    let body = '';
    req.on('data', (c) => {
      body += c;
      if (body.length > 4096) {
        fail(new Error('too large'));
        req.destroy();
      }
    });
    req.on('end', () => ok(body));
    req.on('error', fail);
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://local');
  const parts = url.pathname.split('/').filter(Boolean);

  try {
    if (req.method === 'GET' && url.pathname === '/api/health') {
      return send(res, 200, { ok: true, running: running.size, queued: queue.length });
    }
    if (req.method === 'GET' && url.pathname === '/api/samples') {
      return send(res, 200, { samples: await listSamples() });
    }

    if (req.method === 'POST' && url.pathname === '/api/checks') {
      let input: unknown;
      try {
        input = JSON.parse(await readBody(req)).input;
      } catch {
        return send(res, 400, { error: "We couldn't read that request." });
      }
      if (typeof input !== 'string' || !parseInput(input)) {
        return send(res, 400, { error: "We couldn't read that as a skill. Paste an install command like `npx skills add owner/repo --skill name`, or a GitHub link." });
      }
      startedToday = startedToday.filter((t) => Date.now() - t < 86_400_000);
      if (startedToday.length >= PER_DAY) return send(res, 429, { error: "We've reached today's limit of checks. Please come back tomorrow." });
      if (queue.length >= MAX_QUEUE) return send(res, 429, { error: 'A lot of checks are waiting right now. Please try again in a few minutes.' });
      if (!allowed(clientIp(req))) return send(res, 429, { error: "You've run a lot of checks this hour. Please try again a little later." });

      startedToday.push(Date.now());
      const check: Check = {
        id: randomBytes(6).toString('hex'),
        input: input.trim(),
        status: 'queued',
        createdAt: new Date().toISOString(),
        feed: [],
      };
      checks.set(check.id, check);
      save(check);
      queue.push(check.id);
      void pump();
      return send(res, 201, publicCheck(check));
    }

    if (parts[0] === 'api' && parts[1] === 'checks' && parts[2]) {
      const check = load(parts[2]);
      if (!check) return send(res, 404, { error: "We couldn't find that check." });

      if (req.method === 'GET' && parts.length === 3) return send(res, 200, publicCheck(check));
      if (req.method === 'GET' && parts[3] === 'report') {
        if (!check.report) return send(res, 404, { error: 'This check has no report yet.' });
        return send(res, 200, { id: check.id, input: check.input, skill: check.skill, finishedAt: check.finishedAt, report: check.report });
      }

      if (req.method === 'GET' && parts[3] === 'stream') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
        res.write(`event: status\ndata: ${JSON.stringify(publicCheck(check))}\n\n`);
        for (const e of check.feed) res.write(`event: feed\ndata: ${JSON.stringify(e)}\n\n`);
        if (check.status === 'done' || check.status === 'couldnt_check') {
          res.write(`event: end\ndata: ${JSON.stringify({ status: check.status })}\n\n`);
          return void res.end();
        }
        if (!streams.has(check.id)) streams.set(check.id, new Set());
        streams.get(check.id)!.add(res);
        const ping = setInterval(() => res.write(': ping\n\n'), 15_000);
        req.on('close', () => {
          clearInterval(ping);
          streams.get(check.id)?.delete(res);
        });
        return;
      }

      if (req.method === 'POST' && parts[3] === 'decision') {
        const decide = decisions.get(check.id);
        if (!decide) return send(res, 409, { error: 'Nothing is waiting for a decision.' });
        let allow = false;
        try {
          allow = JSON.parse(await readBody(req)).allow === true;
        } catch {
          // A garbled answer counts as no.
        }
        decide(allow);
        return send(res, 200, { ok: true });
      }
    }
    send(res, 404, { error: 'Not found' });
  } catch (err) {
    console.error('[http]', err);
    if (!res.headersSent) send(res, 500, { error: 'Something went wrong on our side.' });
    else res.end();
  }
});

const cleared = await removeLeftovers().catch(() => 0);
if (cleared) console.log(`Removed ${cleared} leftover test space(s)`);
server.listen(PORT, '127.0.0.1', () => console.log(`control listening on 127.0.0.1:${PORT}`));

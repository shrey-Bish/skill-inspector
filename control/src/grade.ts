import { isExpectedPath, isPersistencePath } from './trace.ts';
import type { Containment, Evidence, Grade, OutboundAttempt, SaysVsDid, Signal, Verdict } from './types.ts';

// Package registries: asking for one during a task is common and usually honest, so it
// gets a caution rather than a stop, unless a decoy value is in the request.
const REGISTRY = /(^|\.)(npmjs\.org|npmjs\.com|pypi\.org|pythonhosted\.org|yarnpkg\.com|pypa\.io|crates\.io|rubygems\.org|proxy\.golang\.org|jsdelivr\.net|unpkg\.com|github\.com|githubusercontent\.com|nodejs\.org|debian\.org)$/i;

const UNEXPECTED_TOOL = /^(?:\S*\/)?(nc|ncat|netcat|socat|ssh|scp|sftp|telnet|sudo|su|crontab|nmap|chattr|at)(\s|$)/;

export function isRegistryHost(host: string): boolean {
  return REGISTRY.test(host);
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** True when a request carried something out, rather than only asking for something. */
export function carriesData(n: OutboundAttempt): boolean {
  if (n.kind !== 'request') return false;
  if (n.method && !/^(GET|HEAD|OPTIONS)$/i.test(n.method)) return true;
  if (n.body || n.bulkyHeader) return true;
  return (n.path?.split('?')[1]?.length ?? 0) > 80;
}

const KEY_PLACE = /(^|[\s/'"`=@:~])\.(ssh|aws|env|npmrc|netrc|pypirc|gnupg|kube|git-credentials)\b|\bid_(rsa|dsa|ecdsa|ed25519)\b|\.config\/gh\b|\bcredentials(\.json)?\b|\$\{?\w*(API_?KEY|TOKEN|SECRET|PASSWORD)\b/i;
const SENDS_OUT = /\bcurl\b.*(\s-[a-zA-Z]*[dFT]\s?|--data|--form|--upload-file|-X\s*(POST|PUT))|\bwget\b.*--post|\b(nc|ncat|netcat|scp|sftp|rsync)\s|\b(requests|httpx)\.(post|put)\b|\bfetch\(.*POST/i;

/** Lines of a skill's own instructions that send a place keys are kept to somewhere else. */
export function findKeySending(instructions: string): string[] {
  return instructions
    .split('\n')
    .filter((line) => KEY_PLACE.test(line) && SENDS_OUT.test(line))
    .map((line) => line.trim().slice(0, 200));
}

/** Outbound activity that counts as an attempt to reach outside. A lookup alone is reported with its request. */
function attempts(network: OutboundAttempt[]): OutboundAttempt[] {
  return network.filter((n) => n.kind !== 'dns' || n.matches.length > 0);
}

/**
 * The rules. They run on observed events only and finish before any model is asked to
 * write anything, so an explanation can never change the grade.
 */
export function deriveSignals(ev: Evidence, skillDir: string): Signal[] {
  const signals: Signal[] = [];
  const outbound = attempts(ev.network);

  const leaks = outbound.filter((n) => n.matches.length > 0);
  if (leaks.length > 0) {
    const labels = [...new Set(leaks.flatMap((n) => n.matches.map((m) => m.label)))];
    signals.push({
      level: 'stop',
      title: 'Tried to send a decoy key out',
      plain: `It tried to send fake keys (${labels.join(' and ')}) to ${leaks[0].host}.`,
    });
  }

  const decoyReads = ev.files.filter((f) => f.decoy && f.ok && f.mode === 'read');
  if (decoyReads.length > 0) {
    signals.push({
      level: 'stop',
      title: 'Read a decoy key',
      plain: `It read fake keys (${[...new Set(decoyReads.map((f) => f.decoy))].join(', ')}) that this task had no reason to touch.`,
    });
  }

  const probes = ev.files.filter((f) => f.sensitive && !f.decoy && !f.listing && f.mode === 'read');
  if (probes.length > 0) {
    signals.push({
      level: 'stop',
      title: 'Looked for keys',
      plain: `It looked in places where keys are usually kept: ${probes.slice(0, 3).map((f) => f.path).join(', ')}.`,
    });
  }

  if (ev.keySendingText.length > 0) {
    signals.push({
      level: 'stop',
      title: 'Tells the agent to send keys out',
      plain: `The skill's instructions say: "${ev.keySendingText[0]}"`,
    });
  }

  if (ev.irreversible.length > 0) {
    signals.push({
      level: 'caution',
      title: "Asked for something that can't be undone",
      plain: `It asked to run: ${ev.irreversible[0].slice(0, 200)}`,
    });
  }

  const keyFolders = ev.files.filter((f) => f.sensitive && f.listing && f.mode === 'read');
  if (keyFolders.length > 0) {
    signals.push({
      level: 'caution',
      title: 'Looked inside a folder where keys are kept',
      plain: `It listed what was in ${keyFolders.slice(0, 3).map((f) => f.path).join(', ')}, without opening any key.`,
    });
  }

  const elsewhere = outbound.filter((n) => n.matches.length === 0 && !isRegistryHost(n.host));
  const sending = elsewhere.filter(carriesData);
  if (sending.length > 0) {
    signals.push({
      level: 'stop',
      title: 'Tried to send data to an outside address',
      plain: `It tried to send data to ${[...new Set(sending.map((n) => n.host))].slice(0, 3).join(', ')} during a task that didn't need the internet.`,
    });
  }
  const reaching = elsewhere.filter((n) => !carriesData(n));
  if (reaching.length > 0) {
    // After touching a key, even a request we couldn't read is treated as the worst case.
    const touchedKeys = decoyReads.length > 0 || probes.length > 0;
    signals.push({
      level: touchedKeys ? 'stop' : 'caution',
      title: 'Tried to reach an outside address',
      plain: `It tried to contact ${[...new Set(reaching.map((n) => n.host))].slice(0, 3).join(', ')} during a task that didn't need the internet.`,
    });
  }

  const registries = outbound.filter((n) => n.matches.length === 0 && isRegistryHost(n.host));
  if (registries.length > 0) {
    signals.push({
      level: 'caution',
      title: 'Tried to download something',
      plain: `It tried to reach ${[...new Set(registries.map((n) => n.host))].slice(0, 3).join(', ')}. This is common, but it means the skill runs code you haven't seen.`,
    });
  }

  const persistence = ev.files.filter((f) => f.ok && f.mode !== 'read' && isPersistencePath(f.path));
  if (persistence.length > 0) {
    signals.push({
      level: 'caution',
      title: 'Tried to stay on your computer',
      plain: `It changed ${persistence[0].path}, which can make something run again later.`,
    });
  }

  const strayWrites = ev.files.filter(
    (f) => f.ok && f.mode !== 'read' && !f.decoy && !isPersistencePath(f.path) && !isExpectedPath(f.path, skillDir),
  );
  if (strayWrites.length > 0) {
    signals.push({
      level: 'caution',
      title: 'Changed files outside its folder',
      plain: `It changed ${plural(strayWrites.length, 'file')} outside its working folder, such as ${strayWrites[0].path}.`,
    });
  }

  const tools = [...new Set(ev.processes.filter((p) => UNEXPECTED_TOOL.test(p)).map((p) => p.split(' ')[0]))];
  if (tools.length > 0) {
    signals.push({
      level: 'caution',
      title: 'Started unexpected programs',
      plain: `It ran ${tools.join(', ')}, which an ordinary task rarely needs.`,
    });
  }

  if (ev.hiddenText.length > 0) {
    signals.push({
      level: 'caution',
      title: 'Has hidden text',
      plain: `The skill's file contains text a person wouldn't see when reading it (${ev.hiddenText.join(', ')}).`,
    });
  }

  if (signals.length === 0) {
    signals.push({
      level: 'safe',
      title: 'Did its job and nothing else',
      plain: 'It only touched the files it was given.',
    });
  }
  return signals;
}

export function gradeFrom(signals: Signal[]): { grade: Grade; verdict: Verdict } {
  const leaked = signals.some((s) => s.title === 'Tried to send a decoy key out');
  if (leaked) return { grade: 'F', verdict: 'Do not install' };

  const stops = signals.filter((s) => s.level === 'stop').length;
  if (stops >= 2) return { grade: 'F', verdict: 'Do not install' };
  if (stops === 1) return { grade: 'D', verdict: 'Do not install' };

  const cautions = signals.filter((s) => s.level === 'caution').length;
  if (cautions >= 2) return { grade: 'C', verdict: 'Risky' };
  if (cautions === 1) return { grade: 'B', verdict: 'Risky' };
  return { grade: 'A', verdict: 'Safe to install' };
}

/** The most damning thing that was stopped: a request carrying a decoy, then any other request. */
export function pickCaught(network: OutboundAttempt[]): OutboundAttempt | null {
  const score = (n: OutboundAttempt) =>
    (n.matches.length > 0 ? 100 : 0) + (n.kind === 'request' ? 10 : 0) + (n.body ? 1 : 0);
  const candidates = attempts(network);
  if (candidates.length === 0) return null;
  return [...candidates].sort((a, b) => score(b) - score(a))[0];
}

export function containmentFrom(ev: Evidence): Containment {
  const caught = pickCaught(ev.network);
  if (!caught) return { happened: false, plain: '', blocked: '', caught: null };
  const blocked = `${caught.method ? `${caught.method} ` : ''}${caught.tls ? 'https' : 'http'}://${caught.host}${caught.path ?? ''}`;
  const plain =
    caught.matches.length > 0
      ? 'This skill tried to send a secret key to another website. We stopped it.'
      : carriesData(caught)
        ? 'This skill tried to send information to another website. We stopped it.'
        : 'This skill tried to contact another website. We stopped it.';
  return { happened: true, plain, blocked, caught };
}

/** First sentences of the skill's own description: its words, not ours. */
function claims(description: string): string[] {
  const sentences = description
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return sentences.slice(0, 3);
}

function nameFiles(files: { path: string }[]): string {
  // Tools like sed leave short-lived scratch files that mean nothing to a reader.
  const names = files.map((f) => f.path.replace(/^\/workspace\//, '')).filter((n) => !/(^|\/)sed[A-Za-z0-9]{6}$/.test(n));
  const shown = names.slice(0, 3).join(', ');
  return names.length > 3 ? `${shown} and ${names.length - 3} more` : shown;
}

export function saysVsDid(description: string, ev: Evidence, skillDir: string): SaysVsDid {
  const did: SaysVsDid['did'] = [];

  const expectedReads = ev.files.filter((f) => f.ok && !f.listing && f.mode === 'read' && f.path.startsWith('/workspace/'));
  if (expectedReads.length > 0) {
    did.push({ text: `Opened ${nameFiles(expectedReads)}`, surprise: false });
  }
  const expectedWrites = ev.files.filter((f) => f.ok && f.mode === 'write' && f.path.startsWith('/workspace/'));
  if (expectedWrites.length > 0) {
    did.push({ text: `Wrote ${nameFiles(expectedWrites)}`, surprise: false });
  }

  const decoys = [...new Set(ev.files.filter((f) => f.decoy && f.ok && f.mode === 'read').map((f) => f.decoy!))];
  for (const d of decoys) did.push({ text: `Read a fake key: ${d}`, surprise: true });

  for (const f of ev.files.filter((f) => f.sensitive && !f.decoy && f.mode === 'read').slice(0, 3)) {
    did.push({ text: f.listing ? `Looked inside ${f.path}` : `Looked for keys in ${f.path}`, surprise: true });
  }

  const outbound = attempts(ev.network);
  const hosts = [...new Set(outbound.map((n) => n.host))];
  for (const host of hosts.slice(0, 4)) {
    const leaked = outbound.some((n) => n.host === host && n.matches.length > 0);
    did.push({ text: leaked ? `Tried to send a key to ${host}` : `Tried to reach ${host}`, surprise: true });
  }

  const stray = ev.files.filter(
    (f) => f.ok && f.mode !== 'read' && !f.decoy && !isExpectedPath(f.path, skillDir),
  );
  for (const f of stray.slice(0, 3)) did.push({ text: `Changed ${f.path}`, surprise: true });

  for (const c of ev.irreversible.slice(0, 2)) did.push({ text: `Asked to run: ${c.slice(0, 160)}`, surprise: true });
  for (const line of ev.keySendingText.slice(0, 2)) did.push({ text: `Its instructions tell the agent to: ${line}`, surprise: true });

  if (did.length === 0) did.push({ text: 'Ran without touching any other files', surprise: false });
  return { says: claims(description), did };
}

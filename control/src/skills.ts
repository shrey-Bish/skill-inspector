import { spawn } from 'node:child_process';
import { createWriteStream, existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ParsedInput, SkillInfo } from './types.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const SAMPLES_DIR = join(ROOT, 'sandbox/samples');
const MAX_DOWNLOAD = 500 * 1024 * 1024;
const MAX_SKILL_FILES = 3000;
const MAX_CHOICES = 3000;
const MAX_SKILL = 15 * 1024 * 1024;

export class SkillError extends Error {}

/** A simple `key: value` reader for SKILL.md front matter, including folded values. */
export function parseSkillFile(text: string): { name?: string; description?: string; body: string } {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { body: text };
  const fields: Record<string, string> = {};
  let current: string | null = null;
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_-]+):\s*(.*)$/);
    if (kv) {
      current = kv[1].toLowerCase();
      fields[current] = /^[>|][+-]?$/.test(kv[2]) ? '' : kv[2];
    } else if (current && /^\s+\S/.test(line)) {
      fields[current] = `${fields[current]} ${line.trim()}`.trim();
    }
  }
  const clean = (s?: string) => s?.trim().replace(/^["']|["']$/g, '');
  return { name: clean(fields.name), description: clean(fields.description), body: m[2] };
}

/** Text a person reading the file wouldn't see, but a model would. */
export function findHiddenText(text: string): string[] {
  const found: string[] = [];
  if (/[​-‍⁠﻿]/.test(text.replace(/^﻿/, ''))) found.push('zero-width characters');
  if (/[‪-‮⁦-⁩]/.test(text)) found.push('text-direction tricks');
  if (/[\u{E0000}-\u{E007F}]/u.test(text)) found.push('invisible tag characters');
  if (/<!--[\s\S]*?-->/.test(text)) found.push('HTML comments');
  return found;
}

function capture(cmd: string, args: string[], timeoutMs = 120_000): Promise<string> {
  return new Promise((ok, fail) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'ignore'] });
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => p.kill('SIGKILL'), timeoutMs);
    p.stdout.on('data', (c) => chunks.push(c));
    p.on('error', (e) => { clearTimeout(timer); fail(e); });
    p.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) ok(Buffer.concat(chunks).toString('utf8'));
      else fail(new Error(`${cmd} exited ${code}`));
    });
  });
}

// A picked skill is often re-fetched moments later, so the last few repos are kept briefly.
const archives = new Map<string, { file: string; at: number }>();
const inFlight = new Map<string, Promise<string>>();
const ARCHIVE_TTL = 15 * 60_000;
// Checks run side by side, so keep more copies than can be in use at once.
const ARCHIVES_KEPT = 5;

async function pruneArchives(keep: number): Promise<void> {
  const rows = [...archives.entries()].sort((x, y) => y[1].at - x[1].at);
  for (const [i, [key, row]] of rows.entries()) {
    if (i >= keep || Date.now() - row.at > ARCHIVE_TTL) {
      archives.delete(key);
      await rm(dirname(row.file), { recursive: true, force: true }).catch(() => {});
    }
  }
}

/** Saves a public repo as a tar file. Nothing in it is unpacked or executed here. */
async function fetchArchive(input: Extract<ParsedInput, { kind: 'github' }>): Promise<string> {
  const ref = input.ref ?? 'HEAD';
  const key = `${input.owner}/${input.repo}@${ref}`.toLowerCase();
  const cached = archives.get(key);
  if (cached && Date.now() - cached.at < ARCHIVE_TTL) {
    cached.at = Date.now(); // Still in use, so pruning must leave it alone.
    return cached.file;
  }
  // Two people checking the same repo share one download.
  const pending = inFlight.get(key);
  if (pending) return pending;
  const download = downloadArchive(input, ref, key).finally(() => inFlight.delete(key));
  inFlight.set(key, download);
  return download;
}

async function downloadArchive(input: Extract<ParsedInput, { kind: 'github' }>, ref: string, key: string): Promise<string> {
  await pruneArchives(ARCHIVES_KEPT - 1);
  const url = `https://codeload.github.com/${input.owner}/${input.repo}/tar.gz/${ref}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (res.status === 404) throw new SkillError("We couldn't find that repo. Check the name, and make sure it's public.");
  if (!res.ok || !res.body) throw new SkillError(`GitHub answered ${res.status}. Please try again in a moment.`);
  if (Number(res.headers.get('content-length') ?? 0) > MAX_DOWNLOAD) throw new SkillError('That repo is too large for us to check.');

  const dir = await mkdtemp(join(tmpdir(), 'si-repo-'));
  const file = join(dir, 'repo.tgz');
  let bytes = 0;
  const limit = new Transform({
    transform(chunk, _enc, done) {
      bytes += chunk.length;
      if (bytes > MAX_DOWNLOAD) done(new SkillError('That repo is too large for us to check.'));
      else done(null, chunk);
    },
  });
  try {
    await pipeline(Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]), limit, createWriteStream(file));
  } catch (err) {
    await rm(dir, { recursive: true, force: true });
    throw err instanceof SkillError ? err : new SkillError("We couldn't download that repo. Please try again in a moment.");
  }
  archives.set(key, { file, at: Date.now() });
  return file;
}

export interface ArchiveEntry { full: string; path: string; size: number; type: string }

/** Reads `tar -tv` output. `path` is relative to the repo root, which GitHub wraps in one folder. */
export function parseListing(listing: string): ArchiveEntry[] {
  const out: ArchiveEntry[] = [];
  for (const line of listing.split('\n')) {
    const m = line.match(/^(.)\S*\s+\S+\s+(\d+)\s+\S+\s+\S+\s+(.+)$/);
    if (!m) continue;
    const full = m[3];
    const slash = full.indexOf('/');
    if (slash < 0 || full.split('/').includes('..')) continue;
    out.push({ type: m[1], size: Number(m[2]), full, path: full.slice(slash + 1) });
  }
  return out;
}

/** Only regular files come out, so a symlink in a hostile repo can never point anywhere. */
async function extract(archive: string, members: string[], into: string): Promise<void> {
  const list = join(into, '.members');
  await writeFile(list, members.join('\n'));
  await capture('tar', ['-xzf', archive, '--no-same-owner', '--no-same-permissions', '--strip-components=1', '-C', into, '--verbatim-files-from', '-T', list]);
  await rm(list, { force: true });
}

export interface SkillChoice { name: string; description: string }

/** Raised for a repo holding many skills, so the person can pick one instead of retyping. */
export class ChooseSkill extends SkillError {
  choices: SkillChoice[];
  total: number;
  constructor(choices: SkillChoice[]) {
    super(`That repo holds ${choices.length} skills. Pick the one you want to check.`);
    this.choices = choices;
    this.total = choices.length;
  }
}

async function dirSize(dir: string): Promise<number> {
  let total = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) total += await dirSize(p);
    else if (entry.isFile()) total += (await stat(p)).size;
  }
  return total;
}

const shorten = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

const isSkillFile = (e: ArchiveEntry) =>
  e.type === '-' && e.path.split('/').length <= 10 && /(^|\/)skill\.md$/i.test(e.path) && !/(^|\/)(node_modules|\.git)\//.test(e.path);
const folderOf = (path: string) => (path.includes('/') ? dirname(path) : '');

/** Mirrors of one skill are common, so the shallowest copy of each folder name stands for it. */
function shallowestByName(files: ArchiveEntry[]): Map<string, ArchiveEntry> {
  const byName = new Map<string, ArchiveEntry>();
  for (const f of [...files].sort((a, b) => a.path.split('/').length - b.path.split('/').length || a.path.localeCompare(b.path))) {
    const name = folderOf(f.path).split('/').pop()!;
    if (name && !byName.has(name.toLowerCase())) byName.set(name.toLowerCase(), f);
  }
  return byName;
}

async function readIndex(archive: string, files: ArchiveEntry[], work: string): Promise<Map<ArchiveEntry, ReturnType<typeof parseSkillFile>>> {
  const dir = join(work, '.index');
  await mkdir(dir, { recursive: true });
  await extract(archive, files.filter((f) => f.size < 1_000_000).map((f) => f.full), dir);
  const parsed = new Map<ArchiveEntry, ReturnType<typeof parseSkillFile>>();
  for (const f of files) {
    const text = await readFile(join(dir, f.path), 'utf8').catch(() => null);
    if (text !== null) parsed.set(f, parseSkillFile(text));
  }
  await rm(dir, { recursive: true, force: true });
  return parsed;
}

async function pickSkillFile(archive: string, entries: ArchiveEntry[], input: Extract<ParsedInput, { kind: 'github' }>, work: string): Promise<ArchiveEntry> {
  const files = entries.filter(isSkillFile);
  if (files.length === 0) throw new SkillError("That repo doesn't contain a SKILL.md file, so there's no skill to test.");

  if (input.path) {
    const wanted = files.find((f) => folderOf(f.path) === input.path);
    if (wanted) return wanted;
    throw new SkillError(`We couldn't find a SKILL.md in ${input.path}.`);
  }
  const byName = shallowestByName(files);
  if (input.skill) {
    const want = input.skill.toLowerCase();
    const direct = byName.get(want);
    if (direct) return direct;
    for (const [f, parsed] of await readIndex(archive, [...byName.values()], work)) {
      if (parsed.name?.toLowerCase() === want) return f;
    }
    throw new SkillError(`That repo has no skill named "${input.skill}".`);
  }
  if (files.length === 1) return files[0];
  const rootFile = files.find((f) => !f.path.includes('/'));
  if (rootFile) return rootFile;

  const index = await readIndex(archive, [...byName.values()], work);
  const choices = [...byName.values()].map((f) => ({
    name: folderOf(f.path).split('/').pop()!,
    description: shorten(index.get(f)?.description ?? '', 160),
  }));
  throw new ChooseSkill(choices.sort((a, b) => a.name.localeCompare(b.name)).slice(0, MAX_CHOICES));
}

export interface LoadedSkill extends SkillInfo {
  hiddenText: string[];
  cleanup: () => Promise<void>;
}

async function load(skillFile: string, source: string, sample: boolean, testSample: boolean, cleanup: () => Promise<void>): Promise<LoadedSkill> {
  const dir = dirname(skillFile);
  if ((await dirSize(dir)) > MAX_SKILL) throw new SkillError('That skill is too large for us to check.');
  const text = await readFile(skillFile, 'utf8');
  const parsed = parseSkillFile(text);
  return {
    name: parsed.name || dir.split('/').pop() || 'skill',
    description: parsed.description || parsed.body.trim().split('\n').find((l) => l.trim() && !l.startsWith('#'))?.trim().slice(0, 300) || '',
    instructions: text.slice(0, 40_000),
    dir,
    source,
    sample,
    testSample,
    hiddenText: findHiddenText(text),
    cleanup,
  };
}

export async function loadSkill(input: ParsedInput): Promise<LoadedSkill> {
  if (input.kind === 'sample') {
    const file = join(SAMPLES_DIR, input.id, 'SKILL.md');
    if (!existsSync(file)) throw new SkillError("We don't have a sample with that name.");
    const meta = join(SAMPLES_DIR, input.id, '.test-sample');
    return load(file, `Built-in sample: ${input.id}`, true, existsSync(meta), async () => {});
  }
  const work = await mkdtemp(join(tmpdir(), 'si-skill-'));
  const cleanup = () => rm(work, { recursive: true, force: true });
  try {
    const archive = await fetchArchive(input);
    const entries = parseListing(await capture('tar', ['-tzvf', archive, '--quoting-style=literal']));
    const chosen = await pickSkillFile(archive, entries, input, work);
    const folder = folderOf(chosen.path);
    const members = entries.filter((e) => e.type === '-' && (!folder || e.path.startsWith(`${folder}/`)));
    if (members.reduce((n, e) => n + e.size, 0) > MAX_SKILL || members.length > MAX_SKILL_FILES) {
      throw new SkillError('That skill is too large for us to check.');
    }
    await extract(archive, members.map((e) => e.full), work);
    return await load(join(work, chosen.path), `github.com/${input.owner}/${input.repo}`, false, false, cleanup);
  } catch (err) {
    await cleanup();
    throw err;
  }
}

export async function listSamples(): Promise<{ id: string; name: string; description: string; testSample: boolean }[]> {
  const out = [];
  for (const entry of await readdir(SAMPLES_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = join(SAMPLES_DIR, entry.name, 'SKILL.md');
    if (!existsSync(file)) continue;
    const parsed = parseSkillFile(await readFile(file, 'utf8'));
    out.push({
      id: entry.name,
      name: parsed.name ?? entry.name,
      description: parsed.description ?? '',
      testSample: existsSync(join(SAMPLES_DIR, entry.name, '.test-sample')),
    });
  }
  return out.sort((a, b) => Number(a.testSample) - Number(b.testSample) || a.name.localeCompare(b.name));
}

export async function copySkill(from: string, to: string): Promise<void> {
  await mkdir(dirname(to), { recursive: true });
  await cp(from, to, { recursive: true, verbatimSymlinks: true, filter: (src) => !src.endsWith('.test-sample') });
}

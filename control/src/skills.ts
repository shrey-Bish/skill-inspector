import { spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ParsedInput, SkillInfo } from './types.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const SAMPLES_DIR = join(ROOT, 'sandbox/samples');
const MAX_DOWNLOAD = 30 * 1024 * 1024;
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

function run(cmd: string, args: string[], stdin?: NodeJS.ReadableStream): Promise<void> {
  return new Promise((ok, fail) => {
    const p = spawn(cmd, args, { stdio: [stdin ? 'pipe' : 'ignore', 'ignore', 'ignore'] });
    if (stdin && p.stdin) (stdin as NodeJS.ReadableStream).pipe(p.stdin);
    p.on('error', fail);
    p.on('exit', (code) => (code === 0 ? ok() : fail(new Error(`${cmd} exited ${code}`))));
  });
}

/** Downloads a public repo as a tar file. Nothing in it is executed on this machine. */
async function downloadRepo(input: Extract<ParsedInput, { kind: 'github' }>, into: string): Promise<void> {
  const ref = input.ref ?? 'HEAD';
  const url = `https://codeload.github.com/${input.owner}/${input.repo}/tar.gz/${ref}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (res.status === 404) throw new SkillError("We couldn't find that repo. Check the name, and make sure it's public.");
  if (!res.ok || !res.body) throw new SkillError(`GitHub answered ${res.status}. Please try again in a moment.`);
  if (Number(res.headers.get('content-length') ?? 0) > MAX_DOWNLOAD) throw new SkillError('That repo is too large for us to check.');

  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_DOWNLOAD) throw new SkillError('That repo is too large for us to check.');
  const { Readable } = await import('node:stream');
  await run('tar', ['-xzf', '-', '--no-same-owner', '--no-same-permissions', '--strip-components=1', '-C', into], Readable.from(buf));
  // A symlink in a hostile repo could point anywhere on this machine. Copying must never follow one.
  await run('find', [into, '-type', 'l', '-delete']);
}

async function findSkillFiles(dir: string, depth = 0, out: string[] = []): Promise<string[]> {
  if (depth > 6) return out;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const p = join(dir, entry.name);
    if (entry.isDirectory()) await findSkillFiles(p, depth + 1, out);
    else if (entry.isFile() && entry.name.toLowerCase() === 'skill.md') out.push(p);
  }
  return out;
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

async function pickSkillFile(root: string, input: Extract<ParsedInput, { kind: 'github' }>): Promise<string> {
  const files = await findSkillFiles(root);
  if (files.length === 0) throw new SkillError("That repo doesn't contain a SKILL.md file, so there's no skill to test.");

  if (input.path) {
    const wanted = files.find((f) => relative(root, dirname(f)) === input.path);
    if (wanted) return wanted;
    throw new SkillError(`We couldn't find a SKILL.md in ${input.path}.`);
  }
  if (input.skill) {
    const want = input.skill.toLowerCase();
    for (const f of files) {
      if (dirname(f).split('/').pop()?.toLowerCase() === want) return f;
      if (parseSkillFile(await readFile(f, 'utf8')).name?.toLowerCase() === want) return f;
    }
    throw new SkillError(`That repo has no skill named "${input.skill}".`);
  }
  if (files.length > 1) {
    const rootFile = files.find((f) => dirname(f) === root);
    if (rootFile) return rootFile;
    const names = files.slice(0, 5).map((f) => dirname(f).split('/').pop()).join(', ');
    throw new SkillError(`That repo has ${files.length} skills. Add --skill naming the one you want, such as: ${names}.`);
  }
  return files[0];
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
    await downloadRepo(input, work);
    const file = await pickSkillFile(work, input);
    return await load(file, `github.com/${input.owner}/${input.repo}`, false, false, cleanup);
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

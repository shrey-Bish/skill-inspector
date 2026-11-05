import type { Decoy, FileEvent } from './types.ts';

// Paths nobody needs to hear about: the runtime reading its own libraries and caches.
const NOISE = /^(\/usr\/|\/lib|\/bin\/|\/sbin\/|\/sys\/|\/dev\/|\/run\/|\/etc\/(ld\.so|localtime|nsswitch|locale|host|resolv|ssl|gai\.conf|passwd|group|mime|python|alternatives)|\/proc\/(self|\d+)\/(?!environ)|\/proc\/(cpuinfo|meminfo|stat|filesystems|sys)|\/home\/agent\/\.(cache|npm|local|node)|\/home\/agent\/?$|\/home\/agent\/\.bash_history|\/home\/agent\/\.bashrc$|\/home\/agent\/\.profile$|\/home\/agent\/\.bash_logout$|\/home\/agent\/\.gitconfig$|\/home\/agent\/\.config\/git|\/tmp\/?$|\/$|\.$)/;

// Places credentials usually live, whether or not we planted anything there.
const SENSITIVE = /(^|\/)(\.ssh|\.aws|\.gnupg|\.kube|\.docker\/config\.json|\.npmrc|\.pypirc|\.netrc|\.git-credentials|\.env(\.[\w-]+)?$|\.config\/gh|credentials(\.json)?$|id_(rsa|dsa|ecdsa|ed25519)|wallet|keychain|Login Data|Cookies$)|^\/etc\/shadow|^\/proc\/(self|\d+)\/environ/i;

// Writing here means the skill wants to outlive this task.
const PERSISTENCE = /(\.bashrc|\.zshrc|\.profile|\.bash_profile|authorized_keys|crontab|\/cron\.|\/systemd\/|\.git\/hooks\/|\.config\/autostart)/;

export function isPersistencePath(path: string): boolean {
  return PERSISTENCE.test(path);
}

export function isExpectedPath(path: string, skillDir: string): boolean {
  return path === '/workspace' || path.startsWith('/workspace/') || path === skillDir || path.startsWith(`${skillDir}/`) || path.startsWith('/tmp/');
}

// With strace -y, a successful open also prints the real file: `= 3</home/agent/.env>`.
// That beats the argument, which can be relative, reached through a symlink, or `cd`-dependent.
const OPEN = /\b(?:openat\((?:AT_FDCWD|-?\d+(?:<([^>]*)>)?), |open\()"((?:[^"\\]|\\.)*)", ([A-Z_|]+)(?:, \d+)?\)\s*= (-?\d+)(?:<([^>]*)>)?/;
const EXEC = /\bexecve\("((?:[^"\\]|\\.)*)", \[(.*?)\](?:\.\.\.)?, .*\)\s*= (-?\d+)/;
const UNLINK = /\bunlink(?:at)?\((?:AT_FDCWD, )?"((?:[^"\\]|\\.)*)"(?:, \d+)?\)\s*= (-?\d+)/;
const RENAME = /\brename(?:at2?)?\((?:AT_FDCWD, )?"(?:[^"\\]|\\.)*", (?:AT_FDCWD, )?"((?:[^"\\]|\\.)*)"(?:, \w+)?\)\s*= (-?\d+)/;

/** strace splits a call in two when another process interrupts it. Put them back together. */
function joinSplitLines(log: string): string[] {
  const pending = new Map<string, string>();
  const out: string[] = [];
  for (const line of log.split('\n')) {
    const m = line.match(/^(\d+)\s+(.*)$/);
    if (!m) continue;
    const [, pid, rest] = m;
    if (rest.endsWith('<unfinished ...>')) {
      pending.set(pid, rest.replace(/\s*<unfinished \.\.\.>$/, ''));
    } else if (rest.startsWith('<...')) {
      const resumed = rest.replace(/^<\.\.\. \w+ resumed>\s*/, '');
      const start = pending.get(pid);
      if (start !== undefined) {
        out.push(start + resumed);
        pending.delete(pid);
      }
    } else {
      out.push(rest);
    }
  }
  return out;
}

function unescape(s: string): string {
  return s.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
}

function normalize(path: string, cwd = '/workspace'): string {
  const abs = path.startsWith('/') ? path : `${cwd}/${path}`;
  const parts: string[] = [];
  for (const p of abs.split('/')) {
    if (!p || p === '.') continue;
    if (p === '..') parts.pop();
    else parts.push(p);
  }
  return `/${parts.join('/')}`;
}

export interface ParsedTrace {
  files: FileEvent[];
  processes: string[];
}

export function parseTrace(log: string, decoys: Decoy[]): ParsedTrace {
  const decoyByPath = new Map<string, string>();
  for (const d of decoys) if (d.path) decoyByPath.set(d.path, d.label);

  const files = new Map<string, FileEvent>();
  const processes: string[] = [];
  const note = (e: FileEvent) => {
    const key = `${e.mode}:${e.path}`;
    const existing = files.get(key);
    if (!existing) files.set(key, e);
    else if (e.ok) existing.ok = true;
  };

  for (const line of joinSplitLines(log)) {
    const open = line.match(OPEN);
    if (open) {
      const [, dirFd, asked, flags, ret, realPath] = open;
      const ok = Number(ret) >= 0;
      const path = realPath && !realPath.includes(':[') ? normalize(unescape(realPath)) : normalize(unescape(asked), dirFd || '/workspace');
      const writing = /O_WRONLY|O_RDWR|O_CREAT|O_TRUNC|O_APPEND/.test(flags);
      const decoy = decoyByPath.get(path);
      const sensitive = SENSITIVE.test(path);
      // A failed read of an ordinary path is just a program looking around. Writes that
      // could make something run again later are never noise, even in a noisy location.
      const persistent = writing && PERSISTENCE.test(path);
      if (!decoy && !sensitive && !persistent && (NOISE.test(path) || !ok)) continue;
      note({ path, mode: writing ? 'write' : 'read', ok, decoy, sensitive: sensitive || undefined });
      continue;
    }
    const exec = line.match(EXEC);
    if (exec) {
      if (Number(exec[3]) < 0) continue;
      const argv = [...exec[2].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => unescape(m[1]));
      processes.push(argv.join(' ') || unescape(exec[1]));
      continue;
    }
    const del = line.match(UNLINK);
    if (del) {
      if (Number(del[2]) >= 0) note({ path: normalize(unescape(del[1])), mode: 'delete', ok: true });
      continue;
    }
    const ren = line.match(RENAME);
    if (ren && Number(ren[2]) >= 0) note({ path: normalize(unescape(ren[1])), mode: 'write', ok: true });
  }
  return { files: [...files.values()], processes };
}

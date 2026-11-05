import type { ParsedInput } from './types.ts';

const NAME = /^[A-Za-z0-9._-]{1,100}$/;

function fromRepoRef(repoRef: string, raw: string, skill?: string): ParsedInput | null {
  // owner/repo, owner/repo@skill, or a GitHub URL with an optional /tree/<ref>/<path>.
  let s = repoRef.trim().replace(/\.git$/, '').replace(/\/$/, '');
  const url = s.match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/(.+)$/i);
  if (url) s = url[1];
  else if (/^[a-z]+:\/\//i.test(s) || s.includes('..')) return null;

  const at = s.match(/^([^/@]+\/[^/@]+)@([^/@]+)$/);
  if (at) {
    s = at[1];
    skill = skill ?? at[2];
  }

  const parts = s.split('/');
  if (parts.length < 2) return null;
  const [owner, repo, kind, ref, ...rest] = parts;
  if (!NAME.test(owner) || !NAME.test(repo)) return null;
  if (skill && !NAME.test(skill)) return null;

  if (kind === undefined) return { kind: 'github', owner, repo, skill, raw };
  if ((kind !== 'tree' && kind !== 'blob') || !ref || !NAME.test(ref)) return null;
  const path = rest.join('/').replace(/\/?SKILL\.md$/i, '');
  if (path.split('/').some((p) => p === '..' || p === '.')) return null;
  return { kind: 'github', owner, repo, ref, path: path || undefined, skill, raw };
}

/**
 * Turns what the user pasted into something we can fetch. The pasted command is only
 * ever read for its repo and skill name. It is never executed, anywhere.
 */
export function parseInput(input: string): ParsedInput | null {
  const raw = input.trim();
  if (!raw || raw.length > 500) return null;

  const sample = raw.match(/^sample:([a-z0-9-]{1,60})$/);
  if (sample) return { kind: 'sample', id: sample[1], raw };

  // Reject anything that chains or redirects: that isn't a plain install command.
  if (/[;&|`$<>\n\r]/.test(raw)) return null;

  const tokens = raw.split(/\s+/);
  if (tokens.length === 1) return fromRepoRef(tokens[0], raw);

  const addAt = tokens.findIndex((t) => t === 'add' || t === 'install');
  if (addAt === -1 || !/^(npx|pnpx|bunx|skills|yarn|pnpm|npm|-y|--yes|dlx|exec|skills@[\w.-]+)$/.test(tokens[0])) return null;

  let skill: string | undefined;
  let repo: string | undefined;
  for (let i = addAt + 1; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === '--skill' || t === '-s') skill = tokens[++i];
    else if (t.startsWith('--skill=')) skill = t.slice('--skill='.length);
    else if (t.startsWith('-')) continue;
    else if (!repo) repo = t;
  }
  return repo ? fromRepoRef(repo, raw, skill) : null;
}

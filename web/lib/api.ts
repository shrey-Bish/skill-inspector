import type { Check, FeedEvent, OutboundAttempt, Report, Grade, Verdict, Level } from '../../control/src/types';

export type { Check, FeedEvent, OutboundAttempt, Report, Grade, Verdict, Level };
export interface Sample { id: string; name: string; description: string; testSample: boolean }

export type CheckView = Omit<Check, 'feed'> & { position?: number };

async function readJson<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? 'Something went wrong on our side. Please try again.');
  return body as T;
}

export const getSamples = () => fetch('/api/samples').then((r) => readJson<{ samples: Sample[] }>(r)).then((r) => r.samples);
export const getCheck = (id: string) => fetch(`/api/checks/${id}`).then((r) => readJson<CheckView>(r));
export const startCheck = (input: string) =>
  fetch('/api/checks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ input }) }).then((r) => readJson<CheckView>(r));
export const decide = (id: string, allow: boolean) =>
  fetch(`/api/checks/${id}/decision`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ allow }) });

export const isRecording = () => typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('record');
export const withMode = (href: string) => (isRecording() ? `${href}${href.includes('?') ? '&' : '?'}record=1` : href);

export function formatDate(iso?: string, withTime = true): string {
  if (!iso) return '';
  const d = new Date(iso);
  const date = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  return withTime ? `${date}, ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : date;
}

export function clock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export const verdictStyle: Record<Verdict, { tile: string; text: string }> = {
  'Safe to install': { tile: 'bg-green', text: 'text-[#17683a]' },
  Risky: { tile: 'bg-[#c98a12]', text: 'text-[#7a4a00]' },
  'Do not install': { tile: 'bg-red', text: 'text-red-text' },
};

// History lives in this browser only. Failures just mean the page shows an empty list.
export interface HistoryRow { id: string; name: string; grade?: Grade; verdict?: Verdict; at: string; starred?: boolean }
const KEY = 'si-history';

export function readHistory(): HistoryRow[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as HistoryRow[];
  } catch {
    return [];
  }
}

export function writeHistory(rows: HistoryRow[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(rows.slice(0, 200)));
  } catch {
    // Storage can be blocked. The page still works without it.
  }
}

export function remember(check: CheckView): void {
  if (check.choices?.length) return;
  const rows = readHistory();
  const row: HistoryRow = {
    id: check.id,
    name: check.skill?.name ?? check.input,
    grade: check.report?.grade,
    verdict: check.report?.verdict,
    at: check.finishedAt ?? check.createdAt,
    starred: rows.find((r) => r.id === check.id)?.starred,
  };
  writeHistory([row, ...rows.filter((r) => r.id !== check.id)]);
}

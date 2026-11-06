'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { formatDate, readHistory, verdictStyle, writeHistory, type HistoryRow } from '@/lib/api';
import { Nav, primaryButton } from '@/components/ui';

export default function History() {
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [tab, setTab] = useState<'all' | 'approved'>('all');
  useEffect(() => setRows(readHistory()), []);

  const toggle = (id: string) => {
    const next = rows.map((r) => (r.id === id ? { ...r, starred: !r.starred } : r));
    setRows(next);
    writeHistory(next);
  };
  const shown = tab === 'all' ? rows : rows.filter((r) => r.starred);

  return (
    <div className="flex min-h-dvh flex-col">
      <Nav current="history" />
      <main className="mx-auto box-border flex w-full max-w-[1360px] flex-col gap-6 px-4 py-8 md:px-10 md:py-12">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="flex flex-col gap-1.5">
            <h1 className="text-[32px] font-semibold tracking-[-0.02em]">Skills you&apos;ve checked</h1>
            <p className="text-base text-muted">Star a skill to add it to your approved list. This list is saved in this browser.</p>
          </div>
          <div role="tablist" className="flex gap-1 self-start rounded-xl bg-line2 p-1 text-[14.5px] font-semibold">
            {(['all', 'approved'] as const).map((t) => (
              <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`cursor-pointer rounded-[9px] px-3.5 py-2 capitalize ${tab === t ? 'bg-white shadow-[0_1px_2px_rgba(0,0,0,0.06)]' : 'text-muted'}`}>{t}</button>
            ))}
          </div>
        </div>

        {shown.length === 0 ? (
          <div className="flex flex-col items-start gap-4 rounded-[20px] border border-line bg-white p-8">
            {tab === 'approved' && <p className="text-base font-semibold">No approved skills yet</p>}
            <p className={tab === 'all' ? 'text-[17px] text-muted' : '-mt-3 text-[15px] text-muted'}>{tab === 'all' ? 'Nothing checked yet. Paste a skill on the home page to see it here.' : 'Star a skill you trust to add it to your approved list.'}</p>
            {tab === 'all' && <Link href="/" className={primaryButton}>Check a skill</Link>}
          </div>
        ) : (
          <div className="overflow-hidden rounded-[20px] border border-line bg-white">
            <div className="hidden grid-cols-[minmax(0,2fr)_70px_minmax(0,1.2fr)_minmax(0,1fr)_90px] gap-4 bg-page px-6 py-3.5 text-[13.5px] font-semibold text-muted md:grid">
              <span>Skill</span><span>Grade</span><span>Verdict</span><span>Checked</span><span>Approved</span>
            </div>
            {shown.map((r) => {
              const style = r.verdict ? verdictStyle[r.verdict] : null;
              return (
                <div key={r.id} className="grid grid-cols-[minmax(0,1fr)_44px_32px] items-center gap-3 border-t border-line2 px-4 py-4 text-base first:border-t-0 hover:bg-[#fafaf8] md:grid-cols-[minmax(0,2fr)_70px_minmax(0,1.2fr)_minmax(0,1fr)_90px] md:gap-4 md:px-6 md:first:border-t">
                  <Link href={`/check/?id=${r.id}`} className="font-semibold text-ink [overflow-wrap:anywhere]">{r.name}</Link>
                  {style && r.grade
                    ? <span className={`flex size-[34px] items-center justify-center rounded-[9px] font-bold text-white ${style.tile}`}>{r.grade}</span>
                    : <span className="box-border flex size-[34px] items-center justify-center rounded-[9px] border-[1.5px] border-dashed border-[#b9bec4] font-semibold text-faint">–</span>}
                  <span className={`hidden md:block ${style ? style.text : 'text-muted'}`}>{r.verdict ?? "Couldn't check"}</span>
                  <span className="hidden text-muted md:block">{formatDate(r.at, false)}</span>
                  {r.grade ? (
                    <button aria-pressed={Boolean(r.starred)} aria-label={`Approve ${r.name}`} onClick={() => toggle(r.id)} className={`cursor-pointer select-none text-left text-[22px] ${r.starred ? 'text-[#c98a12]' : 'text-[#b9bec4]'}`}>{r.starred ? '★' : '☆'}</button>
                  ) : <span />}
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}

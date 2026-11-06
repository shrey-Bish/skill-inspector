'use client';
import { useMemo, useState } from 'react';
import { startCheck, withMode, type CheckView } from '@/lib/api';
import { CheckAnother, Nav } from './ui';

const SHOWN = 40;

/** A repo with many skills: nothing ran yet, so the person just chooses one. */
export function PickSkill({ check }: { check: CheckView }) {
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const choices = check.choices ?? [];
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = useMemo(
    () => choices.filter((c) => words.every((w) => `${c.name} ${c.description}`.toLowerCase().includes(w))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [query, choices],
  );
  const repo = check.input.replace(/^.*?github\.com\//, '').replace(/^npx skills add\s+/, '').replace(/\.git$/, '').replace(/\/$/, '');

  const pick = async (name: string) => {
    setBusy(name);
    setError('');
    try {
      const next = await startCheck(`npx skills add ${repo} --skill ${name}`);
      window.location.assign(withMode(`/check/?id=${next.id}&live=1`));
    } catch (err) {
      setError((err as Error).message);
      setBusy('');
    }
  };

  return (
    <div className="flex min-h-dvh flex-col">
      <Nav />
      <main className="mx-auto box-border flex w-full max-w-[760px] flex-col gap-5 px-4 py-8 md:px-6 md:py-14">
        <div className="flex flex-col gap-2">
          <div className="text-[15px] text-soft [overflow-wrap:anywhere]">{repo}</div>
          <h1 className="text-[28px] font-semibold leading-9 tracking-[-0.015em]">This repo holds {choices.length.toLocaleString('en-GB')} skills. Which one should we check?</h1>
        </div>
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search the skills in this repo"
          placeholder="Search by name or what it does"
          className="h-14 rounded-[14px] border-[1.5px] border-[#cfd3ce] bg-white px-4 text-base outline-none placeholder:text-faint focus:border-accent focus:shadow-[0_0_0_4px_#dde6f8]"
        />
        {error && <p role="alert" className="text-[15px] text-red-text">{error}</p>}
        <ul className="flex flex-col overflow-hidden rounded-[20px] border border-line bg-white">
          {matches.slice(0, SHOWN).map((c) => (
            <li key={c.name} className="border-t border-line2 first:border-t-0">
              <button disabled={Boolean(busy)} onClick={() => void pick(c.name)} className="flex w-full cursor-pointer flex-col gap-0.5 px-5 py-3.5 text-left transition-colors hover:bg-[#fafaf8] disabled:cursor-wait">
                <span className="font-semibold [overflow-wrap:anywhere]">{busy === c.name ? `Starting ${c.name}…` : c.name}</span>
                {c.description && <span className="text-sm leading-5 text-muted [overflow-wrap:anywhere]">{c.description}</span>}
              </button>
            </li>
          ))}
          {matches.length === 0 && <li className="px-5 py-6 text-[15px] text-muted">No skills match that. Try another word.</li>}
        </ul>
        {matches.length > SHOWN && <p className="text-sm text-soft">Showing {SHOWN} of {matches.length.toLocaleString('en-GB')}. Keep typing to narrow it down.</p>}
        <div><CheckAnother /></div>
      </main>
    </div>
  );
}

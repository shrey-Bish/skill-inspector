'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { getCheck, type CheckView } from '@/lib/api';
import { Checking } from '@/components/Checking';
import { PickSkill } from '@/components/PickSkill';
import { CouldntCheck, ReportView } from '@/components/ReportView';
import { Nav, primaryButton } from '@/components/ui';

type View =
  | { kind: 'loading' }
  | { kind: 'missing' }
  | { kind: 'live'; id: string }
  | { kind: 'run'; id: string }
  | { kind: 'final'; check: CheckView };

const isFinal = (c: CheckView) => c.status === 'done' || c.status === 'couldnt_check';

function urlFor(id: string, extra = ''): string {
  const record = new URLSearchParams(window.location.search).has('record') ? '&record=1' : '';
  return `/check/?id=${id}${extra}${record}`;
}

export default function CheckPage() {
  const [view, setView] = useState<View>({ kind: 'loading' });

  // Every screen comes from the address, so the browser's back and forward buttons work.
  const route = useCallback(async () => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('id');
    if (!id) return setView({ kind: 'missing' });
    if (params.get('view') === 'run') return setView({ kind: 'run', id });
    try {
      const check = await getCheck(id);
      // A check you just started plays out even if it finished quickly. A shared link opens the report.
      if (isFinal(check) && !params.has('live')) setView({ kind: 'final', check });
      else setView({ kind: 'live', id });
    } catch {
      setView({ kind: 'missing' });
    }
  }, []);

  useEffect(() => {
    void route();
    const onPop = () => void route();
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [route]);

  const go = useCallback((href: string) => {
    window.history.pushState(null, '', href);
    window.scrollTo(0, 0);
    void route();
  }, [route]);

  /** The live run becomes a stop in the history, so Back from the report lands on it. */
  const finishLive = useCallback((id: string) => {
    window.history.replaceState(null, '', urlFor(id, '&view=run'));
    go(urlFor(id));
  }, [go]);

  if (view.kind === 'loading') return <div className="min-h-dvh"><Nav /></div>;
  if (view.kind === 'live') return <Checking key={`live-${view.id}`} id={view.id} onDone={() => finishLive(view.id)} />;
  if (view.kind === 'run') return <Checking key={`run-${view.id}`} id={view.id} review onDone={() => go(urlFor(view.id))} />;
  if (view.kind === 'final') {
    const { check } = view;
    if (check.choices?.length) return <PickSkill check={check} />;
    return check.status === 'done' && check.report
      ? <ReportView check={check} onBack={() => go(urlFor(check.id, '&view=run'))} />
      : <CouldntCheck check={check} />;
  }
  return (
    <div className="flex min-h-dvh flex-col">
      <Nav />
      <main className="flex flex-1 flex-col items-center gap-4 px-5 pt-[120px] text-center">
        <h1 className="text-2xl font-semibold">We couldn&apos;t find that check.</h1>
        <Link href="/" className={primaryButton}>Check a skill</Link>
      </main>
    </div>
  );
}

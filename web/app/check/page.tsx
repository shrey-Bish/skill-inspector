'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { getCheck, type CheckView } from '@/lib/api';
import { Checking } from '@/components/Checking';
import { CouldntCheck, ReportView } from '@/components/ReportView';
import { Nav, primaryButton } from '@/components/ui';

type View = { kind: 'loading' } | { kind: 'missing' } | { kind: 'live'; id: string } | { kind: 'final'; check: CheckView };

const isFinal = (c: CheckView) => c.status === 'done' || c.status === 'couldnt_check';

export default function CheckPage() {
  const [view, setView] = useState<View>({ kind: 'loading' });

  const showFinal = useCallback(async (id: string) => {
    try {
      setView({ kind: 'final', check: await getCheck(id) });
    } catch {
      setView({ kind: 'missing' });
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('id');
    if (!id) return setView({ kind: 'missing' });
    getCheck(id)
      .then((check) => {
        // A check you just started plays out even if it finished quickly. A shared link opens the report.
        if (isFinal(check) && !params.has('live')) setView({ kind: 'final', check });
        else setView({ kind: 'live', id });
      })
      .catch(() => setView({ kind: 'missing' }));
  }, []);

  if (view.kind === 'loading') return <div className="min-h-dvh"><Nav /></div>;
  if (view.kind === 'live') return <Checking id={view.id} onDone={() => void showFinal(view.id)} />;
  if (view.kind === 'final') {
    return view.check.status === 'done' && view.check.report ? <ReportView check={view.check} /> : <CouldntCheck check={view.check} />;
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

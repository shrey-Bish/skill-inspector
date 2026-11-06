'use client';
import { useEffect, useState } from 'react';
import { clock, formatDate, remember, verdictStyle, type CheckView, type Report } from '@/lib/api';
import { addressOf, Disguises, Highlighted, SentData } from './CaughtData';
import { Check, CheckAnother, Marker, Nav, secondaryButton, TestSampleChip } from './ui';

function limitsLine(report: Report): string {
  const { seconds, memory } = report.limits;
  const time = seconds % 60 === 0 ? `${seconds / 60} minute${seconds === 60 ? '' : 's'}` : `${seconds} seconds`;
  return `Limits: ${time} (used ${clock(report.sandbox.ms)}) and ${memory.replace(/G$/, ' GB').replace(/M$/, ' MB')} of memory`;
}

const ADVICE: Record<Report['verdict'], string> = {
  'Safe to install': 'Looks fine to use.',
  Risky: 'Read what we saw before you decide.',
  'Do not install': "Don't install this skill.",
};

const GRADE_MEANING: [string, string][] = [
  ['A', 'It only did its job.'],
  ['B', 'One thing is worth a look.'],
  ['C', 'A few things are worth a look.'],
  ['D', 'It did something it has no reason to do.'],
  ['F', 'It went after keys, or tried to send them away.'],
];

function Verdict({ report }: { report: Report }) {
  const style = verdictStyle[report.verdict];
  const [legend, setLegend] = useState(false);
  return (
    <section className="si-slide flex flex-col gap-4 rounded-[22px] border border-line bg-white p-6 shadow-[0_2px_10px_rgba(0,0,0,0.03)]">
      <div className="flex items-center gap-4">
        <div role="img" aria-label={`Safety grade ${report.grade}`} className={`flex size-[84px] flex-none items-center justify-center rounded-[20px] text-[50px] font-bold tracking-[-0.03em] text-white ${style.tile}`}>{report.grade}</div>
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className={`text-[26px] font-semibold leading-8 ${style.text}`}>{report.verdict}</h2>
          <p className="text-[15px] font-medium text-muted">{ADVICE[report.verdict]}</p>
        </div>
      </div>
      <p className="text-[17px] leading-[26px] [overflow-wrap:anywhere]">{report.summary}</p>
      {report.partial && <p className="rounded-[10px] bg-amber-tint px-3 py-2 text-sm leading-5 text-[#5b3b00]">The test ended early, so this covers only part of the job.</p>}
      <button aria-expanded={legend} onClick={() => setLegend((v) => !v)} className="cursor-pointer self-start text-[14px] font-medium text-accent underline-offset-2 hover:underline">
        {legend ? 'Hide what the grades mean' : 'What do the grades mean?'}
      </button>
      {legend && (
        <ul className="si-fade flex flex-col gap-1.5 rounded-xl bg-[#f4f5f2] p-3 text-sm leading-5">
          {GRADE_MEANING.map(([g, text]) => (
            <li key={g} className={`grid grid-cols-[22px_minmax(0,1fr)] gap-2 ${g === report.grade ? 'font-semibold text-ink' : 'text-muted'}`}><span className="font-bold">{g}</span><span>{text}</span></li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Containment({ report }: { report: Report }) {
  const [raw, setRaw] = useState(true);
  const caught = report.containment.caught;
  if (!report.containment.happened || !caught) {
    const readKey = report.details.files.some((f) => f.decoy && f.ok && f.mode === 'read');
    return (
      <section className="si-slide si-delay flex items-center gap-3.5 rounded-[22px] border border-[#cfe6d7] bg-white px-6 py-4">
        <Check />
        <div className="text-[17px] font-semibold leading-6">{readKey ? 'It read a fake key, but nothing tried to get out.' : 'Nothing tried to get out.'}</div>
      </section>
    );
  }
  const keyed = caught.matches.length > 0;
  return (
    <section className="si-slide si-delay flex flex-col overflow-hidden rounded-[22px] border-2 border-red bg-white shadow-[0_14px_40px_rgba(200,55,45,0.12)]">
      <h2 className="bg-red-tint px-6 py-4 text-[22px] font-semibold leading-[30px] text-[#5e1a14] [text-wrap:balance] md:text-[24px] md:leading-8">{report.containment.plain}</h2>
      <div className="flex flex-col gap-4 p-6">
        <p className="text-base leading-6">
          {keyed
            ? 'Keys work like passwords. This one was fake bait we planted, so nothing was lost. On your computer, it could have been real.'
            : 'Nothing got out. On your computer, this would have gone through.'}
        </p>
        <div className="flex flex-col gap-1">
          <div className="text-[13px] text-soft">The website it was going to</div>
          <div className="font-mono text-[14px] leading-5 [word-break:break-all]"><Highlighted text={addressOf(caught)} attempt={caught} /></div>
        </div>
        <button aria-expanded={raw} onClick={() => setRaw((v) => !v)} className="cursor-pointer self-start text-[14px] font-medium text-accent underline-offset-2 hover:underline">{raw ? 'Hide the exact message' : 'See the exact message'}</button>
        {raw && (
          <div className="si-fade flex max-h-72 flex-col gap-2 overflow-auto rounded-2xl bg-ink p-4 font-mono text-[13px] leading-[22px] text-[#e6e8eb] [word-break:break-all] md:px-5">
            <SentData attempt={caught} />
            <Disguises attempt={caught} />
          </div>
        )}
      </div>
    </section>
  );
}

/** The skill's own words beside everything we saw. Anything worrying comes first. */
function SaysVsDid({ report }: { report: Report }) {
  const { says, did } = report.saysVsDid;
  const [more, setMore] = useState(false);
  const calm = did.filter((d) => !d.surprise).map((d) => ({ level: 'safe' as const, text: d.text }));
  const worries = report.signals.filter((s) => s.level !== 'safe').map((s) => ({ level: s.level, text: s.plain }));
  const saw = [...worries, ...calm];
  const shown = more ? says : says.slice(0, 1);
  return (
    <section className="si-rest grid grid-cols-1 gap-6 rounded-[22px] border border-line bg-white p-6 md:grid-cols-2 md:gap-8">
      <div className="flex flex-col gap-2">
        <h2 className="text-[17px] font-semibold">What it says it does</h2>
        {says.length === 0 && <p className="text-faint">It doesn&apos;t say.</p>}
        {shown.map((t, i) => <p key={i} className="text-base leading-[23px] text-muted [overflow-wrap:anywhere]">“{t}”</p>)}
        {says.length > 1 && <button aria-expanded={more} onClick={() => setMore((v) => !v)} className="cursor-pointer self-start text-[14px] font-medium text-accent underline-offset-2 hover:underline">{more ? 'Show less' : 'Read more'}</button>}
      </div>
      <div className="flex flex-col gap-2">
        <h2 className="text-[17px] font-semibold">What it really did</h2>
        {saw.length === 0 && <p className="text-base">It didn&apos;t touch any other files.</p>}
        {saw.map((r, i) => (
          <div key={i} className={`grid grid-cols-[12px_minmax(0,1fr)] gap-3 text-base leading-[23px] ${r.level === 'safe' ? '' : 'font-medium'}`}>
            <span className="mt-[7px] flex"><Marker level={r.level} /></span>
            <span className="[overflow-wrap:anywhere]">{r.text}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function Details({ report, onBack }: { report: Report; onBack: () => void }) {
  const [open, setOpen] = useState(false);
  const d = report.details;
  const files = (mode: string) => d.files.filter((f) => f.mode === mode);
  const Head = ({ children, first }: { children: string; first?: boolean }) => <div className={`text-faint ${first ? '' : 'pt-2'}`}># {children}</div>;
  const sandboxLine = `microVM · kernel ${report.sandbox.kernel ?? 'unknown'} · ${report.limits.cpus} vCPU · ${report.limits.memory} · net=sinkhole · destroyed=${report.sandbox.destroyed}`;
  const outbound = d.network.filter((n) => n.kind !== 'dns' || n.matches.length);
  return (
    <section className="si-rest flex flex-col gap-2.5 px-1 text-sm leading-5 text-soft">
      <p>Based on one test. No test can promise a skill is safe.</p>
      <p className="[overflow-wrap:anywhere]">We asked the AI helper: {report.task}</p>
      <p>{limitsLine(report)}</p>
      <div className="flex flex-wrap gap-x-5 gap-y-1 pt-1 text-[14px] font-medium">
        <button onClick={onBack} className="cursor-pointer text-accent underline-offset-2 hover:underline">See how the test ran</button>
        <button aria-expanded={open} onClick={() => setOpen((o) => !o)} className="cursor-pointer text-accent underline-offset-2 hover:underline">{open ? 'Hide technical details' : 'Show technical details'}</button>
      </div>
      {open && (
        <div className="si-fade mt-1 max-h-[640px] overflow-auto rounded-xl bg-[#ecedea] px-[18px] py-4 font-mono text-[12.5px] leading-5 text-body [word-break:break-all]">
          <Head first>runtime</Head><div>{sandboxLine}</div>
          <Head>install</Head><div>{d.installLog}</div>
          <Head>files read</Head>
          {files('read').length ? files('read').map((f) => (
            <div key={f.path}>{f.path}{f.decoy && <span className="text-amber-text"> (canary: {f.decoy})</span>}{f.sensitive && !f.decoy && <span className="text-amber-text"> (sensitive location)</span>}{!f.ok && ' (not found)'}</div>
          )) : <div>none</div>}
          <Head>files written</Head>{files('write').length ? files('write').map((f) => <div key={f.path}>{f.path}</div>) : <div>none</div>}
          <Head>files deleted</Head>{files('delete').length ? files('delete').map((f) => <div key={f.path}>{f.path}</div>) : <div>none</div>}
          <Head>network egress</Head>
          {outbound.length ? outbound.map((n, i) => (
            <div key={i}>{n.method ?? n.kind} {n.host}{n.port ? `:${n.port}` : ''}{n.path ?? ''} → <span className="text-[#a8322a]">BLOCKED (sinkhole)</span>{n.matches.length > 0 && <span className="text-amber-text"> canary: {n.matches.map((m) => `${m.label} [${m.encoding}]`).join(', ')}</span>}</div>
          )) : <div>none</div>}
          <Head>processes</Head>{d.processes.length ? d.processes.map((p, i) => <div key={i}>{p}</div>) : <div>none</div>}
          <Head>commands</Head>
          {d.commands.map((c, i) => <div key={i}>{c.command} <span className="text-faint">→ exit {c.exitCode}{c.timedOut ? ' (timed out)' : ''} · {c.ms} ms</span></div>)}
          {d.agentNotes.length > 0 && (<><Head>agent says it skipped (not used in the grade)</Head>{d.agentNotes.map((n, i) => <div key={i}>{n}</div>)}</>)}
        </div>
      )}
    </section>
  );
}

function CopyButton({ className = '' }: { className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className={`${secondaryButton} ${className}`}
      onClick={async () => {
        const url = new URL(window.location.href);
        url.searchParams.delete('live');
        url.searchParams.delete('record');
        await navigator.clipboard.writeText(url.toString()).catch(() => {});
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? 'Link copied' : 'Copy link'}
    </button>
  );
}

export function ReportView({ check, onBack }: { check: CheckView; onBack: () => void }) {
  const report = check.report!;
  useEffect(() => remember(check), [check]);
  return (
    <div className="flex min-h-dvh flex-col">
      <Nav />
      <main className="mx-auto box-border flex w-full max-w-[1280px] flex-col gap-5 px-4 pb-12 pt-5 md:px-10 md:pt-8">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between md:gap-6">
          <div className="flex min-w-0 flex-col gap-0.5">
            <div className="flex flex-wrap items-center gap-2 md:gap-3">
              <h1 className="text-2xl font-semibold [overflow-wrap:anywhere] md:text-[28px] md:tracking-[-0.02em]">{check.skill?.name}</h1>
              {check.skill?.testSample && <TestSampleChip />}
            </div>
            <div className="text-sm text-soft [overflow-wrap:anywhere]">Checked {formatDate(check.finishedAt)}</div>
          </div>
          <div className="hidden flex-none gap-3 md:flex"><CopyButton /><CheckAnother /></div>
        </div>
        <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[380px_minmax(0,1fr)]">
          <div className="flex flex-col gap-4 lg:sticky lg:top-5">
            <Verdict report={report} />
            <Details report={report} onBack={onBack} />
          </div>
          <div className="flex min-w-0 flex-col gap-5">
            <Containment report={report} />
            <SaysVsDid report={report} />
          </div>
        </div>
        <div className="flex flex-col gap-2.5 pt-1 md:hidden"><CheckAnother className="h-[52px] rounded-[14px]" /><CopyButton className="h-[52px] rounded-[14px]" /></div>
      </main>
    </div>
  );
}

export function CouldntCheck({ check }: { check: CheckView }) {
  useEffect(() => remember(check), [check]);
  const label = [check.skill?.name, check.skill?.source ?? check.input].filter(Boolean).join(' · ');
  return (
    <div className="flex min-h-dvh flex-col">
      <Nav />
      <main className="flex flex-1 justify-center px-4 py-8 md:px-6 md:py-24">
        <section className="si-slide box-border flex w-full max-w-[680px] flex-col gap-5 self-start rounded-3xl border border-line bg-white p-6 md:p-10">
          <div className="flex flex-col gap-1.5">
            <div className="text-[15px] text-soft [overflow-wrap:anywhere]">{label}</div>
            <h1 className="text-2xl font-semibold leading-8 tracking-[-0.015em] md:text-[30px] md:leading-[38px]">
              {check.sandboxStarted ? "We couldn't finish checking this, so there's no grade." : "We couldn't check this safely, so we didn't run it."}
            </h1>
          </div>
          <p className="text-[17px] leading-[26px] text-body [overflow-wrap:anywhere]">{check.problem}</p>
          <div className="flex flex-col gap-2.5 border-t border-line2 pt-5">
            <div className="text-[15px] font-semibold">What you can try</div>
            <p className="text-base leading-6 text-muted">Check that the repo is public. If the repo holds several skills, tell us which one.</p>
            <p className="text-base leading-6 text-muted">Run the check again. If it keeps happening, it may be on our side.</p>
          </div>
          <div className="flex flex-wrap gap-3 pt-1"><CheckAnother /></div>
        </section>
      </main>
    </div>
  );
}

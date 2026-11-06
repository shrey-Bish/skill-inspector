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

function Verdict({ report }: { report: Report }) {
  const style = verdictStyle[report.verdict];
  return (
    <section className="si-slide flex flex-col gap-4 rounded-[22px] border border-line bg-white p-5 shadow-[0_2px_10px_rgba(0,0,0,0.03)] sm:flex-row sm:items-center sm:gap-6 md:p-7">
      <div role="img" aria-label={`Safety grade ${report.grade}`} className={`flex size-[76px] flex-none items-center justify-center rounded-[18px] text-[46px] font-bold tracking-[-0.03em] text-white md:size-24 md:rounded-[22px] md:text-[58px] ${style.tile}`}>{report.grade}</div>
      <div className="flex min-w-0 flex-col gap-1.5">
        <h2 className={`text-[26px] font-semibold leading-8 md:text-[30px] md:leading-9 ${style.text}`}>{report.verdict}</h2>
        <p className="text-base leading-6 md:text-[17px] md:leading-[26px] [overflow-wrap:anywhere]">{report.summary}</p>
        {report.partial && <p className="text-sm leading-5 text-amber-text">The test ended early, so this covers only part of the job.</p>}
      </div>
    </section>
  );
}

function Containment({ report }: { report: Report }) {
  const caught = report.containment.caught;
  if (!report.containment.happened || !caught) {
    const readKey = report.details.files.some((f) => f.decoy && f.ok && f.mode === 'read');
    return (
      <section className="si-slide si-delay flex items-center gap-3.5 rounded-[22px] border border-[#cfe6d7] bg-white px-5 py-4 md:px-7">
        <Check />
        <div className="text-[17px] font-semibold leading-6">{readKey ? 'It read a fake key, but nothing tried to leave the test space.' : 'Nothing tried to leave the test space.'}</div>
      </section>
    );
  }
  const keyed = caught.matches.length > 0;
  return (
    <section className="si-slide si-delay flex flex-col overflow-hidden rounded-[22px] border-2 border-red bg-white shadow-[0_14px_40px_rgba(200,55,45,0.12)]">
      <h2 className="bg-red-tint px-5 py-4 text-[21px] font-semibold leading-7 text-[#5e1a14] [text-wrap:balance] md:px-7 md:py-5 md:text-[26px] md:leading-[34px] md:tracking-[-0.015em]">{report.containment.plain}</h2>
      <div className="flex flex-col gap-4 p-5 md:px-7 md:py-6">
        <div className="flex flex-col gap-4 rounded-2xl bg-ink p-4 md:px-6 md:py-5">
          <div className="flex flex-col gap-1">
            <div className="text-[13px] text-[#a3a9b1]">Where it was going</div>
            <div className="font-mono text-[13.5px] leading-5 text-white [word-break:break-all] md:text-base md:leading-6"><Highlighted text={addressOf(caught)} attempt={caught} /></div>
          </div>
          <div className="flex flex-col gap-1">
            <div className="text-[13px] text-[#a3a9b1]">What it tried to send</div>
            <div className="flex max-h-72 flex-col gap-2 overflow-auto font-mono text-[13px] leading-[22px] text-[#e6e8eb] [word-break:break-all] md:text-[15px] md:leading-[25px]">
              <SentData attempt={caught} />
              <Disguises attempt={caught} />
            </div>
          </div>
        </div>
        <p className="flex items-start gap-3 text-base leading-6 md:text-[17px] md:leading-[26px]">
          <Check />
          {keyed
            ? 'That key was fake and nothing left the test space. On your computer, it could have been your real key.'
            : 'Nothing left the test space. On your computer, this request would have gone out.'}
        </p>
      </div>
    </section>
  );
}

/** The skill's own words beside everything we saw. Anything worrying is simply marked. */
function SaysVsDid({ report }: { report: Report }) {
  const { says, did } = report.saysVsDid;
  const calm = did.filter((d) => !d.surprise).map((d) => ({ level: 'safe' as const, text: d.text }));
  const worries = report.signals.filter((s) => s.level !== 'safe').map((s) => ({ level: s.level, text: s.plain }));
  const saw = [...worries, ...calm];
  return (
    <section className="si-rest flex flex-col gap-5 rounded-[22px] border border-line bg-white p-5 md:p-7">
      <h2 className="text-lg font-semibold md:text-xl">What it says vs what it did</h2>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 md:gap-10">
        <div className="flex flex-col gap-2">
          <div className="text-sm font-semibold text-muted">It says</div>
          {says.length === 0 && <p className="text-faint">It doesn&apos;t say.</p>}
          {says.map((t, i) => <p key={i} className="text-base leading-[23px] [overflow-wrap:anywhere]">“{t}”</p>)}
        </div>
        <div className="flex flex-col gap-2">
          <div className="text-sm font-semibold text-muted">We saw</div>
          {saw.length === 0 && <p className="text-base">It ran without touching any other files.</p>}
          {saw.map((r, i) => (
            <div key={i} className={`grid grid-cols-[12px_minmax(0,1fr)] gap-3 text-base leading-[23px] ${r.level === 'safe' ? '' : 'font-medium'}`}>
              <span className="mt-[7px] flex"><Marker level={r.level} /></span>
              <span className="[overflow-wrap:anywhere]">{r.text}</span>
            </div>
          ))}
        </div>
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
    <section className="si-rest flex flex-col gap-3 px-1 text-sm leading-5 text-soft">
      <p>Based on one test run. No test can promise a skill is safe.</p>
      <p className="[overflow-wrap:anywhere]">We asked the agent: {report.task}</p>
      <p>{limitsLine(report)}</p>
      <div className="flex flex-wrap gap-x-5 gap-y-1 pt-1 text-[15px] font-medium">
        <button onClick={onBack} className="cursor-pointer text-muted underline-offset-2 hover:text-ink hover:underline">See how the test ran</button>
        <button aria-expanded={open} onClick={() => setOpen((o) => !o)} className="cursor-pointer text-muted underline-offset-2 hover:text-ink hover:underline">{open ? 'Hide technical details' : 'Show technical details'}</button>
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
      <main className="mx-auto box-border flex w-full max-w-[960px] flex-col gap-4 px-4 pb-12 pt-5 md:gap-5 md:px-6 md:pt-9">
        <div className="flex flex-col gap-3 px-1 md:flex-row md:items-center md:justify-between md:gap-6 md:px-0">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2 md:gap-3">
              <h1 className="text-2xl font-semibold [overflow-wrap:anywhere] md:text-[28px] md:tracking-[-0.02em]">{check.skill?.name}</h1>
              {check.skill?.testSample && <TestSampleChip />}
            </div>
            <div className="text-sm text-soft [overflow-wrap:anywhere]">{formatDate(check.finishedAt)}</div>
          </div>
          <div className="hidden flex-none gap-3 md:flex"><CopyButton /><CheckAnother /></div>
        </div>
        <Verdict report={report} />
        <Containment report={report} />
        <SaysVsDid report={report} />
        <Details report={report} onBack={onBack} />
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

'use client';
import { useEffect, useState } from 'react';
import { clock, formatDate, remember, verdictStyle, type CheckView, type Grade, type Report } from '@/lib/api';
import { addressOf, Disguises, Highlighted, SentData } from './CaughtData';
import { Check, CheckAnother, Marker, Nav, secondaryButton, TestSampleChip } from './ui';

const GRADES: Grade[] = ['A', 'B', 'C', 'D', 'F'];

function limitLabel(report: Report) {
  const { seconds, memory } = report.limits;
  const time = seconds % 60 === 0 ? `${seconds / 60} minute${seconds === 60 ? '' : 's'}` : `${seconds} seconds`;
  return { time, memory: memory.replace(/G$/, ' GB').replace(/M$/, ' MB') };
}

function GradeCard({ report }: { report: Report }) {
  const style = verdictStyle[report.verdict];
  const limits = limitLabel(report);
  return (
    <section className="si-slide flex flex-col gap-3.5 rounded-[20px] border border-line bg-white p-5 shadow-[0_2px_10px_rgba(0,0,0,0.03)] md:gap-[22px] md:rounded-[22px] md:p-7">
      <div className="flex items-center gap-4 md:gap-5">
        <div className={`flex size-[76px] flex-none items-center justify-center rounded-[18px] text-[46px] font-bold tracking-[-0.03em] text-white md:size-28 md:rounded-3xl md:text-[68px] ${style.tile}`}>{report.grade}</div>
        <div className="flex flex-col gap-1 md:gap-1.5">
          <div className="text-[13px] text-soft">Safety grade</div>
          <div className={`text-[23px] font-semibold md:text-[28px] md:leading-8 ${style.text}`}>{report.verdict}</div>
        </div>
      </div>
      <p className="text-base leading-[23px] md:text-[17px] md:leading-[25px]">{report.summary}</p>
      <div className="hidden gap-1.5 md:flex" aria-hidden>
        {GRADES.map((g) => (
          <div key={g} className={`flex h-7 flex-1 items-center justify-center rounded-md text-[12.5px] ${g === report.grade ? `font-bold text-white ${style.tile}` : 'bg-[#edeeeb] font-semibold text-soft'}`}>{g}</div>
        ))}
      </div>
      <p className="text-[13.5px] leading-[19px] text-soft md:text-sm md:leading-5">Based on one test run. No test can promise a skill is safe.</p>
      {report.partial && (
        <p className="rounded-[10px] bg-amber-tint px-3 py-2.5 text-sm leading-5 text-[#5b3b00]">The test ended before the agent finished, so this grade covers only part of the job.</p>
      )}
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 border-t border-line2 pt-3 text-sm leading-5 md:gap-x-4 md:gap-y-2.5 md:pt-[18px] md:text-[14.5px] md:leading-[21px]">
        <dt className="text-soft">Task</dt><dd className="[overflow-wrap:anywhere]">{report.task}</dd>
        <dt className="text-soft">Time limit</dt><dd>{limits.time} (used {clock(report.sandbox.ms)})</dd>
        <dt className="text-soft">Memory limit</dt><dd>{limits.memory}</dd>
      </dl>
    </section>
  );
}

function Containment({ report }: { report: Report }) {
  const caught = report.containment.caught;
  if (!report.containment.happened || !caught) {
    const readKey = report.details.files.some((f) => f.decoy && f.ok && f.mode === 'read');
    return (
      <section className="si-slide si-delay flex items-start gap-3.5 rounded-[20px] border border-[#cfe6d7] bg-white px-5 py-5 md:rounded-[22px] md:px-7 md:py-6">
        <Check />
        <div className="flex flex-col gap-1">
          <div className="text-xl font-semibold leading-7">Nothing tried to leave the test space.</div>
          <div className="text-[15.5px] text-muted">{readKey ? 'It read a decoy key, but it sent nothing out.' : "It didn't touch the decoy keys or reach for the internet."}</div>
        </div>
      </section>
    );
  }
  const keyed = caught.matches.length > 0;
  return (
    <section className="si-slide si-delay flex flex-col overflow-hidden rounded-[20px] border-2 border-red bg-white shadow-[0_14px_40px_rgba(200,55,45,0.12)] md:rounded-[22px]">
      <div className="flex flex-col gap-2.5 bg-red-tint px-5 py-[18px] md:flex-row md:items-start md:gap-[18px] md:px-[30px] md:py-[26px]">
        <span className="flex-none self-start rounded-full bg-red px-2.5 py-[3px] text-xs font-semibold text-white md:mt-[5px] md:px-3 md:py-1 md:text-[13px]">Stopped</span>
        <h2 className="text-[21px] font-semibold leading-7 text-[#5e1a14] [text-wrap:balance] md:text-[28px] md:leading-9 md:tracking-[-0.015em]">{report.containment.plain}</h2>
      </div>
      <div className="flex flex-col gap-4 px-5 pb-5 pt-[18px] md:gap-[22px] md:px-[30px] md:pb-[30px] md:pt-[26px]">
        <div className="flex flex-col gap-3.5 rounded-[14px] bg-ink p-4 md:gap-[18px] md:rounded-2xl md:px-6 md:py-[22px]">
          <div className="flex flex-col gap-1 md:gap-1.5">
            <div className="text-[12.5px] text-[#a3a9b1] md:text-[13px]">Outside address</div>
            <div className="font-mono text-[13.5px] leading-5 text-white [word-break:break-all] md:text-base md:leading-6"><Highlighted text={addressOf(caught)} attempt={caught} /></div>
          </div>
          <div className="flex flex-col gap-1 md:gap-1.5">
            <div className="text-[12.5px] text-[#a3a9b1] md:text-[13px]">Data it tried to send</div>
            <div className="flex max-h-80 flex-col gap-2 overflow-auto font-mono text-[13px] leading-[22px] text-[#e6e8eb] [word-break:break-all] md:text-[15px] md:leading-[25px]">
              <SentData attempt={caught} />
              <Disguises attempt={caught} />
            </div>
            {keyed && <div className="pt-1 text-[12.5px] font-semibold text-[#f2c46b]">Highlighted: {[...new Set(caught.matches.map((m) => m.label))].join(', ')} (decoy)</div>}
          </div>
        </div>
        <div className="flex items-start gap-3.5">
          <Check />
          <div className="flex flex-col gap-1">
            <p className="text-base leading-6 md:text-lg md:leading-[27px]">
              {keyed
                ? 'That key was a decoy and nothing left the test space. On your computer, it could have been your real key.'
                : 'Nothing left the test space. On your computer, this request would have gone out.'}
            </p>
            {keyed && <p className="text-[13.5px] text-soft md:text-sm">Decoy key: fake, planted by us, unlocks nothing.</p>}
          </div>
        </div>
      </div>
    </section>
  );
}

function SaysVsDid({ report }: { report: Report }) {
  const { says, did } = report.saysVsDid;
  const calm = did.filter((d) => !d.surprise);
  const surprises = did.filter((d) => d.surprise);
  // Claims and ordinary actions are compared as a whole. We don't pretend one action proves one claim.
  const saw = calm.map((d) => d.text);
  const pill = (text: string) => (/send|Tells|instructions/.test(text) ? 'bg-red' : 'bg-amber');
  const Lines = ({ items, quoted }: { items: string[]; quoted?: boolean }) => (
    items.length === 0
      ? <span className="text-faint">—</span>
      : <span className="flex flex-col gap-1.5">{items.map((t, i) => <span key={i}>{quoted ? `“${t}”` : t}</span>)}</span>
  );
  return (
    <section className="si-rest flex flex-col gap-3 rounded-[20px] border border-line bg-white p-5 md:gap-[18px] md:rounded-[22px] md:px-[30px] md:py-7">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold md:text-xl">What it says vs what it did</h2>
        <p className="hidden text-[15px] text-soft md:block">The skill&apos;s own description, beside what we saw it do. Anything it didn&apos;t mention is marked as a surprise.</p>
      </div>

      {/* Desktop: three columns. */}
      <div role="table" className="hidden grid-cols-[minmax(0,1fr)_112px_minmax(0,1fr)] overflow-hidden rounded-[14px] border border-line2 text-base leading-[23px] md:grid">
        <div className="bg-page px-[18px] py-3 text-[13.5px] font-semibold text-muted">What the skill says</div>
        <div className="bg-page" />
        <div className="bg-page px-[18px] py-3 text-[13.5px] font-semibold text-muted">What we saw</div>
        <div className="border-t border-line2 px-[18px] py-4 [overflow-wrap:anywhere]"><Lines items={says} quoted /></div>
        <div className="flex items-center justify-center border-t border-line2 py-4 text-[13px] font-semibold text-green-text">{says.length > 0 && saw.length > 0 ? 'Matches' : ''}</div>
        <div className="border-t border-line2 px-[18px] py-4 [overflow-wrap:anywhere]"><Lines items={saw} /></div>
        {surprises.map((d, i) => (
          <div key={i} className="contents">
            <div className="border-t border-[#f3d3cf] bg-[#fdf5f4] px-[18px] py-4 italic text-faint">Not mentioned</div>
            <div className="flex items-center justify-center border-t border-[#f3d3cf] bg-[#fdf5f4] py-4"><span className={`rounded-full px-2.5 py-[3px] text-[12.5px] font-semibold text-white ${pill(d.text)}`}>Surprise</span></div>
            <div className="border-t border-[#f3d3cf] bg-[#fdf5f4] px-[18px] py-4 font-semibold [overflow-wrap:anywhere]">{d.text}</div>
          </div>
        ))}
      </div>

      {/* Phone: stacked cards. */}
      <div className="flex flex-col gap-3 md:hidden">
        <div className="flex flex-col gap-1.5 rounded-xl border border-line2 px-3.5 py-3 text-[15px] leading-[21px]">
          <div className="flex justify-between gap-2"><span className="text-[12.5px] text-soft">Says</span>{says.length > 0 && saw.length > 0 && <span className="text-[12.5px] font-semibold text-green-text">Matches</span>}</div>
          <div className="[overflow-wrap:anywhere]"><Lines items={says} quoted /></div>
          <div className="pt-1 text-[12.5px] text-soft">We saw</div>
          <div className="[overflow-wrap:anywhere]"><Lines items={saw} /></div>
        </div>
        {surprises.map((d, i) => (
          <div key={i} className="flex flex-col gap-1.5 rounded-xl border border-[#f3d3cf] bg-[#fdf5f4] px-3.5 py-3 text-[15px] leading-[21px]">
            <div className="flex justify-between gap-2"><span className="text-[12.5px] text-soft">Says</span><span className={`rounded-full px-2 py-0.5 text-xs font-semibold text-white ${pill(d.text)}`}>Surprise</span></div>
            <div className="italic text-faint">Not mentioned</div>
            <div className="pt-1 text-[12.5px] text-soft">We saw</div>
            <div className="font-semibold [overflow-wrap:anywhere]">{d.text}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

const LEVEL_LABEL = { safe: ['Calm', 'text-green-text'], caution: ['Caution', 'text-amber-text'], stop: ['Stop', 'text-[#a8322a]'] } as const;

function WhatItDid({ report }: { report: Report }) {
  const calm = report.saysVsDid.did.filter((d) => !d.surprise).map((d) => ({ level: 'safe' as const, text: d.text }));
  const signals = report.signals.map((s) => ({ level: s.level, text: s.plain }));
  const rows = [...calm, ...signals];
  return (
    <section className="si-rest flex flex-col gap-1 rounded-[20px] border border-line bg-white p-5 md:gap-1.5 md:rounded-[22px] md:px-[30px] md:py-7">
      <h2 className="pb-2 text-lg font-semibold md:pb-2.5 md:text-xl">What it did</h2>
      {rows.map((r, i) => (
        <div key={i} className={`grid grid-cols-[12px_minmax(0,1fr)] items-center gap-3 py-2 text-[15px] leading-[21px] md:grid-cols-[12px_minmax(0,1fr)_auto] md:gap-3.5 md:py-[11px] md:text-base md:leading-[23px] md:border-t md:border-[#f0f1ee]`}>
          <Marker level={r.level} />
          <span className="[overflow-wrap:anywhere]">{r.text}</span>
          <span className={`hidden text-[13px] font-semibold md:block ${LEVEL_LABEL[r.level][1]}`}>{LEVEL_LABEL[r.level][0]}</span>
        </div>
      ))}
    </section>
  );
}

function Details({ report }: { report: Report }) {
  const [open, setOpen] = useState(false);
  const d = report.details;
  const files = (mode: string) => d.files.filter((f) => f.mode === mode);
  const Head = ({ children, first }: { children: string; first?: boolean }) => <div className={`text-faint ${first ? '' : 'pt-2'}`}># {children}</div>;
  const sandboxLine = `microVM · kernel ${report.sandbox.kernel ?? 'unknown'} · ${report.limits.cpus} vCPU · ${report.limits.memory} · net=sinkhole · destroyed=${report.sandbox.destroyed}`;
  return (
    <section className="si-rest flex flex-col gap-4 rounded-[20px] border border-line bg-white p-5 md:rounded-[22px] md:px-[30px] md:py-6">
      <button aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex cursor-pointer items-center justify-between gap-4 text-left">
        <span className="flex flex-col gap-1">
          <span className="text-lg font-semibold md:text-xl">Details</span>
          <span className="hidden text-[15px] text-soft md:block">Raw logs, file paths, network attempts and the exact commands.</span>
        </span>
        <span className="flex h-10 flex-none items-center rounded-[10px] border border-[#cfd3ce] px-3.5 text-[14.5px] font-semibold hover:border-ink">{open ? 'Hide details' : 'Show details'}</span>
      </button>
      {open && (
        <div className="si-fade max-h-[640px] overflow-auto rounded-xl bg-[#f4f5f2] px-[18px] py-4 font-mono text-[12.5px] leading-5 text-body [word-break:break-all]">
          <Head first>runtime</Head><div>{sandboxLine}</div>
          <Head>install</Head><div className="font-sans">{d.installLog}</div>
          <Head>files read</Head>
          {files('read').length ? files('read').map((f) => (
            <div key={f.path}>{f.path}{f.decoy && <span className="text-amber-text"> (canary: {f.decoy})</span>}{f.sensitive && !f.decoy && <span className="text-amber-text"> (sensitive location)</span>}{!f.ok && ' (not found)'}</div>
          )) : <div>none</div>}
          <Head>files written</Head>{files('write').length ? files('write').map((f) => <div key={f.path}>{f.path}</div>) : <div>none</div>}
          <Head>files deleted</Head>{files('delete').length ? files('delete').map((f) => <div key={f.path}>{f.path}</div>) : <div>none</div>}
          <Head>network egress</Head>
          {d.network.filter((n) => n.kind !== 'dns' || n.matches.length).length
            ? d.network.filter((n) => n.kind !== 'dns' || n.matches.length).map((n, i) => (
              <div key={i}>{n.method ?? n.kind} {n.host}{n.port ? `:${n.port}` : ''}{n.path ?? ''} → <span className="text-[#a8322a]">BLOCKED (sinkhole)</span>{n.matches.length > 0 && <span className="text-amber-text"> canary: {n.matches.map((m) => `${m.label} [${m.encoding}]`).join(', ')}</span>}</div>
            ))
            : <div>none</div>}
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
      {copied ? 'Link copied' : 'Copy shareable report'}
    </button>
  );
}

export function ReportView({ check, onBack }: { check: CheckView; onBack: () => void }) {
  const report = check.report!;
  useEffect(() => remember(check), [check]);
  return (
    <div className="flex min-h-dvh flex-col">
      <Nav />
      <main className="flex flex-col gap-4 mx-auto box-border w-full max-w-[1360px] px-4 pb-10 pt-4 md:gap-7 md:px-10 md:pb-[72px] md:pt-10">
        <button onClick={onBack} className="-mb-2 flex cursor-pointer items-center gap-1.5 self-start px-1 text-[15px] font-medium text-muted transition-colors hover:text-ink md:-mb-3 md:px-0">
          <span aria-hidden>←</span> See how the test ran
        </button>
        <div className="flex flex-col gap-4 px-1 md:flex-row md:items-end md:justify-between md:gap-6 md:px-0">
          <div className="flex min-w-0 flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-2 md:gap-3">
              <h1 className="text-2xl font-semibold [overflow-wrap:anywhere] md:text-[32px] md:tracking-[-0.02em]">{check.skill?.name}</h1>
              {check.skill?.testSample && <TestSampleChip />}
            </div>
            <div className="text-sm text-soft md:text-[15px]">
              <span className="hidden [overflow-wrap:anywhere] md:inline">{check.skill?.source} · </span>Checked {formatDate(check.finishedAt)}
            </div>
          </div>
          <div className="hidden flex-none gap-3 md:flex"><CopyButton /><CheckAnother /></div>
        </div>
        <div className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-[minmax(340px,440px)_minmax(0,1fr)] lg:gap-6">
          <GradeCard report={report} />
          {/* Screen 08: with nothing caught, the comparison fills the space beside the grade. */}
          {report.containment.happened
            ? <Containment report={report} />
            : <div className="flex min-w-0 flex-col gap-4 lg:gap-6"><Containment report={report} /><SaysVsDid report={report} /></div>}
        </div>
        {report.containment.happened && <SaysVsDid report={report} />}
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2 lg:gap-6">
          <WhatItDid report={report} />
          <Details report={report} />
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
            <p className="text-base leading-6 text-muted">Check that the repo is public, and name one skill with <span className="font-mono text-sm">--skill</span> if it holds several.</p>
            <p className="text-base leading-6 text-muted">Run the check again. If it keeps happening, it may be on our side.</p>
          </div>
          <div className="flex flex-wrap gap-3 pt-1"><CheckAnother /></div>
        </section>
      </main>
    </div>
  );
}

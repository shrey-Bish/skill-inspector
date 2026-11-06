'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { clock, decide, type CheckView, type FeedEvent, type OutboundAttempt } from '@/lib/api';
import { CaughtPanel } from './CaughtData';
import { DECOYS, GlassBox, type Beat } from './GlassBox';
import { Nav, primaryButton, TestSampleChip, useRecording, VultrBadge } from './ui';

const STEPS: { key: NonNullable<FeedEvent['step']>; label: string }[] = [
  { key: 'setup', label: 'Set up test space' },
  { key: 'load', label: 'Load skill into a test agent' },
  { key: 'task', label: 'Give the agent a task' },
  { key: 'grade', label: 'Watch & grade' },
];

const LINE_GAP = 1200;
const FAST_GAP = 450; // A long backlog still has to catch up with the run.
const REACH = 700;
const STOP = 900;
const RECORD_HOLD = 6000;
const AFTER_DESTROY = 1400;

const wait = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const dataOf = (e: FeedEvent) => (e.data ?? {}) as {
  caught?: OutboundAttempt; attempt?: OutboundAttempt; task?: string; decoyNote?: string;
  confirm?: string; confirmed?: boolean; destroyed?: boolean; clean?: boolean;
};

/** Brings a card that just appeared into view, without moving anything already on screen. */
function reveal(selector: string) {
  setTimeout(() => document.querySelector(selector)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 500);
}

/**
 * Plays the real feed one line at a time. Events only reach this queue from the server's
 * stream of the running check, so the catch animation can only follow a real catch.
 */
function useRun(id: string, onDone: () => void, review: boolean) {
  const [check, setCheck] = useState<CheckView | null>(null);
  const [lines, setLines] = useState<FeedEvent[]>([]);
  const [beat, setBeat] = useState<Beat>('calm');
  const [caught, setCaught] = useState<OutboundAttempt | null>(null);
  const [panel, setPanel] = useState(false);
  const [awaitProof, setAwaitProof] = useState(false);
  const [taken, setTaken] = useState<Set<string>>(new Set());
  const [task, setTask] = useState('');
  const [files, setFiles] = useState<string[]>([]);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);

  const queue = useRef<FeedEvent[]>([]);
  const seen = useRef(new Set<number>());
  const ended = useRef(false);
  const statusRef = useRef<CheckView | null>(null);
  const confirmOpen = useRef(false);
  const holding = useRef(false);
  const caughtHasKey = useRef(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  const continueRun = useCallback(() => {
    holding.current = false;
    setAwaitProof(false);
  }, []);

  useEffect(() => {
    let alive = true;
    let animated = false;
    let keyAnimated = false;
    let holdAfterStop = false;
    let confirmsPlayed = 0;
    let decisions = 0;

    const source = new EventSource(`/api/checks/${id}/stream`);
    source.addEventListener('status', (e) => {
      const next = JSON.parse((e as MessageEvent).data) as CheckView;
      statusRef.current = next;
      setCheck(next);
    });
    source.addEventListener('feed', (e) => {
      const event = JSON.parse((e as MessageEvent).data) as FeedEvent;
      if (seen.current.has(event.seq)) return; // The server replays the feed after a reconnect.
      seen.current.add(event.seq);
      const d = dataOf(event);
      if (d.task) setTask(d.task);
      if (d.confirmed !== undefined) { decisions++; confirmOpen.current = false; setConfirm(null); }
      queue.current.push(event);
    });
    source.addEventListener('end', () => {
      ended.current = true;
      source.close();
    });

    const markTaken = (text: string) => {
      const ids = DECOYS.filter((k) => k.match.test(text)).map((k) => k.id);
      if (ids.length > 0) setTaken((had) => new Set([...had, ...ids]));
    };

    const play = async () => {
      while (alive) {
        if (!review && (confirmOpen.current || holding.current)) { await wait(120); continue; }
        const next = queue.current.shift();
        if (!next) {
          if (ended.current) break;
          await wait(review ? 20 : 100);
          continue;
        }
        const d = dataOf(next);
        const attempt = d.caught ?? d.attempt;
        const hasKey = Boolean(d.caught);
        if (attempt) {
          // The panel shows the worst request seen. A key-carrying one always plays the full catch.
          if (hasKey || !caughtHasKey.current) setCaught(attempt);
          if (hasKey) { caughtHasKey.current = true; markTaken(next.text); }
          if (review) {
            setPanel(true);
          } else if (!animated || (hasKey && !keyAnimated)) {
            animated = true;
            keyAnimated = keyAnimated || hasKey;
            setPanel(false);
            setBeat('reach');
            await wait(REACH);
            setLines((l) => [...l, next]);
            setBeat('stop');
            await wait(STOP);
            setBeat('proof');
            setPanel(true);
            reveal('[data-si-caught]');
            if (hasKey) holdAfterStop = true;
            continue;
          }
        }
        setLines((l) => [...l, next]);
        if (d.decoyNote) markTaken(next.text);
        const touched = /^(?:Opened|Wrote|Deleted) (.+)$/.exec(next.text);
        if (touched) setFiles((f) => (f.includes(touched[1]) ? f : [...f, touched[1]]));
        if (d.clean) setBeat('clean');
        if (d.destroyed) setBeat('destroyed');
        if (d.confirm && !review) {
          // After a reload the decision may already be in, and then there is nothing left to ask.
          confirmsPlayed++;
          if (confirmsPlayed > decisions) { confirmOpen.current = true; setConfirm(d.confirm); reveal('[data-si-pause]'); }
        }
        if (review) continue;
        if (holdAfterStop && /^We stopped it/.test(next.text)) {
          // The proof holds until the reader moves on, or for six seconds in a recording.
          holdAfterStop = false;
          holding.current = true;
          setAwaitProof(true);
          if (document.documentElement.classList.contains('record')) setTimeout(continueRun, RECORD_HOLD);
          continue;
        }
        await wait(queue.current.length > 5 ? FAST_GAP : LINE_GAP);
      }
      if (!alive) return;
      setFinished(true);
      if (review) return;
      if (statusRef.current?.status === 'done') await wait(AFTER_DESTROY);
      if (alive) onDoneRef.current();
    };
    void play();
    return () => { alive = false; source.close(); };
  }, [id, continueRun, review]);

  const answer = useCallback(async (allow: boolean) => {
    await decide(id, allow).catch(() => {});
    confirmOpen.current = false;
    setConfirm(null);
  }, [id]);

  return { check, lines, beat, caught, panel, awaitProof, continueRun, taken, task, files, confirm, finished, answer };
}

function Steps({ lines, finished }: { lines: FeedEvent[]; finished: boolean }) {
  const reached = lines.reduce((max, l) => Math.max(max, STEPS.findIndex((s) => s.key === l.step)), 0);
  return (
    <ol className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3">
      {STEPS.map((step, i) => {
        const done = i < reached || finished;
        const active = i === reached && !finished;
        return (
          <li key={step.key} className={`flex items-center gap-2.5 text-[15px] ${active ? 'font-semibold' : done ? 'text-ink' : 'text-faint'}`} aria-current={active ? 'step' : undefined}>
            {done && <span className="si-line flex size-6 flex-none items-center justify-center rounded-full bg-green text-[13px] font-bold text-white">✓</span>}
            {active && <span className="box-border flex size-6 flex-none items-center justify-center rounded-full border-2 border-accent"><span className="size-2 rounded-full bg-accent" /></span>}
            {!done && !active && <span className="box-border size-6 flex-none rounded-full border-2 border-[#c5c9ce]" />}
            <span>{step.label}</span>
          </li>
        );
      })}
    </ol>
  );
}

const DOT: Record<string, string> = { info: 'bg-[#b9bec4]', safe: 'bg-green', caution: 'bg-amber', stop: 'bg-red' };
const COLOR: Record<string, string> = { info: 'text-muted', safe: 'text-muted', caution: 'text-ink', stop: 'text-red-text' };

function Feed({ lines, confirm, answer, start, finished, awaitProof, plain }: {
  lines: FeedEvent[]; confirm: string | null; answer: (allow: boolean) => void; start: number; finished: boolean; awaitProof: boolean; plain: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [lines.length, confirm, finished]);
  const firstDecoy = lines.findIndex((l) => dataOf(l).decoyNote);
  const lastAt = lines.at(-1);
  return (
    <div className="box-border flex min-w-0 flex-[1_1_300px] flex-col gap-1.5 rounded-[20px] border border-line bg-white px-6 py-[22px] lg:max-w-[420px]">
      <div className="pb-2 text-base font-semibold">What&apos;s happening</div>
      <div ref={box} aria-live="polite" className="flex max-h-[470px] flex-col overflow-y-auto">
        {lines.map((l, i) => {
          // "read x" and "write x" repeat the "Opened x" and "Wrote x" lines that follow them.
          if (/^Agent ran: (read|write) /.test(l.text)) return null;
          const command = /^Agent ran: ([\s\S]+)$/.exec(l.text)?.[1];
          const stopped = /^We stopped it/.test(l.text);
          return (
            <div key={l.seq} className={`si-line grid grid-cols-[36px_8px_minmax(0,1fr)] gap-3 py-[7px] text-[15px] leading-[22px] ${COLOR[l.level]}`}>
              <span className="font-mono text-[12.5px] text-faint">{clock(new Date(l.at).getTime() - start)}</span>
              <span className={`mt-[7px] size-2 ${l.level === 'caution' ? 'rotate-45' : l.level === 'stop' ? 'rounded-[1px]' : 'rounded-full'} ${DOT[l.level]}`} />
              <span className={`si-line-text flex flex-col gap-2 [overflow-wrap:anywhere] ${stopped ? 'font-semibold' : ''}`}>
                {command
                  ? <><span>Agent ran a command</span>{!plain && <code title={command} className="line-clamp-2 rounded-md bg-[#f4f5f2] px-2 py-1 font-mono text-[12px] leading-[18px] text-body [word-break:break-all]">{command}</code>}</>
                  : l.text}
                {i === firstDecoy && <span className="rounded-lg bg-amber-tint px-2.5 py-[7px] text-[13.5px] font-normal leading-[19px] text-[#5b3b00]">Decoy key: fake, planted by us, unlocks nothing.</span>}
              </span>
            </div>
          );
        })}
        {confirm && (
          <div data-si-pause className="si-slide mt-2.5 flex flex-col gap-3 rounded-2xl border-[1.5px] border-[#d9a441] bg-[#fffbf3] p-[18px] shadow-[0_8px_22px_rgba(176,110,0,0.10)]">
            <div className="flex items-center gap-2 text-[13px] font-semibold text-[#7a4a00]"><span className="size-2 rotate-45 bg-[#c07a00]" />Paused at {lastAt ? clock(new Date(lastAt.at).getTime() - start) : '0:00'}</div>
            <div className="text-base font-semibold leading-[23px]">The agent wants to run something that can&apos;t be undone.</div>
            <div className="rounded-lg bg-[#f4f5f2] px-3 py-2 font-mono text-[12.5px] leading-5 [word-break:break-all]">{confirm}</div>
            <div className="text-sm leading-[21px] text-muted">This can&apos;t be undone inside the test space. Your computer isn&apos;t affected either way. If you don&apos;t choose within 30 seconds, we stop here.</div>
            <div className="flex flex-wrap gap-2.5">
              <button onClick={() => answer(true)} className="h-[42px] cursor-pointer rounded-[10px] bg-ink px-4 text-[15px] font-semibold text-white hover:bg-body">Allow in test space</button>
              <button onClick={() => answer(false)} className="h-[42px] cursor-pointer rounded-[10px] border border-[#cfd3ce] bg-white px-4 text-[15px] font-semibold hover:border-ink">Stop here</button>
            </div>
          </div>
        )}
        {!finished && !confirm && (
          <div className="grid grid-cols-[36px_8px_minmax(0,1fr)] gap-3 py-[7px] text-[15px] leading-[22px] text-faint">
            <span /><span className="mt-[7px] box-border size-2 rounded-full border-[1.5px] border-[#b9bec4]" />
            <span>{lines.at(-1)?.step === 'grade' ? 'Writing your report…' : awaitProof ? 'Paused so you can read this' : 'Working…'}</span>
          </div>
        )}
      </div>
    </div>
  );
}

const PLAIN_NOW: Record<Beat, string> = {
  calm: 'The agent is working on the task, following the skill.',
  reach: 'The skill is trying to send data out.',
  stop: 'The attempt hit the edge of the test space and was stopped.',
  proof: 'The attempt to send data out was stopped. Nothing left.',
  clean: 'The agent finished. Nothing tried to leave.',
  destroyed: 'The test space has been destroyed.',
};

function PlainCard({ beat, confirm, fileName }: { beat: Beat; confirm: string | null; fileName?: string }) {
  return (
    <div aria-live="polite" className="flex min-w-0 flex-[1_1_380px] flex-col gap-3 self-start rounded-2xl border border-line p-[22px] text-[15.5px] leading-[23px]">
      <div className="text-base font-semibold">Inside the throwaway test space</div>
      <div className="text-muted">A test agent, the skill, {fileName || 'some sample files'} and decoy keys.</div>
      <div className="pt-1.5 text-base font-semibold">Right now</div>
      <div className="text-muted">{confirm ? 'Paused. Waiting for you to allow or stop the next step.' : PLAIN_NOW[beat]}</div>
    </div>
  );
}

function usePlainView(): [boolean, (v: boolean) => void] {
  const [plain, setPlain] = useState(false);
  useEffect(() => {
    try { setPlain(localStorage.getItem('si-plain') === '1'); } catch { /* Storage can be blocked. */ }
  }, []);
  return [plain, (v) => {
    setPlain(v);
    try { localStorage.setItem('si-plain', v ? '1' : '0'); } catch { /* Storage can be blocked. */ }
  }];
}

export function Checking({ id, onDone, review = false }: { id: string; onDone: () => void; review?: boolean }) {
  const { check, lines, beat, caught, panel, awaitProof, continueRun, taken, task, files, confirm, finished, answer } = useRun(id, onDone, review);
  const [plain, setPlain] = usePlainView();
  const recording = useRecording();
  const skill = check?.skill;
  const start = lines[0] ? new Date(lines[0].at).getTime() : 0;
  const latest = [...lines].reverse().find((l) => !/^Agent ran: (read|write) /.test(l.text));
  const now = latest ? latest.text.replace(/^Agent ran: .*/s, 'Agent ran a command') : 'Getting ready…';
  const carried = caught && caught.matches.length > 0 ? 'key' : caught && (caught.body || caught.method === 'POST') ? 'data' : 'request';

  return (
    <div className="flex min-h-dvh flex-col">
      <Nav>
        {!recording && (
          <label className="hidden cursor-pointer select-none items-center gap-2.5 text-sm text-muted sm:flex">
            <input type="checkbox" className="peer sr-only" checked={plain} onChange={(e) => setPlain(e.target.checked)} />
            <span className={`relative h-5 w-9 rounded-full transition-colors peer-focus-visible:outline-2 peer-focus-visible:outline-accent ${plain ? 'bg-accent' : 'bg-[#d5d8dc]'}`}>
              <span className={`absolute top-0.5 size-4 rounded-full bg-white transition-[left] ${plain ? 'left-[18px]' : 'left-0.5'}`} />
            </span>
            Plain view
          </label>
        )}
        <VultrBadge />
      </Nav>
      <main className="mx-auto box-border flex w-full max-w-[1360px] flex-col gap-5 px-4 pb-12 pt-5 md:px-10 md:pt-6">
        {review && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-[#c9d7f2] bg-tint px-5 py-3">
            <span className="text-[15px] text-accent-hover">This test has finished. Here&apos;s everything that happened.</span>
            <button onClick={onDone} className={`${primaryButton} !h-10 cursor-pointer !text-[15px]`}>See the report</button>
          </div>
        )}
        <div data-si-top className="flex flex-wrap gap-6">
          <div className="flex min-w-0 flex-[1_1_520px] items-center gap-4 rounded-[18px] border border-line bg-white px-5 py-4">
            <div className="flex size-12 flex-none items-center justify-center rounded-xl bg-tint"><div className="size-4 rounded bg-accent" /></div>
            <div className="flex min-w-0 flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="text-xl font-semibold [overflow-wrap:anywhere]">{skill?.name ?? 'Fetching the skill…'}</span>
                {skill?.testSample && <TestSampleChip />}
              </div>
              {skill && <div className="line-clamp-2 text-[15px] leading-[21px] text-muted [overflow-wrap:anywhere]" title={skill.description}>“{skill.description}”</div>}
            </div>
          </div>
          <div className="flex min-w-0 flex-[1_1_300px] flex-col justify-center gap-1 rounded-[18px] border border-line bg-white px-5 py-4 lg:max-w-[420px]">
            <div className="text-[13px] text-soft">Task we gave the agent</div>
            <div className="text-[15px] font-semibold leading-[21px] [overflow-wrap:anywhere]">{task || 'Drafting an ordinary task…'}</div>
          </div>
        </div>

        {check?.position !== undefined && <p className="text-[15px] text-muted">Waiting for {check.position === 1 ? 'one check' : `${check.position} checks`} ahead of yours. We run one at a time.</p>}

        <Steps lines={lines} finished={finished} />

        <div className="flex flex-wrap items-stretch gap-6">
          <div className="box-border flex min-w-0 flex-[1_1_480px] flex-wrap gap-5 rounded-[20px] border border-line bg-white p-4 md:p-6">
            {plain
              ? <PlainCard beat={beat} confirm={confirm} fileName={files[0]} />
              : <div className="relative h-[470px] min-w-0 flex-[1_1_300px]"><div className="absolute inset-0"><GlassBox beat={beat} host={caught?.host} files={files} taken={taken} carried={carried} now={now} /></div></div>}
            {panel && caught && <CaughtPanel attempt={caught} onContinue={awaitProof && !recording ? continueRun : undefined} />}
          </div>
          <Feed lines={lines} confirm={confirm} answer={answer} start={start} finished={finished} awaitProof={awaitProof} plain={plain} />
        </div>
      </main>
    </div>
  );
}

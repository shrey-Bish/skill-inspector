'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { getSamples, isRecording, startCheck, withMode, type Sample } from '@/lib/api';
import { Nav } from '@/components/ui';

const REAL = [
  { name: 'pdf', owner: 'anthropics', input: 'npx skills add anthropics/skills --skill pdf' },
  { name: 'frontend-design', owner: 'anthropics', input: 'npx skills add anthropics/skills --skill frontend-design' },
  { name: 'docx', owner: 'anthropics', input: 'npx skills add anthropics/skills --skill docx' },
  { name: 'brainstorming', owner: 'obra', input: 'npx skills add obra/superpowers --skill brainstorming' },
];

function ChipRow({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="text-sm text-muted">{title}</div>
      <div className="flex flex-wrap gap-2 md:gap-2.5">{children}</div>
    </div>
  );
}

function Chip({ title, disabled, onClick, children }: { title: string; disabled: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      disabled={disabled}
      title={title}
      onClick={onClick}
      className="flex cursor-pointer items-center gap-2 rounded-full border border-[#dcded9] bg-white px-4 py-[9px] text-[15px] font-medium transition-colors duration-300 hover:border-accent disabled:cursor-wait"
    >
      {children}
    </button>
  );
}

export default function Home() {
  const router = useRouter();
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [samples, setSamples] = useState<Sample[]>([]);

  useEffect(() => {
    getSamples()
      .then((list) => setSamples([...list].sort((a, b) => Number(a.testSample) - Number(b.testSample))))
      .catch(() => setSamples([]));
  }, []);

  // Recording starts straight away: ?record=1 runs the built-in test sample, &sample=id any other, &stay=1 waits here.
  const autoStarted = useRef(false);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!isRecording() || params.has('stay') || samples.length === 0 || autoStarted.current) return;
    const chosen = params.get('sample') ?? samples.find((s) => s.testSample)?.id;
    if (!chosen) return;
    autoStarted.current = true;
    void start(`sample:${chosen}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [samples]);

  const start = async (value: string) => {
    setBusy(true);
    setError('');
    try {
      const check = await startCheck(value.trim());
      router.push(withMode(`/check/?id=${check.id}&live=1`));
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  const run = (value: string) => { setInput(value); void start(value); };
  const clean = samples.filter((c) => !c.testSample);
  const bad = samples.filter((c) => c.testSample);

  return (
    <div className="si-fade flex min-h-dvh flex-col">
      <Nav />
      <main className="flex flex-1 justify-center px-5 pb-20 pt-[clamp(48px,10vh,110px)] md:px-6">
        <div className="flex w-full max-w-[760px] flex-col gap-6 md:gap-7">
          <div className="flex flex-col gap-3 md:gap-3.5">
            <h1 className="text-[34px] font-semibold leading-10 tracking-[-0.02em] [text-wrap:balance] md:text-[52px] md:leading-[58px] md:tracking-[-0.025em]">Check a skill before you install it.</h1>
            <p className="text-base leading-6 text-muted [text-wrap:pretty] md:text-[19px] md:leading-[29px]">We load the skill into a real AI agent, give it an ordinary task, and show you what it actually did.</p>
          </div>

          <form className="flex flex-col gap-2.5" onSubmit={(e) => { e.preventDefault(); if (input.trim() && !busy) void start(input); }}>
            <label htmlFor="skill" className="text-[15px] font-semibold">Paste a skill&apos;s install command or repo link.</label>
            <div className="flex flex-col gap-2.5 md:flex-row md:gap-3">
              <input
                id="skill"
                value={input}
                onChange={(e) => { setInput(e.target.value); setError(''); }}
                autoFocus
                autoComplete="off"
                spellCheck={false}
                placeholder="npx skills add owner/skill-name, or a GitHub link"
                aria-invalid={Boolean(error)}
                aria-describedby={error ? 'skill-error' : undefined}
                className={`h-14 min-w-0 flex-1 rounded-[14px] border-[1.5px] bg-white px-4 text-base outline-none placeholder:text-faint md:h-[60px] md:px-5 md:text-[17px] ${error ? 'border-red' : 'border-[#cfd3ce]'} focus:border-accent focus:shadow-[0_0_0_4px_#dde6f8]`}
              />
              <button
                type="submit"
                disabled={!input.trim() || busy}
                className="h-14 cursor-pointer rounded-[14px] bg-accent px-7 text-[17px] font-semibold text-white shadow-[0_2px_6px_rgba(45,91,194,0.25)] transition-colors duration-300 hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40 md:h-[60px]"
              >
                {busy ? 'Starting…' : 'Check this skill'}
              </button>
            </div>
            {error && <p id="skill-error" role="alert" className="text-[15px] leading-[22px] text-red-text">{error}</p>}
          </form>

          <div className="flex flex-col gap-4">
            {clean.length > 0 && (
              <ChipRow title="Or try an example">
                {clean.map((c) => <Chip key={c.id} disabled={busy} title={c.description} onClick={() => run(`sample:${c.id}`)}>{c.name}</Chip>)}
              </ChipRow>
            )}
            {bad.length > 0 && (
              <ChipRow title="Built-in test samples, which misbehave on purpose">
                {bad.map((c) => <Chip key={c.id} disabled={busy} title={c.description} onClick={() => run(`sample:${c.id}`)}>{c.name}</Chip>)}
              </ChipRow>
            )}
            <ChipRow title="Real skills from GitHub">
              {REAL.map((r) => (
                <Chip key={r.input} disabled={busy} title={r.input} onClick={() => run(r.input)}>
                  {r.name}<span className="font-normal text-soft">{r.owner}</span>
                </Chip>
              ))}
            </ChipRow>
          </div>

          <div className="flex items-start gap-2.5 pt-1.5 text-[15px] leading-[22px] text-muted md:items-center">
            <span className="mt-1 box-border flex size-3.5 flex-none items-center justify-center rounded border-[1.5px] border-accent md:mt-0"><span className="size-1 rounded-[1px] bg-accent" /></span>
            It runs in a throwaway test space on Vultr. Never on your computer.
          </div>
        </div>
      </main>
    </div>
  );
}

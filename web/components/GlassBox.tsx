'use client';
import { useState } from 'react';

export type Beat = 'calm' | 'reach' | 'stop' | 'proof' | 'clean' | 'destroyed';

export const DECOYS: { id: string; label: string; match: RegExp }[] = [
  { id: 'aws', label: 'AWS', match: /AWS/ },
  { id: 'ssh', label: 'SSH', match: /SSH/ },
  { id: 'github', label: 'GitHub', match: /GitHub token(?! in the env)/ },
  { id: 'npm', label: 'npm', match: /npm/ },
  { id: 'dotenv', label: '.env', match: /\.env/ },
  { id: 'env', label: 'settings', match: /in the environment/ },
];

const EXPLAIN = {
  space: "This is a sealed room made just for this test. There's no way out, and we destroy it afterwards.",
  agent: 'This is the AI helper. It does what the skill tells it to, just like one on your computer would.',
  skill: 'This is the skill we are testing. A skill is a set of instructions for the AI helper.',
  wall: 'This is the wall. Nothing inside can get past it, so nothing can reach the real internet.',
  internet: 'This is the real internet. Nothing from the test space can reach it.',
  keys: 'Keys work like passwords. These are fake ones we planted as bait. If the skill grabs one, we catch it.',
} as const;
type Part = keyof typeof EXPLAIN;

/** The beats of the catch. Each is driven by a real event in the run; nothing here is replayed. */
export function GlassBox({ beat, host, taken, carried }: {
  beat: Beat;
  host?: string;
  /** Ids of the planted fake keys it really read or tried to send. */
  taken: Set<string>;
  /** What rides the arrow: "key" when a fake key is inside the request. */
  carried: string;
}) {
  const [part, setPart] = useState<Part | null>(null);
  const arrow = <div className="absolute -right-2 -top-[5.5px] size-0 border-y-[7px] border-l-[11px] border-y-transparent border-l-red" />;
  const names = DECOYS.filter((d) => taken.has(d.id)).map((d) => d.label);
  const tap = (p: Part) => ({
    onClick: () => setPart((cur) => (cur === p ? null : p)),
    'aria-pressed': part === p,
    title: 'What is this?',
  });
  const ring = (p: Part) => (part === p ? 'ring-[3px] ring-accent/40' : '');

  return (
    <div className="flex h-full flex-col gap-3 font-sans">
      <div className="relative min-h-0 flex-1">
        <button {...tap('internet')} className={`absolute inset-y-0 right-0 box-border flex w-[92px] cursor-pointer flex-col items-center justify-center gap-2 rounded-xl px-1.5 text-center transition-colors hover:bg-black/[0.03] ${ring('internet')}`}>
          <span className="size-3.5 rounded-full border-[1.5px] border-dashed border-[#8a9098]" />
          <span className="text-xs leading-4 text-soft">Real<br />internet</span>
          {host && <span className="si-fade font-mono text-[10.5px] leading-[14px] text-[#a8322a] [word-break:break-all]">{host.length > 44 ? `${host.slice(0, 41)}…` : host}</span>}
        </button>

        <div className="absolute inset-y-0 left-0 right-[92px] flex flex-col rounded-[20px] border-[1.5px] border-[#a7bedf] bg-gradient-to-b from-[#f4f8fd] to-[#e8eff8] shadow-[inset_0_0_0_6px_rgba(255,255,255,0.7)]">
          <div className="px-4 pt-3.5">
            <button {...tap('space')} className={`flex cursor-pointer items-center gap-2 rounded-md text-[13px] font-semibold text-[#36537f] hover:underline ${ring('space')}`}>
              <span className="size-2 rounded-[2px] bg-accent" />Throwaway test space
            </button>
          </div>

          <div className="flex flex-1 items-center pl-4">
            <div className="flex w-full items-start">
              <button {...tap('agent')} className="group flex w-[76px] flex-none cursor-pointer flex-col items-center gap-2">
                <span className={`flex size-[68px] items-center justify-center rounded-full bg-ink shadow-[0_6px_16px_rgba(21,24,28,0.18)] transition-transform group-hover:scale-105 ${ring('agent')}`}><span className="size-5 rounded-full border-2 border-white" /></span>
                <span className="whitespace-nowrap text-[13px] font-semibold">AI helper</span>
              </button>

              <div className="relative h-[68px] min-w-[60px] flex-1">
                <div className="absolute inset-x-0 top-[33px] border-t-2 border-dashed border-[#7e9cd0]" />
                {beat === 'calm' && <div className="si-travel absolute top-[30px] -ml-1 size-2 rounded-full bg-accent" />}
                <div className="absolute inset-x-0 top-[42px] px-1 text-center text-[11.5px] leading-[14px] text-[#4a6390]">follows its<br />instructions</div>
              </div>

              <button {...tap('skill')} className="group flex w-[76px] flex-none cursor-pointer flex-col items-center gap-2">
                <span className={`box-border flex size-[68px] items-center justify-center rounded-2xl border-2 border-accent bg-white shadow-[0_6px_16px_rgba(45,91,194,0.14)] transition-transform group-hover:scale-105 ${ring('skill')}`}><span className="size-[22px] rounded-[5px] bg-accent" /></span>
                <span className="text-[13px] font-semibold">Skill</span>
              </button>

              <div className="relative h-[68px] min-w-[72px] flex-1">
                {beat === 'reach' && (
                  <div className="si-grow absolute left-1 top-[33px] h-[3px] w-[60%] rounded-sm bg-red">
                    {arrow}
                    <div className="absolute -top-[30px] left-0 whitespace-nowrap rounded-full border border-[#ebb8b2] bg-white px-[9px] py-[3px] text-[11.5px] text-[#a8322a]">{carried}</div>
                  </div>
                )}
                {beat === 'stop' && (
                  <>
                    <div className="si-fall absolute left-1 right-2.5 top-[33px] h-[3px] rounded-sm bg-red">{arrow}</div>
                    <div className="si-ring absolute -right-4 top-[18px] box-border size-8 rounded-full border-2 border-red bg-red/10" />
                    <div className="si-wall-label absolute right-3 top-[46px] whitespace-nowrap text-[12px] font-semibold text-[#a8322a]">Stopped!</div>
                  </>
                )}
                {beat === 'proof' && <div className="si-stopped-label absolute right-3 top-[22px] z-10 whitespace-nowrap rounded-full border border-[#ebb8b2] bg-red-tint px-2.5 py-1 text-xs font-semibold text-[#a8322a]">Stopped here</div>}
              </div>
            </div>
          </div>

          <div className="px-4 pb-3.5">
            <button {...tap('keys')} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[13px] transition-colors ${names.length ? 'si-fade border-[#d9a441] bg-amber-tint font-semibold text-[#7a4a00]' : 'border-[#d7dde6] bg-white text-body hover:border-accent'} ${ring('keys')}`}>
              <span className={`size-2 rotate-45 ${names.length ? 'bg-[#c07a00]' : 'border-[1.5px] border-soft'}`} />
              {names.length ? `It took a fake key: ${names.join(', ')}` : 'Fake keys, planted as bait'}
            </button>
          </div>

          {/* The wall itself is something you can tap. */}
          <button {...tap('wall')} aria-label="The wall" className={`absolute -right-[7px] bottom-[7%] top-[7%] w-3.5 cursor-pointer rounded-sm ${ring('wall')}`}>
            {(beat === 'proof' || beat === 'stop') && <span className={`absolute left-[5px] top-0 h-full w-1 rounded-sm bg-red shadow-[0_0_0_5px_rgba(200,55,45,0.14),0_0_22px_rgba(200,55,45,0.35)] ${beat === 'stop' ? 'si-flash' : ''}`} />}
          </button>
          {beat === 'proof' && <div className="si-fade pointer-events-none absolute inset-0 rounded-[20px] bg-[#f4f8fd]/30" />}
          {beat === 'destroyed' && (
            <div className="si-dissolve absolute -inset-0.5 flex items-center justify-center rounded-[20px] border-[1.5px] border-dashed border-[#a9afb6] bg-[#f7f7f5]/[0.9]">
              <div className="rounded-full border border-line bg-white px-3.5 py-2 text-[13.5px] font-semibold text-body">Test space destroyed</div>
            </div>
          )}
        </div>
      </div>

      <p aria-live="polite" className={`min-h-[44px] rounded-xl px-3.5 py-2.5 text-[14px] leading-[20px] ${part ? 'si-fade bg-tint text-accent-hover' : 'bg-[#f4f5f2] text-muted'}`}>
        {part ? EXPLAIN[part] : 'Tap anything in the picture to learn what it is.'}
      </p>
    </div>
  );
}

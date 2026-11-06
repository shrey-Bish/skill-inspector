export type Beat = 'calm' | 'reach' | 'stop' | 'proof' | 'clean' | 'destroyed';

export const DECOYS: { id: string; label: string; match: RegExp }[] = [
  { id: 'aws', label: 'AWS keys', match: /AWS/ },
  { id: 'ssh', label: 'SSH key', match: /SSH/ },
  { id: 'github', label: 'GitHub token', match: /GitHub token(?! in the env)/ },
  { id: 'npm', label: 'npm token', match: /npm/ },
  { id: 'dotenv', label: '.env file', match: /\.env/ },
  { id: 'env', label: 'Env variables', match: /in the environment/ },
];

const MAX_FILES = 4;

/** The beats of the catch. Each is driven by a real event in the run; nothing here is replayed. */
export function GlassBox({ beat, host, files, taken, carried, now }: {
  beat: Beat;
  host?: string;
  /** Files this run really touched, in order. */
  files: string[];
  /** Ids of the planted decoys it really read or tried to send. */
  taken: Set<string>;
  /** What rides the arrow: "key" when a decoy is inside the request. */
  carried: string;
  now: string;
}) {
  const arrow = <div className="absolute -right-2 -top-[5.5px] size-0 border-y-[7px] border-l-[11px] border-y-transparent border-l-red" />;
  const shown = files.slice(-MAX_FILES);
  return (
    <div className="relative h-full min-h-[240px] w-full font-sans">
      <div className="absolute inset-y-0 right-0 box-border flex w-24 flex-col items-center justify-center gap-2 px-1.5 text-center md:w-28">
        <div className="size-3.5 rounded-full border-[1.5px] border-dashed border-[#8a9098]" />
        <div className="text-xs leading-4 text-soft">Outside<br />internet</div>
        {host && <div className="si-fade font-mono text-[10.5px] leading-[14px] text-[#a8322a] [word-break:break-all]">{host}</div>}
      </div>

      <div className="absolute inset-y-0 left-0 right-24 flex flex-col rounded-[22px] border-[1.5px] border-[#a7bedf] bg-gradient-to-b from-[#f4f8fd] to-[#e8eff8] shadow-[inset_0_0_0_7px_rgba(255,255,255,0.75),inset_0_0_0_8px_#d3dfef,0_12px_32px_rgba(28,48,86,0.08)] md:right-28">
        <div className="flex items-center gap-2 px-[22px] pt-[18px] text-[13px] font-semibold text-[#36537f]">
          <div className="size-2 rounded-[2px] bg-accent" />Throwaway test space
        </div>

        <div className="flex flex-1 items-center px-[22px]">
          <div className="flex w-full items-start">
            <div className="flex w-[76px] flex-none flex-col items-center gap-2.5">
              <div className="flex size-[72px] items-center justify-center rounded-full bg-ink shadow-[0_6px_16px_rgba(21,24,28,0.18)]"><div className="size-5 rounded-full border-2 border-white" /></div>
              <div className="whitespace-nowrap text-[13px] font-semibold">Test agent</div>
            </div>

            <div className="relative h-[72px] min-w-[68px] flex-[1.4]">
              <div className="absolute inset-x-0 top-[35px] border-t-2 border-dashed border-[#7e9cd0]" />
              {beat === 'calm' && <div className="si-travel absolute top-8 -ml-1 size-2 rounded-full bg-accent" />}
              <div className="absolute inset-x-0 top-[46px] px-1 text-center text-[11.5px] leading-[14px] text-[#4a6390]">follows its instructions</div>
            </div>

            <div className="flex w-[76px] flex-none flex-col items-center gap-2.5">
              <div className="box-border flex size-[72px] items-center justify-center rounded-2xl border-2 border-accent bg-white shadow-[0_6px_16px_rgba(45,91,194,0.14)]"><div className="size-[22px] rounded-[5px] bg-accent" /></div>
              <div className="text-[13px] font-semibold">Skill</div>
            </div>

            <div className="relative -mr-[22px] h-[72px] min-w-9 flex-1">
              {beat === 'reach' && (
                <div className="si-grow absolute left-1 top-[35px] h-[3px] w-[52%] rounded-sm bg-red">
                  {arrow}
                  <div className="absolute -top-[30px] left-0 whitespace-nowrap rounded-full border border-[#ebb8b2] bg-white px-[9px] py-[3px] text-[11.5px] text-[#a8322a]">{carried}</div>
                </div>
              )}
              {beat === 'stop' && (
                <>
                  <div className="si-fall absolute left-1 right-2.5 top-[35px] h-[3px] rounded-sm bg-red">{arrow}</div>
                  <div className="si-ring absolute -right-4 top-5 box-border size-8 rounded-full border-2 border-red bg-red/10" />
                  <div className="si-wall-label absolute right-3.5 top-[50px] whitespace-nowrap text-right text-[12.5px] font-semibold leading-4 text-[#a8322a]">Stopped at the wall</div>
                </>
              )}
              {beat === 'proof' && (
                <>
                  <div className="absolute -right-[3px] top-1.5 z-10 h-[60px] w-1 rounded-sm bg-red" />
                  <div className="si-stopped-label absolute -top-[30px] right-3 z-10 whitespace-nowrap rounded-full border border-[#ebb8b2] bg-red-tint px-2.5 py-1 text-xs font-semibold text-[#a8322a]">Stopped here</div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* What is really in the space: the files it touched, and the decoys we planted. */}
        <div className="flex flex-col gap-3 border-t border-[#d3dfef] px-[22px] pb-[18px] pt-3.5">
          <div className="flex flex-col gap-1.5">
            <div className="text-[11.5px] font-semibold text-[#4a6390]">Files it touched</div>
            <div className="flex min-h-[30px] flex-wrap gap-1.5">
              {shown.length === 0 && <div className="py-1 text-[12.5px] text-faint">None yet</div>}
              {files.length > MAX_FILES && <div className="rounded-lg px-1 py-1 text-[12.5px] text-soft">+{files.length - MAX_FILES} more</div>}
              {shown.map((f) => (
                <div key={f} className="si-fade flex min-w-0 items-center gap-1.5 rounded-lg border border-[#d7dde6] bg-white px-2.5 py-1 text-[12.5px] text-body">
                  <div className="h-[11px] w-[9px] flex-none rounded-[2px] border-[1.5px] border-soft" />
                  <span className="[overflow-wrap:anywhere]">{f}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <div className="text-[11.5px] font-semibold text-[#4a6390]">Decoy keys we planted</div>
            <div className="flex flex-wrap gap-1.5">
              {DECOYS.map((d) => (taken.has(d.id) ? (
                <div key={d.id} className="si-fade flex items-center gap-1.5 rounded-lg border-[1.5px] border-[#d9a441] bg-amber-tint px-2.5 py-1 text-[12.5px] font-semibold text-[#7a4a00]">
                  <div className="size-2 rotate-45 bg-[#c07a00]" />{d.label}
                </div>
              ) : (
                <div key={d.id} className="flex items-center gap-1.5 rounded-lg border border-[#d7dde6] bg-white/70 px-2.5 py-1 text-[12.5px] text-soft">
                  <div className="size-2 rotate-45 border-[1.5px] border-[#9aa1a9]" />{d.label}
                </div>
              )))}
            </div>
          </div>
          <div aria-hidden className="truncate border-t border-[#d3dfef] pt-2.5 text-[12.5px] text-[#36537f]">{now}</div>
        </div>

        {beat === 'stop' && <div className="si-flash absolute -right-[2.5px] bottom-[7%] top-[7%] w-1 rounded-sm bg-red shadow-[0_0_0_5px_rgba(200,55,45,0.14),0_0_22px_rgba(200,55,45,0.35)]" />}
        {beat === 'proof' && <div className="si-fade pointer-events-none absolute inset-0 rounded-[20px] bg-[#f4f8fd]/40" />}
        {beat === 'destroyed' && (
          <div className="si-dissolve absolute -inset-0.5 flex items-center justify-center rounded-[22px] border-[1.5px] border-dashed border-[#a9afb6] bg-[#f7f7f5]/[0.86]">
            <div className="rounded-full border border-line bg-white px-3.5 py-2 text-[13.5px] font-semibold text-body">Test space destroyed</div>
          </div>
        )}
      </div>
    </div>
  );
}

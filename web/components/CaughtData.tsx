import type { OutboundAttempt } from '@/lib/api';

function pretty(body: string): string {
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}

export function addressOf(a: OutboundAttempt): string {
  if (a.kind === 'dns') return a.host;
  return `${a.tls ? 'https' : 'http'}://${a.host}${a.path ?? ''}`;
}

const HOW: Record<string, string> = {
  base64: 'hidden with base64',
  hex: 'hidden as hex',
  url: 'URL-encoded',
  reversed: 'written backwards',
  dns: 'hidden in a website name',
};

/** Every value shown here comes from the fake internet's record of this run. */
export function Highlighted({ text, attempt, className }: { text: string; attempt: OutboundAttempt; className?: string }) {
  const needles = [...new Set(attempt.matches.map((m) => m.text).filter((t) => t && text.includes(t)))];
  if (needles.length === 0) return <span className={className}>{text}</span>;
  const pattern = new RegExp(`(${needles.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`);
  return (
    <span className={className}>
      {text.split(pattern).map((part, i) =>
        needles.includes(part)
          ? <mark key={i} className="si-mark rounded bg-[#f2c46b] px-1 py-px text-ink [word-break:break-all]">{part}</mark>
          : <span key={i}>{part}</span>,
      )}
    </span>
  );
}

export function SentData({ attempt }: { attempt: OutboundAttempt }) {
  const body = attempt.body ? pretty(attempt.body) : '';
  const elsewhere = attempt.matches.filter((m) => !body.includes(m.text) && !attempt.host.includes(m.text));
  if (!body && elsewhere.length === 0) {
    return attempt.kind === 'tls-rejected'
      ? <span>It refused our test certificate, so we couldn&apos;t read what it was carrying.</span>
      : attempt.kind === 'dns'
        ? <span>The data was hidden in the website name above.</span>
        : <span>No data in this request. It only asked for something.</span>;
  }
  return (
    <span className="whitespace-pre-wrap">
      {body && <Highlighted text={body} attempt={attempt} />}
      {elsewhere.map((m) => (
        <span key={m.decoy} className="block">
          {m.label}: <mark className="rounded bg-[#f2c46b] px-1 py-px text-ink">{m.text}</mark>
        </span>
      ))}
    </span>
  );
}

export function Disguises({ attempt }: { attempt: OutboundAttempt }) {
  const how = [...new Set(attempt.matches.map((m) => HOW[m.encoding]).filter(Boolean))];
  if (how.length === 0) return null;
  return <div className="font-sans text-[12.5px] font-semibold text-[#f2c46b]">The key was {how.join(' and ')}. We decoded it to find it.</div>;
}

export function CaughtPanel({ attempt, onContinue }: { attempt: OutboundAttempt; onContinue?: () => void }) {
  const key = attempt.matches.length > 0;
  return (
    <div data-si-caught className="si-panel flex min-w-[280px] flex-[0_1_340px] flex-col overflow-hidden rounded-2xl border-[1.5px] border-red bg-white shadow-[0_10px_28px_rgba(200,55,45,0.12)]">
      <div className="flex items-center justify-between gap-3 bg-red-tint px-[18px] py-3.5">
        <div className="text-[15px] font-semibold text-red-text">Caught request</div>
        <span className="flex-none rounded-full bg-red px-2.5 py-[3px] text-xs font-semibold text-white">Stopped</span>
      </div>
      <div className="flex flex-1 flex-col gap-4 p-[18px]">
        <div className="flex flex-col gap-1.5">
          <div className="text-[13px] text-soft">Outside address</div>
          <div className="font-mono text-[13.5px] leading-5 [word-break:break-all]"><Highlighted text={addressOf(attempt)} attempt={attempt} /></div>
        </div>
        <div className="flex flex-col gap-1.5">
          <div className="text-[13px] text-soft">Data it tried to send</div>
          <div className="flex max-h-[260px] flex-col gap-2 overflow-auto rounded-xl bg-ink px-4 py-3.5 font-mono text-[13px] leading-[22px] text-[#e6e8eb] [word-break:break-all]">
            <SentData attempt={attempt} />
            <Disguises attempt={attempt} />
          </div>
        </div>
        {key && (
          <div className="flex items-start gap-2.5 rounded-[10px] bg-amber-tint px-3 py-2.5 text-[13.5px] leading-5 text-[#5b3b00]">
            <span className="mt-1.5 size-2 flex-none rotate-45 bg-[#c07a00]" />
            <span><b>Decoy key:</b> fake, planted by us, unlocks nothing.</span>
          </div>
        )}
        {onContinue && (
          <button onClick={onContinue} className="si-continue mt-auto h-[46px] flex-none cursor-pointer rounded-xl bg-ink text-[15px] font-semibold text-white transition-colors hover:bg-body">Continue to the report</button>
        )}
      </div>
    </div>
  );
}

'use client';
import { useState } from 'react';
import type { OutboundAttempt } from '@/lib/api';

function pretty(body: string): string {
  try {
    return JSON.stringify(JSON.parse(body), null, 2).replace(/\\n"/g, '"').replace(/\\n/g, '\n  ');
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

/** The keys it tried to send, shown on their own so nobody has to read a raw message. */
export function StolenKeys({ attempt }: { attempt: OutboundAttempt }) {
  const seen = new Set<string>();
  const keys = attempt.matches.filter((m) => !seen.has(m.label) && Boolean(seen.add(m.label)));
  return (
    <div className="flex flex-col gap-2">
      {keys.map((m) => (
        <div key={m.decoy} className="flex flex-col gap-1">
          <div className="text-[13px] font-medium">{m.label}</div>
          <div className="font-mono text-[13px] leading-5 [word-break:break-all]">
            <mark className="si-mark rounded bg-[#f2c46b] px-1.5 py-0.5 text-ink [word-break:break-all]">{m.encoding === 'dns' ? 'hidden in the website name' : m.text.slice(0, 80)}</mark>
          </div>
        </div>
      ))}
    </div>
  );
}

export function CaughtPanel({ attempt, onContinue }: { attempt: OutboundAttempt; onContinue?: () => void }) {
  const [raw, setRaw] = useState(false);
  const key = attempt.matches.length > 0;
  return (
    <div data-si-caught className="si-panel flex h-full min-w-0 flex-col overflow-hidden rounded-[20px] border-[1.5px] border-red bg-white shadow-[0_10px_28px_rgba(200,55,45,0.12)]">
      <div className="bg-red-tint px-5 py-3 text-[17px] font-semibold text-red-text">Caught it!</div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 py-3.5">
        {key && (
          <div className="flex flex-col gap-1.5">
            <div className="text-[13px] text-soft">It tried to send</div>
            <StolenKeys attempt={attempt} />
          </div>
        )}
        <div className="flex flex-col gap-1">
          <div className="text-[13px] text-soft">To this website</div>
          <div className="font-mono text-[13px] leading-5 [word-break:break-all]">{attempt.host}</div>
        </div>
        {key && <p className="rounded-[10px] bg-amber-tint px-3 py-2 text-[13.5px] leading-5 text-[#5b3b00]">Keys work like passwords. This one is fake bait we planted, so it unlocks nothing. On your computer, it could have been real.</p>}
        <button aria-expanded={raw} onClick={() => setRaw((v) => !v)} className="cursor-pointer self-start text-[13.5px] font-medium text-accent underline-offset-2 hover:underline">{raw ? 'Hide the exact message' : 'See the exact message'}</button>
        {raw && (
          <div className="si-fade flex flex-col gap-2 rounded-xl bg-ink px-4 py-3 font-mono text-[12.5px] leading-5 text-[#e6e8eb] [word-break:break-all]">
            <SentData attempt={attempt} />
            <Disguises attempt={attempt} />
          </div>
        )}
      </div>
      {onContinue && (
        <div className="border-t border-line2 p-3.5">
          <button onClick={onContinue} className="si-continue h-[46px] w-full cursor-pointer rounded-xl bg-ink text-[15px] font-semibold text-white transition-colors hover:bg-body">Continue</button>
        </div>
      )}
    </div>
  );
}

'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { isRecording, withMode, type Level } from '@/lib/api';

export function useRecording(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => setOn(isRecording()), []);
  return on;
}

export function Logo({ large = false }: { large?: boolean }) {
  return (
    <span className={`flex items-center whitespace-nowrap font-semibold ${large ? 'gap-3 text-[22px]' : 'gap-2.5 text-base'}`}>
      <span className={`box-border flex items-center justify-center border-ink ${large ? 'size-[30px] rounded-lg border-[2.5px]' : 'size-[22px] rounded-md border-2'}`}>
        <span className={`bg-accent ${large ? 'size-2.5 rounded-[3px]' : 'size-2 rounded-[2px]'}`} />
      </span>
      Skill Inspector
    </span>
  );
}

export function Nav({ current, children }: { current?: 'history'; children?: React.ReactNode }) {
  const recording = useRecording();
  return (
    <header className="flex h-14 items-center justify-between gap-4 border-b border-line bg-white px-5 md:h-16 md:px-10">
      <Link href={withMode('/?stay=1')} className="text-ink no-underline"><Logo /></Link>
      <div className="flex items-center gap-4 md:gap-6">
        {children}
        {!recording && <Link href="/history/" className={`text-[15px] hover:text-ink ${children ? 'hidden sm:inline' : ''} ${current === 'history' ? 'font-semibold text-ink' : 'text-muted'}`}>History</Link>}
      </div>
    </header>
  );
}

export function TestSampleChip({ small = false }: { small?: boolean }) {
  return (
    <span className={`whitespace-nowrap rounded-full bg-tint px-2.5 py-1 font-semibold text-accent-hover ${small ? 'text-xs' : 'text-[12.5px]'}`}>
      Built-in test sample
    </span>
  );
}

/** Colour is always paired with a shape: calm is a circle, caution a diamond, stop a square. */
export function Marker({ level }: { level: Level }) {
  if (level === 'caution') return <span aria-label="Caution" className="ml-px size-[9px] flex-none rotate-45 bg-amber" />;
  if (level === 'stop') return <span aria-label="Stop" className="size-2.5 flex-none rounded-[2px] bg-red" />;
  return <span aria-label="Calm" className="size-2.5 flex-none rounded-full bg-green" />;
}

export function Check({ size = 22 }: { size?: number }) {
  return (
    <span style={{ width: size, height: size }} className="mt-0.5 flex flex-none items-center justify-center rounded-full bg-green text-xs font-bold text-white">✓</span>
  );
}

const button = 'inline-flex cursor-pointer items-center justify-center rounded-xl text-[15.5px] font-semibold no-underline transition-colors duration-300';
export const primaryButton = `${button} h-[46px] bg-accent px-5 text-white hover:bg-accent-hover hover:text-white`;
export const secondaryButton = `${button} h-[46px] border border-[#cfd3ce] bg-white px-[18px] text-ink hover:border-ink`;

export function CheckAnother({ className = '' }: { className?: string }) {
  return <Link href={withMode('/?stay=1')} className={`${primaryButton} ${className}`}>Check another</Link>;
}

export function VultrBadge({ large = false }: { large?: boolean }) {
  return (
    <span className={`flex items-center gap-2 whitespace-nowrap rounded-full border border-[#c9d7f2] bg-tint font-semibold text-accent-hover ${large ? 'px-[18px] py-2.5 text-xl' : 'px-3 py-1.5 text-[13.5px]'}`}>
      <span className={`rounded-full bg-accent ${large ? 'size-2.5' : 'size-[7px]'}`} />Sandbox on Vultr
    </span>
  );
}

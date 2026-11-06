import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geist = Geist({ subsets: ['latin'], variable: '--font-geist', weight: ['400', '500', '600', '700'] });
const mono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono', weight: ['400', '500'] });

export const metadata: Metadata = {
  title: 'Skill Inspector',
  description: 'Check an AI agent skill in a throwaway test space before you install it.',
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

// Recording mode has to apply before first paint, so the frame never flashes the normal layout.
const recordScript = `if(new URLSearchParams(location.search).has('record'))document.documentElement.classList.add('record')`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} ${mono.variable}`} suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: recordScript }} /></head>
      <body>{children}</body>
    </html>
  );
}

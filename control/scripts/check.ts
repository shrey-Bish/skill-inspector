// Runs one real check from the command line and prints the feed and the report.
// Usage: node control/scripts/check.ts sample:note-polish
import { randomBytes } from 'node:crypto';
import { runCheck } from '../src/run.ts';
import type { Check } from '../src/types.ts';

const check: Check = { id: randomBytes(6).toString('hex'), input: process.argv[2], status: 'queued', createdAt: new Date().toISOString(), feed: [] };
await runCheck(check, {
  emit: (e) => console.log(`[${e.step ?? '-'}] ${e.level.padEnd(7)} ${e.text}${(e.data as { ranOutOf?: string })?.ranOutOf ? ` (${(e.data as { ranOutOf: string }).ranOutOf})` : ''}`),
  update: () => {},
  decide: async () => false,
});
console.log(`\nSTATUS ${check.status}${check.problem ? `: ${check.problem}` : ''}`);
if (check.report) {
  const { details, ...r } = check.report;
  console.log(JSON.stringify(r, null, 2));
  console.log('files', JSON.stringify(details.files));
  console.log('processes', JSON.stringify(details.processes).slice(0, 600));
}

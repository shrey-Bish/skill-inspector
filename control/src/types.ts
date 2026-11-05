export type Level = 'info' | 'safe' | 'caution' | 'stop';
export type Grade = 'A' | 'B' | 'C' | 'D' | 'F';
export type Verdict = 'Safe to install' | 'Risky' | 'Do not install';
export type CheckStatus = 'queued' | 'running' | 'done' | 'couldnt_check';

export type ParsedInput =
  | { kind: 'sample'; id: string; raw: string }
  | { kind: 'github'; owner: string; repo: string; ref?: string; path?: string; skill?: string; raw: string };

export interface Decoy {
  id: string;
  label: string;
  value: string;
  /** Absolute path in the sandbox. Absent for environment-variable decoys. */
  path?: string;
  envVar?: string;
}

export interface DecoyMatch {
  decoy: string;
  label: string;
  encoding: 'plain' | 'url' | 'base64' | 'hex' | 'reversed' | 'dns';
  /** The text as it appeared in the outbound data, so the UI can highlight it. */
  text: string;
}

export interface FileEvent {
  path: string;
  mode: 'read' | 'write' | 'delete';
  ok: boolean;
  decoy?: string;
  sensitive?: boolean;
}

export interface OutboundAttempt {
  host: string;
  ip?: string | null;
  port?: number;
  tls: boolean;
  /** dns: name lookup only. tls-rejected: refused our certificate, so the body was not seen. */
  kind: 'request' | 'dns' | 'tls-rejected' | 'refused';
  method?: string;
  path?: string;
  body?: string;
  matches: DecoyMatch[];
  registry?: boolean;
}

export interface CommandRecord {
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  ms: number;
  timedOut: boolean;
}

export interface Evidence {
  commands: CommandRecord[];
  files: FileEvent[];
  processes: string[];
  network: OutboundAttempt[];
  hiddenText: string[];
  refusedInstructions: string[];
}

export interface Signal {
  level: Exclude<Level, 'info'>;
  title: string;
  plain: string;
}

export interface SaysVsDid {
  says: string[];
  did: { text: string; surprise: boolean }[];
}

export interface Containment {
  happened: boolean;
  plain: string;
  blocked: string;
  caught: OutboundAttempt | null;
}

export interface Report {
  grade: Grade;
  verdict: Verdict;
  summary: string;
  signals: Signal[];
  saysVsDid: SaysVsDid;
  containment: Containment;
  task: string;
  limits: { seconds: number; memory: string; cpus: number };
  sandbox: { kernel: string | null; destroyed: boolean; ms: number };
  details: {
    files: FileEvent[];
    network: OutboundAttempt[];
    processes: string[];
    commands: CommandRecord[];
    installLog: string;
  };
}

export interface FeedEvent {
  seq: number;
  at: string;
  step?: 'setup' | 'load' | 'task' | 'grade';
  level: Level;
  text: string;
  /** Structured extras for the UI: the caught request, a confirm prompt, and so on. */
  data?: unknown;
}

export interface SkillInfo {
  name: string;
  description: string;
  instructions: string;
  dir: string;
  source: string;
  sample: boolean;
  /** A built-in sample that is meant to behave badly. Shown with a label in the UI. */
  testSample: boolean;
}

export interface Check {
  id: string;
  input: string;
  status: CheckStatus;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  skill?: { name: string; description: string; source: string; testSample: boolean };
  report?: Report;
  /** Plain words for the "couldn't check" state. */
  problem?: string;
  feed: FeedEvent[];
}

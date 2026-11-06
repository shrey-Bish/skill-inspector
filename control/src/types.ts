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
  /** Opened as a folder to see what is in it, rather than read as a file. */
  listing?: boolean;
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
  /** A custom header long enough to carry data, the way a request body would. */
  bulkyHeader?: boolean;
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
  /** Lines in the skill's text that send a place keys are kept to somewhere else. */
  keySendingText: string[];
  /** Commands that can't be undone: asked for at runtime, or written in the skill's text. */
  irreversible: string[];
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
  partial: boolean;
  limits: { seconds: number; memory: string; cpus: number };
  sandbox: { kernel: string | null; destroyed: boolean; ms: number };
  details: {
    files: FileEvent[];
    network: OutboundAttempt[];
    processes: string[];
    commands: CommandRecord[];
    installLog: string;
    /** What the agent said it skipped. Its opinion, not an observation, so it never affects the grade. */
    agentNotes: string[];
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
  /** A repo with many skills: nothing ran, and the person picks one of these. */
  choices?: { name: string; description: string }[];
  /** True once a test space existed, so a failure can say honestly whether the skill ran. */
  sandboxStarted?: boolean;
  /** Plain words for the "couldn't check" state. */
  problem?: string;
  feed: FeedEvent[];
}

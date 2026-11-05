// Provider-agnostic chat wrapper. Defaults to Vultr Serverless Inference, which the
// Blast Radius Zero track requires for agent LLM calls. Runs on the control VM only;
// the key never enters a sandbox.

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolDef {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface ChatOptions {
  messages: Message[];
  tools?: ToolDef[];
  model?: string;
  maxTokens?: number;
  temperature?: number;
  json?: boolean;
  timeoutMs?: number;
  budget?: TokenBudget;
}

export interface ChatResult {
  message: Message;
  totalTokens: number;
  model: string;
}

export class LlmError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'LlmError';
    this.status = status;
  }
}

/** A hard cap on what one check may spend. */
export class TokenBudget {
  limit: number;
  used = 0;
  constructor(limit: number) {
    this.limit = limit;
  }
  get exhausted(): boolean {
    return this.used >= this.limit;
  }
}

const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

export async function chat(opts: ChatOptions): Promise<ChatResult> {
  const key = process.env.VULTR_INFERENCE_API_KEY;
  const base = process.env.VULTR_INFERENCE_BASE_URL ?? 'https://api.vultrinference.com/v1';
  const model = opts.model ?? process.env.VULTR_INFERENCE_MODEL ?? 'qwen3.8-flash-next';
  if (!key) throw new LlmError('VULTR_INFERENCE_API_KEY is not set');
  if (opts.budget?.exhausted) throw new LlmError('Token budget used up for this check');

  const body = JSON.stringify({
    model,
    messages: opts.messages,
    ...(opts.tools ? { tools: opts.tools, tool_choice: 'auto' } : {}),
    max_tokens: opts.maxTokens ?? 4000,
    temperature: opts.temperature ?? 0.2,
    ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
  });

  let lastError: LlmError | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await sleep(800 * 2 ** attempt);
    let res: Response;
    try {
      res = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body,
        signal: AbortSignal.timeout(opts.timeoutMs ?? 45_000),
      });
    } catch (err) {
      lastError = new LlmError(`Inference request failed: ${(err as Error).message}`);
      continue;
    }
    if (res.status === 429 || res.status >= 500) {
      const wait = Number(res.headers.get('retry-after') ?? 0);
      if (wait > 0 && wait < 20) await sleep(wait * 1000);
      lastError = new LlmError(`Inference returned ${res.status}`, res.status);
      continue;
    }
    if (!res.ok) throw new LlmError(`Inference returned ${res.status}`, res.status);

    const data = (await res.json()) as {
      choices?: { message: Message }[];
      usage?: { total_tokens?: number };
      model?: string;
    };
    const message = data.choices?.[0]?.message;
    if (!message) throw new LlmError('Inference returned no message');
    const totalTokens = data.usage?.total_tokens ?? 0;
    if (opts.budget) opts.budget.used += totalTokens;
    return { message, totalTokens, model: data.model ?? model };
  }
  throw lastError ?? new LlmError('Inference failed');
}

/** Pulls the first JSON object out of a model reply, tolerating fences and chatter. */
export function parseJsonReply<T>(text: string | null | undefined): T | null {
  if (!text) return null;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}

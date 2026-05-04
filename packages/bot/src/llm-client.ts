/**
 * LLMClient 实现 — 火山方舟（Doubao）adapter。
 *
 * 约束（来自 contracts/llm.ts + issue）：
 *   - 所有 LLM 调用统一走 ask / chat / askStructured，不允许散落 fetch
 *   - 失败重试 3 次（指数退避 1s / 2s / 4s）
 *   - 单次超时 30s，超时后继续重试
 *   - 全部失败后返回 err 兜底，不崩溃
 *   - 每次调用打日志：模型名 / prompt_tokens / completion_tokens / 耗时
 *   - askStructured 第一次 schema 不符时自动追问一次
 */

import {
  type LLMClient,
  type ChatMessage,
  type AskOptions,
  type ChatWithToolsOptions,
  type ChatWithToolsResult,
  type LLMTool,
  type ToolCall,
  type SchemaLike,
  type Result,
  ok,
  err,
  ErrorCode,
  makeError,
} from '@seedhac/contracts';

// ---------- Config ----------

export interface LLMConfig {
  readonly apiKey: string;
  readonly modelIds: {
    readonly lite: string;
    readonly pro: string;
  };
  readonly baseUrl?: string;
}

// ---------- Internal types ----------

interface ArkToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface ArkMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ArkToolCall[];
  tool_call_id?: string;
  name?: string;
}

interface ArkResponse {
  choices: Array<{
    message: {
      content: string | null;
      tool_calls?: ArkToolCall[];
    };
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
  };
}

type ArkToolChoice = 'auto' | 'none' | { type: 'function'; function: { name: string } };

// ---------- Constants ----------

const DEFAULT_TIMEOUT_MS = 30_000;
const RETRY_DELAYS_MS = [1000, 2000, 4000] as const;
const DEFAULT_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3';

// ---------- Utilities ----------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 剥掉 LLM 常见的 Markdown 代码块包装，再交给 JSON.parse */
function stripCodeFence(raw: string): string {
  const match = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  return match ? match[1]!.trim() : raw.trim();
}

function logCall(params: {
  model: string;
  promptTokens: number;
  completionTokens: number;
  durationMs: number;
}): void {
  console.log(
    `[LLMClient] model=${params.model} prompt_tokens=${params.promptTokens} completion_tokens=${params.completionTokens} duration=${params.durationMs}ms`,
  );
}

function toArkToolChoice(toolChoice: AskOptions['toolChoice']): ArkToolChoice | undefined {
  if (toolChoice === undefined) return undefined;
  if (toolChoice === 'auto' || toolChoice === 'none') return toolChoice;
  return { type: 'function', function: { name: toolChoice } };
}

// ---------- Implementation ----------

export class VolcanoLLMClient implements LLMClient {
  private readonly config: Required<LLMConfig>;

  constructor(config: LLMConfig) {
    this.config = {
      ...config,
      baseUrl: config.baseUrl ?? DEFAULT_BASE_URL,
    };
  }

  private modelId(model: 'lite' | 'pro' = 'pro'): string {
    return this.config.modelIds[model];
  }

  /**
   * 核心调用：带重试（最多 3 次）+ 单次超时（30s），全部失败后返回 err 兜底。
   */
  private async callApi(
    messages: ArkMessage[],
    opts: AskOptions = {},
  ): Promise<
    Result<{
      content: string;
      rawToolCalls?: ArkToolCall[];
      promptTokens: number;
      completionTokens: number;
    }>
  > {
    const modelId = this.modelId(opts.model ?? 'pro');
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    const body = JSON.stringify({
      model: modelId,
      messages,
      ...(opts.maxTokens !== undefined && { max_tokens: opts.maxTokens }),
      ...(opts.temperature !== undefined && { temperature: opts.temperature }),
      ...(opts.tools !== undefined && {
        tools: opts.tools.map((t: LLMTool) => ({
          type: 'function',
          function: { name: t.name, description: t.description, parameters: t.parameters },
        })),
      }),
      ...(opts.toolChoice !== undefined && { tool_choice: toArkToolChoice(opts.toolChoice) }),
    });

    let lastErr: unknown;

    for (let attempt = 0; attempt < 3; attempt++) {
      const startMs = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const resp = await fetch(`${this.config.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.config.apiKey}`,
          },
          body,
          signal: controller.signal,
        });

        clearTimeout(timer);

        if (!resp.ok) {
          const text = await resp.text();
          throw new Error(`HTTP ${resp.status}: ${text}`);
        }

        const data = (await resp.json()) as ArkResponse;
        const msg = data.choices[0]?.message;
        const content = msg?.content ?? '';
        const rawToolCalls = msg?.tool_calls;
        const promptTokens = data.usage?.prompt_tokens ?? 0;
        const completionTokens = data.usage?.completion_tokens ?? 0;

        logCall({
          model: modelId,
          promptTokens,
          completionTokens,
          durationMs: Date.now() - startMs,
        });

        return ok({
          content,
          ...(rawToolCalls !== undefined && { rawToolCalls }),
          promptTokens,
          completionTokens,
        });
      } catch (e) {
        clearTimeout(timer);
        lastErr = e;
        if (attempt < 2) await sleep(RETRY_DELAYS_MS[attempt] ?? 1000);
      }
    }

    const isTimeout = lastErr instanceof Error && lastErr.name === 'AbortError';
    return err(
      makeError(
        isTimeout ? ErrorCode.LLM_TIMEOUT : ErrorCode.LLM_INVALID_RESPONSE,
        isTimeout
          ? 'LLM request timed out after 3 attempts'
          : 'LLM request failed after 3 attempts',
        lastErr,
      ),
    );
  }

  async ask(prompt: string, opts?: AskOptions): Promise<Result<string>> {
    const messages: ArkMessage[] = [];
    if (opts?.systemPrompt) {
      messages.push({ role: 'system', content: opts.systemPrompt });
    }
    messages.push({ role: 'user', content: prompt });

    const result = await this.callApi(messages, opts);
    if (!result.ok) return result;
    return ok(result.value.content);
  }

  async chat(messages: readonly ChatMessage[], opts?: AskOptions): Promise<Result<string>> {
    const arkMessages: ArkMessage[] = messages.map(chatMessageToArk);
    const result = await this.callApi(arkMessages, opts);
    if (!result.ok) return result;
    return ok(result.value.content);
  }

  async askStructured<T>(
    prompt: string,
    schema: SchemaLike<T>,
    opts?: AskOptions,
  ): Promise<Result<T>> {
    const schemaHint = schema.jsonSchema?.() ?? {};
    const fullPrompt =
      `${prompt}\n\nRespond with valid JSON matching this schema:\n` +
      `${JSON.stringify(schemaHint, null, 2)}\n\nOutput only the JSON, no explanation.`;

    const messages: ArkMessage[] = [];
    if (opts?.systemPrompt) {
      messages.push({ role: 'system', content: opts.systemPrompt });
    }
    messages.push({ role: 'user', content: fullPrompt });

    const result = await this.callApi(messages, opts);
    if (!result.ok) return result;

    // First parse attempt（strip Markdown code fences before parsing）
    try {
      return ok(schema.parse(JSON.parse(stripCodeFence(result.value.content))));
    } catch {
      // Auto-retry once: append assistant reply + corrective user turn
      const retryMessages: ArkMessage[] = [
        ...messages,
        { role: 'assistant', content: result.value.content },
        {
          role: 'user',
          content:
            'Your previous response was not valid JSON matching the schema. Please try again and output only valid JSON.',
        },
      ];

      const retryResult = await this.callApi(retryMessages, opts);
      if (!retryResult.ok) return retryResult;

      try {
        return ok(schema.parse(JSON.parse(stripCodeFence(retryResult.value.content))));
      } catch (e) {
        return err(
          makeError(
            ErrorCode.LLM_INVALID_RESPONSE,
            'askStructured: schema parse failed after retry',
            e,
          ),
        );
      }
    }
  }

  async chatWithTools(
    messages: readonly ChatMessage[],
    opts: ChatWithToolsOptions,
  ): Promise<Result<ChatWithToolsResult>> {
    const maxRounds = opts.maxToolCallRounds ?? 5;
    const allToolCalls: ToolCall[] = [];
    const history: ArkMessage[] = messages.map(chatMessageToArk);
    let lastContent = '';

    for (let round = 0; round < maxRounds; round++) {
      const result = await this.callApi(history, opts);
      if (!result.ok) return result;

      const { content, rawToolCalls } = result.value;
      lastContent = content;

      if (!rawToolCalls || rawToolCalls.length === 0) {
        return ok({ content, toolCalls: allToolCalls, rounds: round + 1 });
      }

      // 把 assistant 的 tool_calls 消息追加进历史
      history.push({ role: 'assistant', content, tool_calls: rawToolCalls });

      // 执行每个 tool call；executor 抛错时隔离为 error ToolResult 回灌模型
      for (const raw of rawToolCalls) {
        const toolCall: ToolCall = {
          id: raw.id,
          name: raw.function.name,
          argumentsRaw: raw.function.arguments,
        };
        allToolCalls.push(toolCall);

        let toolContent: string;
        try {
          const toolResult = await opts.executor(toolCall);
          toolContent = toolResult.content;
        } catch (e) {
          toolContent = JSON.stringify({
            error: e instanceof Error ? e.message : 'executor threw unexpectedly',
          });
        }

        history.push({
          role: 'tool',
          content: toolContent,
          tool_call_id: raw.id,
          name: raw.function.name,
        });
      }
    }

    // 达到轮数上限：返回最后一次 content，调用方决定如何处理
    return ok({ content: lastContent, toolCalls: allToolCalls, rounds: maxRounds });
  }
}

// ---------- 工具函数 ----------

function chatMessageToArk(m: ChatMessage): ArkMessage {
  const base: ArkMessage = { role: m.role, content: m.content };
  if (m.toolCalls && m.toolCalls.length > 0) {
    base.tool_calls = m.toolCalls.map((tc) => ({
      id: tc.id,
      type: 'function',
      function: { name: tc.name, arguments: tc.argumentsRaw },
    }));
  }
  if (m.toolCallId !== undefined) base.tool_call_id = m.toolCallId;
  if (m.name !== undefined) base.name = m.name;
  return base;
}

// ---------- 工厂函数（从环境变量读取配置）----------

export function createLLMClient(): VolcanoLLMClient {
  const required = (key: string): string => {
    const val = process.env[key];
    if (!val) throw new Error(`Missing required env var: ${key}`);
    return val;
  };

  return new VolcanoLLMClient({
    apiKey: required('ARK_API_KEY'),
    modelIds: {
      lite: required('ARK_MODEL_LITE'),
      pro: required('ARK_MODEL_PRO'),
    },
  });
}

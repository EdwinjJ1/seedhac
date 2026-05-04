import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VolcanoLLMClient, type LLMConfig } from '../llm-client.js';
import { ErrorCode } from '@seedhac/contracts';

// ---------- helpers ----------

const CONFIG: LLMConfig = {
  apiKey: 'test-api-key',
  modelIds: { lite: 'ep-lite-xxx', pro: 'ep-pro-xxx' },
  baseUrl: 'https://ark.test',
};

function makeClient(): VolcanoLLMClient {
  return new VolcanoLLMClient(CONFIG);
}

function mockFetchOk(content: string, promptTokens = 10, completionTokens = 5): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content } }],
        usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens },
      }),
      text: async () => content,
    }),
  );
}

function mockFetchFail(message = 'network error'): void {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error(message)));
}

function mockFetchHttpError(status = 500): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: false,
      status,
      text: async () => 'Internal Server Error',
    }),
  );
}

// ---------- tests ----------

describe('VolcanoLLMClient', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  // 1. ask — happy path
  it('ask returns plain text on success', async () => {
    mockFetchOk('Hello, world!');

    const result = await makeClient().ask('say hello');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe('Hello, world!');
    }
    expect(fetch).toHaveBeenCalledOnce();
  });

  // 2. ask — systemPrompt is sent as first message
  it('ask includes systemPrompt as system message', async () => {
    mockFetchOk('ok');

    await makeClient().ask('question', { systemPrompt: 'You are helpful.' });

    const body = JSON.parse((vi.mocked(fetch).mock.calls[0]![1] as RequestInit).body as string);
    expect(body.messages[0]).toEqual({ role: 'system', content: 'You are helpful.' });
    expect(body.messages[1]).toEqual({ role: 'user', content: 'question' });
  });

  // 3. askStructured — happy path with valid JSON
  it('askStructured returns parsed object when LLM returns valid JSON', async () => {
    mockFetchOk(JSON.stringify({ name: 'Antares', score: 42 }));

    const schema = {
      parse: (v: unknown) => v as { name: string; score: number },
      jsonSchema: () => ({
        type: 'object',
        properties: { name: { type: 'string' }, score: { type: 'number' } },
      }),
    };

    const result = await makeClient().askStructured('extract info', schema);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ name: 'Antares', score: 42 });
    }
  });

  // 4. askStructured — auto-retry once on schema mismatch, succeeds second time
  it('askStructured auto-retries once when first response fails schema parse', async () => {
    const validJson = JSON.stringify({ name: 'Antares' });
    let callCount = 0;

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => {
        callCount++;
        const content = callCount === 1 ? 'not valid json at all' : validJson;
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content } }],
            usage: { prompt_tokens: 10, completion_tokens: 5 },
          }),
        };
      }),
    );

    const schema = {
      parse: (v: unknown) => {
        const obj = v as { name: string };
        if (!obj.name) throw new Error('invalid');
        return obj;
      },
    };

    const result = await makeClient().askStructured('extract', schema);

    expect(result.ok).toBe(true);
    expect(callCount).toBe(2);
  });

  // 5. askStructured — returns LLM_INVALID_RESPONSE after both attempts fail schema
  it('askStructured returns LLM_INVALID_RESPONSE when both attempts fail schema', async () => {
    mockFetchOk('not json at all ~~~');

    const schema = {
      parse: (_: unknown) => {
        throw new Error('always fails');
      },
    };

    const result = await makeClient().askStructured('extract', schema);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(ErrorCode.LLM_INVALID_RESPONSE);
    }
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  // 6. retry — retries 3 times on network error then returns err (no crash)
  it('retries 3 times and returns err after all network failures', async () => {
    mockFetchFail('connection refused');

    const promise = makeClient().ask('hello');
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(ErrorCode.LLM_INVALID_RESPONSE);
    }
    expect(fetch).toHaveBeenCalledTimes(3);
  }, 15_000);

  // 7. retry — succeeds on second attempt
  it('retries and succeeds on second attempt', async () => {
    let callCount = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) throw new Error('transient');
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: 'recovered' } }],
            usage: { prompt_tokens: 5, completion_tokens: 3 },
          }),
        };
      }),
    );

    const promise = makeClient().ask('hello');
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe('recovered');
    expect(callCount).toBe(2);
  }, 5_000);

  // 8. fallback — HTTP 500 retries and returns err without throwing
  it('returns err on HTTP 500 after 3 retries without throwing', async () => {
    mockFetchHttpError(500);

    const promise = makeClient().ask('hello');
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(ErrorCode.LLM_INVALID_RESPONSE);
    }
    expect(fetch).toHaveBeenCalledTimes(3);
  }, 15_000);

  // 9. chat — passes messages array through correctly
  it('chat sends all messages and returns content', async () => {
    mockFetchOk('I am an assistant.');

    const result = await makeClient().chat([
      { role: 'user', content: 'who are you?' },
      { role: 'assistant', content: 'I am helpful.' },
      { role: 'user', content: 'tell me more' },
    ]);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe('I am an assistant.');

    const body = JSON.parse((vi.mocked(fetch).mock.calls[0]![1] as RequestInit).body as string);
    expect(body.messages).toHaveLength(3);
  });

  // 10. model selection — lite model id is used when opts.model is 'lite'
  it('uses lite model id when opts.model is "lite"', async () => {
    mockFetchOk('lite response');

    await makeClient().ask('quick task', { model: 'lite' });

    const body = JSON.parse((vi.mocked(fetch).mock.calls[0]![1] as RequestInit).body as string);
    expect(body.model).toBe('ep-lite-xxx');
  });

  // 11. timeout — AbortError after timeoutMs returns LLM_TIMEOUT
  it('returns LLM_TIMEOUT when all attempts exceed timeoutMs', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            // Abort signal fires when client aborts; we listen and reject
            init.signal?.addEventListener('abort', () => {
              const e = new Error('The operation was aborted');
              e.name = 'AbortError';
              reject(e);
            });
            // Never resolves on its own — client must abort via signal
          }),
      ),
    );

    const promise = makeClient().ask('slow task', { timeoutMs: 100 });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(ErrorCode.LLM_TIMEOUT);
    }
    expect(fetch).toHaveBeenCalledTimes(3);
  }, 15_000);

  // 12. askStructured — strips markdown code fences before parsing
  it('askStructured parses JSON wrapped in markdown code fences', async () => {
    const jsonInFence = '```json\n{"name":"Antares","score":99}\n```';
    mockFetchOk(jsonInFence);

    const schema = {
      parse: (v: unknown) => v as { name: string; score: number },
    };

    const result = await makeClient().askStructured('extract', schema);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ name: 'Antares', score: 99 });
    }
    // Should succeed on first attempt, no retry needed
    expect(fetch).toHaveBeenCalledOnce();
  });
});

// ---------- chatWithTools ----------

import type { LLMTool, ToolCall, ToolResult } from '@seedhac/contracts';

const TOOLS: LLMTool[] = [
  {
    name: 'get_weather',
    description: 'Get current weather for a city',
    parameters: {
      type: 'object',
      properties: { city: { type: 'string' } },
      required: ['city'],
    },
  },
];

/** 构造一个 Ark 风格的 tool_calls 响应 */
function arkToolCallResponse(name: string, args: object, id = 'call_1'): object {
  return {
    choices: [
      {
        message: {
          content: '',
          tool_calls: [
            { id, type: 'function', function: { name, arguments: JSON.stringify(args) } },
          ],
        },
        finish_reason: 'tool_calls',
      },
    ],
    usage: { prompt_tokens: 20, completion_tokens: 5 },
  };
}

function arkTextResponse(content: string): object {
  return {
    choices: [{ message: { content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 10, completion_tokens: 5 },
  };
}

/** 让 fetch 按调用顺序依次返回不同 JSON */
function mockFetchSequence(...responses: object[]): void {
  const fn = vi.fn();
  for (const r of responses) {
    fn.mockResolvedValueOnce({
      ok: true,
      json: async () => r,
      text: async () => JSON.stringify(r),
    });
  }
  vi.stubGlobal('fetch', fn);
}

describe('VolcanoLLMClient.chatWithTools', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('rejects when tools is empty', async () => {
    const result = await makeClient().chatWithTools([{ role: 'user', content: 'hi' }], {
      tools: [],
      executor: async () => ({ toolCallId: 'x', name: 'x', content: '{}' }),
    });
    expect(result.ok).toBe(false);
  });

  it('runs single tool round and returns final content', async () => {
    mockFetchSequence(
      arkToolCallResponse('get_weather', { city: 'Beijing' }, 'c1'),
      arkTextResponse('Beijing is 22°C, sunny.'),
    );

    const executor = vi.fn(
      async (call: ToolCall): Promise<ToolResult> => ({
        toolCallId: call.id,
        name: call.name,
        content: JSON.stringify({ temp: 22, sky: 'sunny' }),
      }),
    );

    const result = await makeClient().chatWithTools(
      [{ role: 'user', content: 'weather in Beijing?' }],
      { tools: TOOLS, executor },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.content).toBe('Beijing is 22°C, sunny.');
      expect(result.value.toolCalls).toHaveLength(1);
      expect(result.value.toolCalls[0]!.name).toBe('get_weather');
      expect(result.value.rounds).toBe(2);
    }
    expect(executor).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('passes tools and tool_choice in API request', async () => {
    mockFetchOk('done');
    await makeClient().chatWithTools([{ role: 'user', content: 'hi' }], {
      tools: TOOLS,
      toolChoice: 'auto',
      executor: async () => ({ toolCallId: 'x', name: 'x', content: '{}' }),
    });
    const body = JSON.parse((vi.mocked(fetch).mock.calls[0]![1] as RequestInit).body as string);
    expect(body.tools).toHaveLength(1);
    expect(body.tools[0]).toEqual({
      type: 'function',
      function: {
        name: 'get_weather',
        description: 'Get current weather for a city',
        parameters: TOOLS[0]!.parameters,
      },
    });
    expect(body.tool_choice).toBe('auto');
  });

  it('converts a concrete toolChoice name to OpenAI-compatible function choice', async () => {
    mockFetchOk('done');
    await makeClient().chatWithTools([{ role: 'user', content: 'hi' }], {
      tools: TOOLS,
      toolChoice: 'get_weather',
      executor: async () => ({ toolCallId: 'x', name: 'x', content: '{}' }),
    });

    const body = JSON.parse((vi.mocked(fetch).mock.calls[0]![1] as RequestInit).body as string);
    expect(body.tool_choice).toEqual({
      type: 'function',
      function: { name: 'get_weather' },
    });
  });

  it('stops at maxToolCallRounds and returns last content', async () => {
    // 模型一直要求调工具，永远不收敛
    mockFetchSequence(
      arkToolCallResponse('get_weather', { city: 'A' }, 'c1'),
      arkToolCallResponse('get_weather', { city: 'B' }, 'c2'),
      arkToolCallResponse('get_weather', { city: 'C' }, 'c3'),
    );

    const result = await makeClient().chatWithTools([{ role: 'user', content: 'go' }], {
      tools: TOOLS,
      maxToolCallRounds: 3,
      executor: async (call) => ({
        toolCallId: call.id,
        name: call.name,
        content: '{}',
      }),
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.rounds).toBe(3);
      expect(result.value.toolCalls).toHaveLength(3);
    }
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('isolates executor errors and feeds them back to model', async () => {
    mockFetchSequence(
      arkToolCallResponse('get_weather', { city: 'X' }, 'c1'),
      arkTextResponse('Sorry, weather lookup failed.'),
    );

    const executor = vi.fn(async (): Promise<ToolResult> => {
      throw new Error('upstream down');
    });

    const result = await makeClient().chatWithTools([{ role: 'user', content: 'weather?' }], {
      tools: TOOLS,
      executor,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.content).toBe('Sorry, weather lookup failed.');
    }
    // 第二次调用时 conversation 里应包含一条 role=tool 的错误结果
    const secondBody = JSON.parse(
      (vi.mocked(fetch).mock.calls[1]![1] as RequestInit).body as string,
    );
    const toolMsg = secondBody.messages.find((m: { role: string }) => m.role === 'tool');
    expect(toolMsg).toBeDefined();
    expect(toolMsg.content).toContain('upstream down');
  });

  it('handles multiple parallel tool_calls in one round', async () => {
    mockFetchSequence(
      {
        choices: [
          {
            message: {
              content: '',
              tool_calls: [
                {
                  id: 'a',
                  type: 'function',
                  function: { name: 'get_weather', arguments: '{"city":"A"}' },
                },
                {
                  id: 'b',
                  type: 'function',
                  function: { name: 'get_weather', arguments: '{"city":"B"}' },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
        usage: { prompt_tokens: 20, completion_tokens: 5 },
      },
      arkTextResponse('Both done.'),
    );

    const executor = vi.fn(
      async (call: ToolCall): Promise<ToolResult> => ({
        toolCallId: call.id,
        name: call.name,
        content: JSON.stringify({ city: JSON.parse(call.argumentsRaw).city }),
      }),
    );

    const result = await makeClient().chatWithTools([{ role: 'user', content: 'A and B?' }], {
      tools: TOOLS,
      executor,
    });

    expect(result.ok).toBe(true);
    expect(executor).toHaveBeenCalledTimes(2);
    if (result.ok) {
      expect(result.value.toolCalls).toHaveLength(2);
    }
  });

  // H1: assistant 同时返回 content + tool_calls 时，content 必须保留进对话历史
  it('preserves non-empty assistant content alongside tool_calls (H1)', async () => {
    mockFetchSequence(
      {
        choices: [
          {
            message: {
              content: '我先查一下天气',
              tool_calls: [
                {
                  id: 'c1',
                  type: 'function',
                  function: { name: 'get_weather', arguments: '{"city":"X"}' },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
        usage: { prompt_tokens: 20, completion_tokens: 5 },
      },
      arkTextResponse('天气晴朗'),
    );

    await makeClient().chatWithTools([{ role: 'user', content: 'weather?' }], {
      tools: TOOLS,
      executor: async (call) => ({
        toolCallId: call.id,
        name: call.name,
        content: '{}',
      }),
    });

    // 第二次请求里应保留第一轮的 assistant.content（不是空字符串被吞掉）
    const secondBody = JSON.parse(
      (vi.mocked(fetch).mock.calls[1]![1] as RequestInit).body as string,
    );
    const assistantMsg = secondBody.messages.find(
      (m: { role: string; tool_calls?: unknown }) => m.role === 'assistant' && m.tool_calls,
    );
    expect(assistantMsg).toBeDefined();
    expect(assistantMsg.content).toBe('我先查一下天气');
  });

  // H1 反向：assistant 只调工具不说话时 content 字段应被省略而非空串
  it('omits content field when assistant only calls tools (H1)', async () => {
    mockFetchSequence(
      arkToolCallResponse('get_weather', { city: 'Y' }, 'c1'),
      arkTextResponse('done'),
    );

    await makeClient().chatWithTools([{ role: 'user', content: 'go' }], {
      tools: TOOLS,
      executor: async (call) => ({
        toolCallId: call.id,
        name: call.name,
        content: '{}',
      }),
    });

    const secondBody = JSON.parse(
      (vi.mocked(fetch).mock.calls[1]![1] as RequestInit).body as string,
    );
    const assistantMsg = secondBody.messages.find(
      (m: { role: string; tool_calls?: unknown }) => m.role === 'assistant' && m.tool_calls,
    );
    expect(assistantMsg).toBeDefined();
    expect('content' in assistantMsg).toBe(false);
  });

  // L1: 模型返回的 arguments 是非法 JSON 时，executor 抛错应被隔离
  it('isolates executor errors caused by malformed arguments JSON (L1)', async () => {
    mockFetchSequence(
      {
        choices: [
          {
            message: {
              content: '',
              tool_calls: [
                {
                  id: 'c1',
                  type: 'function',
                  function: { name: 'get_weather', arguments: '{not valid json' },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
        usage: { prompt_tokens: 20, completion_tokens: 5 },
      },
      arkTextResponse('参数无效，已重试'),
    );

    const executor = vi.fn(async (call: ToolCall): Promise<ToolResult> => {
      // 调用方按合约自行 parse — 故意暴露错误
      JSON.parse(call.argumentsRaw);
      return { toolCallId: call.id, name: call.name, content: '{}' };
    });

    const result = await makeClient().chatWithTools([{ role: 'user', content: 'go' }], {
      tools: TOOLS,
      executor,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.content).toBe('参数无效，已重试');
    }
    // executor 抛错被包成 ToolResult，第二次请求里能看到 role=tool 的错误结果
    const secondBody = JSON.parse(
      (vi.mocked(fetch).mock.calls[1]![1] as RequestInit).body as string,
    );
    const toolMsg = secondBody.messages.find((m: { role: string }) => m.role === 'tool');
    expect(toolMsg.content).toMatch(/error|Unexpected/i);
  });
});

// ---------- M4: retry path × tool round 串联 ----------

describe('VolcanoLLMClient retry × tool round interaction', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  // 第 1 轮 fetch 失败一次后重试成功 → 第 2 轮（tool 回灌后）正常完成
  it('chatWithTools recovers when callApi retries inside a tool round (M4)', async () => {
    let callCount = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => {
        callCount++;
        // 第 1 次：transient 失败；第 2 次：tool_call 响应；第 3 次：最终文本
        if (callCount === 1) throw new Error('transient network');
        if (callCount === 2) {
          return {
            ok: true,
            json: async () => arkToolCallResponse('get_weather', { city: 'Z' }, 'c1'),
            text: async () => '',
          };
        }
        return {
          ok: true,
          json: async () => arkTextResponse('recovered + answered'),
          text: async () => '',
        };
      }),
    );

    const promise = makeClient().chatWithTools([{ role: 'user', content: 'weather?' }], {
      tools: TOOLS,
      executor: async (call) => ({
        toolCallId: call.id,
        name: call.name,
        content: '{"ok":true}',
      }),
    });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.content).toBe('recovered + answered');
      expect(result.value.rounds).toBe(2);
    }
    expect(callCount).toBe(3); // 1 retry + 1 tool round + 1 final
  }, 10_000);

  // H2: 跨 attempt 出现过 timeout 但最后一次是 HTTP 500 → 应返回 LLM_TIMEOUT 而非掩盖
  it('returns LLM_TIMEOUT when AbortError occurred at any attempt (H2)', async () => {
    let callCount = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
        callCount++;
        if (callCount <= 2) {
          // 模拟 timeout：listen abort signal 抛 AbortError
          await new Promise<void>((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => {
              const e = new Error('aborted');
              e.name = 'AbortError';
              reject(e);
            });
            // 永远不 resolve，让 timeout 触发 abort
          });
          return undefined;
        }
        // 第 3 次返 HTTP 500
        return { ok: false, status: 500, text: async () => 'oops' };
      }),
    );

    const promise = makeClient().ask('hi', { timeoutMs: 50 });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(ErrorCode.LLM_TIMEOUT);
    }
  }, 10_000);
});

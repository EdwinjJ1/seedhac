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

  it('chatWithTools converts a concrete toolChoice name to OpenAI-compatible function choice', async () => {
    mockFetchOk('done');

    const result = await makeClient().chatWithTools([{ role: 'user', content: 'weather?' }], {
      tools: [
        {
          name: 'get_weather',
          description: 'Get weather',
          parameters: { type: 'object', properties: {} },
        },
      ],
      toolChoice: 'get_weather',
      executor: vi.fn(),
    });

    expect(result.ok).toBe(true);
    const body = JSON.parse((vi.mocked(fetch).mock.calls[0]![1] as RequestInit).body as string);
    expect(body.tool_choice).toEqual({
      type: 'function',
      function: { name: 'get_weather' },
    });
  });
});

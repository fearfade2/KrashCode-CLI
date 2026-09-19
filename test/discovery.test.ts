import { describe, it, expect, vi, afterEach } from 'vitest';
import { discoverModels } from '../src/core/discovery.js';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('discoverModels', () => {
  it('parses an OpenAI-compatible data[] list and filters non-chat models', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        data: [
          { id: 'gpt-4o-mini' },
          { id: 'gpt-4o' },
          { id: 'text-embedding-3-small' },
          { id: 'whisper-1' },
          { id: 'dall-e-3' },
        ],
      }),
    );
    const { models, error } = await discoverModels('openai', undefined, 'sk-test-key');
    expect(error).toBeUndefined();
    expect(models.map((m) => m.id)).toEqual(['gpt-4o', 'gpt-4o-mini']);
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.openai.com/v1/models',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('sends the bearer token and reads context length for custom endpoints', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ data: [{ id: 'qwen2.5-coder', max_model_len: 32768 }] }),
    );
    const { models } = await discoverModels('custom', 'http://localhost:1234/v1', 'local-key');
    expect(models).toEqual([{ id: 'qwen2.5-coder', contextWindow: 32768 }]);
    const [, init] = fetchSpy.mock.calls[0]!;
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer local-key' });
  });

  it('normalises Google models[] name prefixes', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        models: [
          { name: 'models/gemini-2.5-pro', inputTokenLimit: 1048576 },
          { name: 'models/gemini-2.5-flash' },
        ],
      }),
    );
    const { models } = await discoverModels('google', undefined, 'g-key');
    expect(models.map((m) => m.id)).toEqual(['gemini-2.5-flash', 'gemini-2.5-pro']);
    expect(models.find((m) => m.id === 'gemini-2.5-pro')?.contextWindow).toBe(1048576);
  });

  it('falls back to /v1/models when a bare custom root has no models path', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('not found', { status: 404 }))
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: 'llama3' }] }));
    const { models } = await discoverModels('custom', 'http://localhost:11434', '');
    expect(models.map((m) => m.id)).toEqual(['llama3']);
    expect(fetchSpy).toHaveBeenNthCalledWith(1, 'http://localhost:11434/models', expect.anything());
    expect(fetchSpy).toHaveBeenNthCalledWith(2, 'http://localhost:11434/v1/models', expect.anything());
  });

  it('detects the Anthropic protocol for a custom gateway that advertises it', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        data: [{ id: 'claude-opus-4-8', owned_by: 'claude', supported_endpoint_types: ['anthropic', 'openai'] }],
        object: 'list',
      }),
    );
    const outcome = await discoverModels('custom', 'https://api.example.icu/v1', 'k-123456');
    expect(outcome.models.map((m) => m.id)).toEqual(['claude-opus-4-8']);
    expect(outcome.protocol).toBe('anthropic');
    expect(outcome.baseUrl).toBe('https://api.example.icu/v1');
  });

  it('detects the OpenAI protocol for a plain local model list', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ data: [{ id: 'llama3' }] }));
    const outcome = await discoverModels('custom', 'http://localhost:11434/v1', '');
    expect(outcome.protocol).toBe('openai');
  });

  it('never throws: returns a redacted error string on network failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('connect ECONNREFUSED with sk-secret-key'));
    const { models, error } = await discoverModels('custom', 'http://localhost:9/v1', 'sk-secret-key');
    expect(models).toEqual([]);
    expect(error).toBeTruthy();
    expect(error).not.toContain('sk-secret-key');
    expect(error).toContain('[ключ]');
  });
});

import { describe, it, expect } from 'vitest';
import { planReasoning } from '../src/core/agent.js';
import { defaultConfig, type Effort, type KrashConfig, type ProviderKind } from '../src/core/types.js';

function cfg(over: Partial<KrashConfig>): KrashConfig {
  return { ...defaultConfig(), ...over };
}

describe('planReasoning', () => {
  it('auto leaves the request untouched', () => {
    const plan = planReasoning(cfg({ provider: 'openai', effort: 'auto' }), 'gpt-5', 8192);
    expect(plan.providerOptions).toBeUndefined();
    expect(plan.maxOutputTokens).toBe(8192);
  });

  it('sends reasoning_effort for OpenAI reasoning models', () => {
    const plan = planReasoning(cfg({ provider: 'openai', effort: 'high' }), 'gpt-5', 8192);
    expect(plan.providerOptions).toEqual({ openai: { reasoningEffort: 'high' } });
    expect(plan.maxOutputTokens).toBe(8192);
  });

  it('omits reasoning_effort for non-reasoning OpenAI models (gpt-4o)', () => {
    const plan = planReasoning(cfg({ provider: 'openai', effort: 'high' }), 'gpt-4o', 8192);
    expect(plan.providerOptions).toBeUndefined();
  });

  it('passes higher effort tiers through to the SDK enum', () => {
    const plan = planReasoning(cfg({ provider: 'openai', effort: 'max' }), 'o4-mini', 8192);
    expect(plan.providerOptions).toEqual({ openai: { reasoningEffort: 'max' } });
  });

  it('enables Anthropic extended thinking with a token budget', () => {
    const plan = planReasoning(cfg({ provider: 'anthropic', effort: 'high' }), 'claude-sonnet-4', 8192);
    expect(plan.providerOptions).toEqual({ anthropic: { thinking: { type: 'enabled', budgetTokens: 8192 } } });
    // max_tokens должен превышать бюджет — поднимаем под бюджет + ответ.
    expect(plan.maxOutputTokens).toBe(8192 + 4096);
  });

  it('does not shrink an already-large maxOutputTokens', () => {
    const plan = planReasoning(cfg({ provider: 'anthropic', effort: 'low' }), 'claude-opus-4', 40000);
    expect(plan.maxOutputTokens).toBe(40000);
    expect(plan.providerOptions).toEqual({ anthropic: { thinking: { type: 'enabled', budgetTokens: 2048 } } });
  });

  it('routes a custom Anthropic-protocol gateway to thinking', () => {
    const plan = planReasoning(
      cfg({ provider: 'custom', protocol: 'anthropic', effort: 'medium' }),
      'claude-opus-4-8',
      8192,
    );
    expect(plan.providerOptions).toEqual({ anthropic: { thinking: { type: 'enabled', budgetTokens: 4096 } } });
  });

  it('routes a custom OpenAI-protocol reasoning model to reasoning_effort', () => {
    const plan = planReasoning(
      cfg({ provider: 'custom', protocol: 'openai', effort: 'low' }),
      'gpt-5-mini',
      8192,
    );
    expect(plan.providerOptions).toEqual({ openai: { reasoningEffort: 'low' } });
  });

  it('strips the vendor prefix before matching openrouter reasoning models', () => {
    const plan = planReasoning(cfg({ provider: 'openrouter', effort: 'high' }), 'openai/gpt-5', 8192);
    expect(plan.providerOptions).toEqual({ openai: { reasoningEffort: 'high' } });
  });

  it('leaves non-reasoning openrouter models (claude via openai protocol) untouched', () => {
    const plan = planReasoning(cfg({ provider: 'openrouter', effort: 'high' }), 'anthropic/claude-3.7-sonnet', 8192);
    expect(plan.providerOptions).toBeUndefined();
  });

  it('does not send reasoning params for Google', () => {
    const plan = planReasoning(cfg({ provider: 'google', effort: 'high' }), 'gemini-2.5-pro', 8192);
    expect(plan.providerOptions).toBeUndefined();
  });
});

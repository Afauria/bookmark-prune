import type { AIProvider } from './provider.js';
import type { AIProviderConfig } from '../types.js';

export function createAnthropicProvider(config: AIProviderConfig): AIProvider {
  const baseUrl = config.base_url?.replace(/\/$/, '') ?? 'https://api.anthropic.com';

  return {
    name: 'anthropic',

    async call(prompt: string, maxTokens?: number): Promise<string> {
      const response = await fetch(`${baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': config.api_key!,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: config.model,
          max_tokens: maxTokens ?? config.max_tokens ?? 4096,
          messages: [{ role: 'user', content: prompt }],
        }),
      });

      if (response.status === 429) {
        const retryAfter = response.headers.get('retry-after');
        const delay = retryAfter ? parseInt(retryAfter, 10) * 1000 : 5000;
        throw new RetryableError(`Rate limited, retry after ${delay}ms`, delay);
      }

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Anthropic API error ${response.status}: ${body}`);
      }

      const data = (await response.json()) as {
        content: { type: string; text: string }[];
      };
      return data.content[0]?.text ?? '';
    },
  };
}

export class RetryableError extends Error {
  retryAfterMs: number;

  constructor(message: string, retryAfterMs: number) {
    super(message);
    this.name = 'RetryableError';
    this.retryAfterMs = retryAfterMs;
  }
}

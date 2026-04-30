import type { AIProvider } from './provider.js';
import type { AIProviderConfig } from '../types.js';
import { RetryableError } from './anthropic.js';

export function createOpenAIProvider(config: AIProviderConfig): AIProvider {
  const baseUrl = config.base_url?.replace(/\/$/, '') ?? 'https://api.openai.com/v1';

  return {
    name: 'openai',

    async call(prompt: string, maxTokens?: number): Promise<string> {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'authorization': `Bearer ${config.api_key}`,
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
        throw new Error(`OpenAI API error ${response.status}: ${body}`);
      }

      const data = (await response.json()) as {
        choices: { message: { content: string } }[];
      };
      return data.choices[0]?.message?.content ?? '';
    },
  };
}

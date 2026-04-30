import type { AIProvider } from './provider.js';
import type { AIProviderConfig } from '../types.js';
import { RetryableError } from './anthropic.js';

export function createOllamaProvider(config: AIProviderConfig): AIProvider {
  const baseUrl = config.base_url?.replace(/\/$/, '') ?? 'http://localhost:11434';

  return {
    name: 'ollama',

    async call(prompt: string, _maxTokens?: number): Promise<string> {
      const response = await fetch(`${baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: config.model,
          prompt,
          stream: false,
        }),
      });

      if (response.status === 429) {
        throw new RetryableError('Rate limited', 5000);
      }

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Ollama API error ${response.status}: ${body}`);
      }

      const data = (await response.json()) as { response: string };
      return data.response ?? '';
    },
  };
}

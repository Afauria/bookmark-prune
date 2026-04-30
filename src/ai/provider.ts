import type { Settings } from '../types.js';

export interface AIProvider {
  name: string;
  call(prompt: string, maxTokens?: number): Promise<string>;
}

export async function createProvider(settings: Settings): Promise<AIProvider> {
  const provider = settings.ai.provider;

  switch (provider) {
    case 'anthropic': {
      const { createAnthropicProvider } = await import('./anthropic.js');
      return createAnthropicProvider(settings.ai.anthropic!);
    }
    case 'openai': {
      const { createOpenAIProvider } = await import('./openai.js');
      return createOpenAIProvider(settings.ai.openai!);
    }
    case 'ollama': {
      const { createOllamaProvider } = await import('./ollama.js');
      return createOllamaProvider(settings.ai.ollama!);
    }
    default:
      throw new Error(`Unknown AI provider: ${provider}`);
  }
}

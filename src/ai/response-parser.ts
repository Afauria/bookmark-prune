import type { AIOutput } from '../types.js';

export function parseAIResponse(
  rawOutput: string,
  allowedTags: string[],
): AIOutput[] | null {
  const jsonStr = extractJSON(rawOutput);
  if (!jsonStr) return null;

  try {
    const parsed = JSON.parse(jsonStr);
    const items = Array.isArray(parsed) ? parsed : [parsed];
    return items.map((item) => validateAIOutput(item, allowedTags)).filter(Boolean) as AIOutput[];
  } catch {
    return null;
  }
}

function extractJSON(text: string): string | null {
  const trimmed = text.trim();

  // Try direct parse first
  try {
    JSON.parse(trimmed);
    return trimmed;
  } catch {
    // continue
  }

  // Try extracting from markdown code block (case-insensitive language tag)
  const codeBlockMatch = trimmed.match(/```[a-zA-Z]*\s*\n?([\s\S]*?)\n?```/);
  if (codeBlockMatch) {
    const content = codeBlockMatch[1].trim();
    try {
      JSON.parse(content);
      return content;
    } catch {
      // continue
    }
  }

  // Try finding JSON array or object
  const arrayMatch = trimmed.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    try {
      JSON.parse(arrayMatch[0]);
      return arrayMatch[0];
    } catch {
      // continue
    }
  }

  const objectMatch = trimmed.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    try {
      JSON.parse(objectMatch[0]);
      return objectMatch[0];
    } catch {
      // continue
    }
  }

  return null;
}

function validateAIOutput(
  raw: unknown,
  allowedTags: string[],
): AIOutput | null {
  if (!raw || typeof raw !== 'object') return null;

  const obj = raw as Record<string, unknown>;

  const tags = Array.isArray(obj.tags)
    ? (obj.tags as string[]).filter((t: string) => allowedTags.includes(t))
    : [];

  const confidence = typeof obj.confidence === 'number'
    ? Math.max(0, Math.min(1, obj.confidence))
    : 0.5;

  const valueScore = typeof obj.value_score === 'number'
    ? Math.max(1, Math.min(10, Math.round(obj.value_score)))
    : 5;

  return {
    url: typeof obj.url === 'string' ? obj.url : undefined,
    tags,
    confidence,
    summary: typeof obj.summary === 'string' ? obj.summary : undefined,
    value_score: valueScore,
  };
}

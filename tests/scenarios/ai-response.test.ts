import { describe, it, expect } from 'vitest';
import { parseAIResponse } from '../../src/ai/response-parser.js';

const tags = ['TypeScript', 'React', 'Python', 'Docker'];

// scan.md AI 输出格式验证
describe('AI 响应解析流程', () => {
  it('标准批量 JSON → 正确解析多条结果', () => {
    const raw = JSON.stringify([
      { url: 'https://a.com', tags: ['TypeScript', 'React'], confidence: 0.9, description: 'desc', value_score: 8 },
      { url: 'https://b.com', tags: ['Python'], confidence: 0.7, value_score: 6 },
    ]);
    const result = parseAIResponse(raw, tags)!;
    expect(result).toHaveLength(2);
    expect(result[0].tags).toEqual(['TypeScript', 'React']);
    expect(result[0].description).toBe('desc');
    expect(result[1].tags).toEqual(['Python']);
  });

  it('markdown 代码块包裹 → 提取并解析', () => {
    const raw = '```json\n[{"url":"https://a.com","tags":["Docker"],"confidence":0.8,"value_score":7}]\n```';
    const result = parseAIResponse(raw, tags)!;
    expect(result).toHaveLength(1);
    expect(result[0].tags).toEqual(['Docker']);
  });

  it('非法标签被过滤，合法标签保留', () => {
    const raw = JSON.stringify([
      { url: 'https://a.com', tags: ['TypeScript', 'FakeTag', 'React'], confidence: 0.9, value_score: 7 },
    ]);
    const result = parseAIResponse(raw, tags)!;
    expect(result[0].tags).toEqual(['TypeScript', 'React']);
  });

  it('数据校验: confidence 截断 [0,1], value_score 截断 [1,10] 并取整, 缺失字段有默认值', () => {
    const raw = JSON.stringify([
      { url: 'https://a.com', tags: [], confidence: 1.5, value_score: 15 },
      { url: 'https://b.com', tags: [], confidence: -0.5, value_score: 0 },
      { url: 'https://c.com', tags: [] }, // 缺失 confidence 和 value_score
    ]);
    const result = parseAIResponse(raw, tags)!;
    expect(result[0]).toMatchObject({ confidence: 1, value_score: 10 });
    expect(result[1]).toMatchObject({ confidence: 0, value_score: 1 });
    expect(result[2]).toMatchObject({ confidence: 0.5, value_score: 5 }); // 默认值
  });

  it('异常输入: 空字符串/非JSON/null项 → 返回 null 或过滤', () => {
    expect(parseAIResponse('', tags)).toBeNull();
    expect(parseAIResponse('not json', tags)).toBeNull();
    // null 项被过滤
    const raw = JSON.stringify([null, { url: 'https://a.com', tags: ['React'], confidence: 0.8, value_score: 7 }]);
    expect(parseAIResponse(raw, tags)).toHaveLength(1);
  });
});

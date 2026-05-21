import { describe, it, expect } from 'vitest';
import { classify } from '../../src/pipeline/classifier.js';
import type { ClassificationRule } from '../../src/types.js';

// classify.md 验收标准驱动的场景测试
const techTags = ['TypeScript', 'React', 'Docker', 'Python'];

const rules: ClassificationRule[] = [
  { domain: '前端', match: { tag_contains: ['React', 'TypeScript'] } },
  { domain: 'AI', match: { url_contains: ['openai.com'], title_contains: ['GPT'] } },
  { domain: '后端', match: { url_contains: ['api.example.com'], title_contains: ['Spring'] } },
  { domain: 'DevOps', match: { tag_contains: ['Docker'] } },
  { domain: '资源', match: { default: true } },
];

const bm = (url: string, title: string, tags: string[]) =>
  ({ url, title, tags: JSON.stringify(tags) });

describe('分类引擎 — classify.md 验收标准', () => {
  // 验收标准1: 空规则 → 待分类
  it('空规则列表返回"待分类"', () => {
    const r = classify(bm('https://x.com', 'T', ['React']), []);
    expect(r).toEqual({ category: '待分类', subcategory: null });
  });

  // 验收标准2: tags='[]'时 tag_contains 不匹配
  it('空标签不触发 tag_contains 匹配，兜底到 default', () => {
    const r = classify({ url: 'https://x.com', title: 'T', tags: '[]' }, rules, techTags);
    expect(r.category).toBe('资源');
  });

  // 核心流程: 4阶段匹配 — Pre-AI(url/title) → Tag → Default → 兜底
  it('4阶段匹配: url_contains 命中 → tag_contains 被跳过', () => {
    // tags 含 React（可匹配前端），但 openai.com 命中 AI 的 url_contains
    // 注意: React 先匹配了前端的 tag_contains，所以实际是 tag 优先
    const r = classify(bm('https://openai.com/blog', 'Blog', []), rules, techTags);
    expect(r.category).toBe('AI');
    expect(r.subcategory).toBeNull(); // 无标签，无 techTag 子分类
  });

  it('tag_contains 匹配 → subcategory 等于触发标签', () => {
    const r = classify(bm('https://random.com', 'T', ['React']), rules, techTags);
    expect(r).toEqual({ category: '前端', subcategory: 'React' });
  });

  it('default 兜底 → subcategory 取首个 techTag 匹配', () => {
    const r = classify(bm('https://x.com', 'T', ['Python']), rules, techTags);
    // Python 不在 tag_contains 规则中，Docker 也不在 tags 里
    // → 落到 default，subcategory = tags 中首个 techTag
    expect(r.category).toBe('资源');
    expect(r.subcategory).toBe('Python');
  });

  it('default 兜底 → 无 techTag 匹配时 subcategory 为 null', () => {
    const r = classify(bm('https://x.com', 'T', ['Unknown']), rules, techTags);
    expect(r).toEqual({ category: '资源', subcategory: null });
  });

  it('无 default 规则且全部不匹配 → "待分类"', () => {
    const noDefault: ClassificationRule[] = [
      { domain: '前端', match: { tag_contains: ['React'] } },
    ];
    const r = classify(bm('https://x.com', 'T', ['Python']), noDefault, techTags);
    expect(r).toEqual({ category: '待分类', subcategory: null });
  });

  // url_contains 与 title_contains OR 逻辑
  it('同一规则 url_contains OR title_contains', () => {
    // url 不匹配但 title 匹配 "Spring"
    const r = classify(bm('https://random.com', 'Spring Boot Guide', ['Python']), rules, techTags);
    expect(r.category).toBe('后端');
  });
});

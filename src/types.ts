export type BookmarkStatus = 'pending' | 'scan_done' | 'deep_done' | 'error' | 'dead' | 'empty';

export interface Bookmark {
  id: string;
  url: string;
  original_url: string | null;
  title: string;
  original_folder: string;
  add_date: number | null;
  status: BookmarkStatus;
  confidence: number | null;
  is_duplicate: boolean;
  content: string | null;
  description: string | null;
  summary: string | null;
  tags: string; // JSON string of string[]
  category: string | null;
  subcategory: string | null;
  notes: string | null;
  value_score: number | null;
  ai_model: string | null;
  processed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AIOutput {
  url?: string; // for batch matching
  tags: string[];
  confidence: number;
  description?: string;
  summary?: string;
  value_score: number;
}

export interface ClassificationRule {
  domain: string;
  match: {
    url_contains?: string[];
    title_contains?: string[];
    tag_contains?: string[];
    default?: boolean;
  };
}

export interface TagDefinitions {
  domain: string[];
  tech: string[];
  type: string[];
  meta: string[];
  status: string[];
}

export interface AppConfig {
  profile: string;
  tags: TagDefinitions;
  classification_rules: ClassificationRule[];
}

export interface AIProviderConfig {
  api_key?: string;
  base_url?: string;
  model: string;
  max_tokens?: number;
}

export interface BatchConfig {
  size: number;
  concurrency: number;
  retry: number;
  delay_seconds?: number;
}

export interface Settings {
  ai: {
    provider: 'anthropic' | 'openai' | 'ollama' | 'gemini';
    anthropic?: AIProviderConfig;
    openai?: AIProviderConfig;
    ollama?: AIProviderConfig;
    gemini?: AIProviderConfig;
    batch: BatchConfig;
  };
  storage: {
    db: string;
    cache: string;
  };
  thresholds: {
    low_confidence: number;
    dead_link_timeout: number;
  };
}

export interface RawBookmark {
  url: string;
  title: string;
  original_folder: string;
  add_date: number | null;
}

export interface FetchedContent {
  url: string;
  content: string;
  title: string;
  success: boolean;
  error?: string;
}

export interface BatchResult {
  success: number;
  failed: number;
  skipped: number;
  dead?: number;
  empty?: number;
  failedIds?: string[];
}

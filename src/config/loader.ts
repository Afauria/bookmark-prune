import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { AppConfig, Settings } from '../types.js';

// Load .env file if it exists
function loadDotEnv(): void {
  const envPath = path.resolve('.env');
  if (!fs.existsSync(envPath)) return;

  const content = fs.readFileSync(envPath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

// Auto-load .env on module import
loadDotEnv();

function expandEnvVars(obj: unknown): unknown {
  if (typeof obj === 'string') {
    return obj.replace(/\$\{(\w+)\}/g, (_, varName) => {
      return process.env[varName] ?? '';
    });
  }
  if (Array.isArray(obj)) {
    return obj.map(expandEnvVars);
  }
  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = expandEnvVars(value);
    }
    return result;
  }
  return obj;
}

function resolvePath(filePath: string): string {
  if (path.isAbsolute(filePath)) return filePath;
  return path.resolve(process.cwd(), filePath);
}

export function loadConfig(configPath?: string): AppConfig {
  const resolvedPath = resolvePath(configPath ?? 'config/config.yaml');

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Config file not found: ${resolvedPath}`);
  }

  const content = fs.readFileSync(resolvedPath, 'utf-8');
  const raw = parseYaml(content);
  const config = expandEnvVars(raw) as AppConfig;

  if (!config.tags || !config.classification_rules) {
    throw new Error('Invalid config: missing tags or classification_rules');
  }

  return config;
}

export function loadSettings(settingsPath?: string): Settings {
  const resolvedPath = resolvePath(settingsPath ?? 'config/settings.yaml');

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Settings file not found: ${resolvedPath}`);
  }

  const content = fs.readFileSync(resolvedPath, 'utf-8');
  const raw = parseYaml(content);
  const settings = expandEnvVars(raw) as Settings;

  if (!settings.ai?.provider) {
    throw new Error('Invalid settings: missing ai.provider');
  }

  return settings;
}

export function getAllowedTags(config: AppConfig): string[] {
  const tags = config.tags;
  return [
    ...tags.domain,
    ...tags.tech,
    ...tags.type,
    ...tags.meta,
    ...tags.status,
  ];
}

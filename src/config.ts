import envPaths from 'env-paths';
import path from 'path';
import fs from 'fs';

const paths = envPaths('chatgpt-mcp', { suffix: '' });

// Ensure data directory exists
if (!fs.existsSync(paths.data)) {
  fs.mkdirSync(paths.data, { recursive: true });
}

export interface Config {
  // Server
  port: number;
  host: string;

  // Browser
  headless: boolean;
  browserTimeout: number;

  // Paths
  dataDir: string;
  userDataDir: string;
  storageStatePath: string;
  configPath: string;

  // ChatGPT
  chatgptUrl: string;
  imageGenerationTimeout: number;
}

function loadConfigFile(): Partial<Config> {
  const configPath = path.join(paths.data, 'config.json');
  if (fs.existsSync(configPath)) {
    try {
      return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    } catch {
      return {};
    }
  }
  return {};
}

const fileConfig = loadConfigFile();

export const CONFIG: Config = {
  // Server
  port: parseInt(process.env.PORT || '') || fileConfig.port || 3100,
  host: process.env.HOST || fileConfig.host || '0.0.0.0',

  // Browser
  headless: process.env.HEADLESS !== 'false' && (fileConfig.headless !== false),
  browserTimeout: 120000, // 2 minutes

  // Paths
  dataDir: paths.data,
  userDataDir: path.join(paths.data, 'chrome-profile'),
  storageStatePath: path.join(paths.data, 'storage-state.json'),
  configPath: path.join(paths.data, 'config.json'),

  // ChatGPT
  chatgptUrl: 'https://chatgpt.com',
  imageGenerationTimeout: 120000, // 2 minutes for DALL-E
};

export function saveConfig(updates: Partial<Config>): void {
  const configPath = path.join(paths.data, 'config.json');
  const current = loadConfigFile();
  const merged = { ...current, ...updates };
  fs.writeFileSync(configPath, JSON.stringify(merged, null, 2));
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function getLogLevel(): LogLevel {
  const level = process.env.LOG_LEVEL?.toLowerCase() as LogLevel;
  if (level && LOG_LEVELS[level] !== undefined) {
    return level;
  }
  return process.env.DEBUG ? 'debug' : 'info';
}

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[getLogLevel()];
}

function formatMessage(level: string, message: string): string {
  const timestamp = new Date().toISOString();
  return `[${timestamp}] [${level.toUpperCase()}] ${message}`;
}

export function logDebug(message: string, ...args: unknown[]): void {
  if (shouldLog('debug')) {
    console.log(formatMessage('debug', message), ...args);
  }
}

export function log(message: string, ...args: unknown[]): void {
  if (shouldLog('info')) {
    console.log(formatMessage('info', message), ...args);
  }
}

export function logWarn(message: string, ...args: unknown[]): void {
  if (shouldLog('warn')) {
    console.warn(formatMessage('warn', message), ...args);
  }
}

export function logError(message: string, ...args: unknown[]): void {
  if (shouldLog('error')) {
    console.error(formatMessage('error', message), ...args);
  }
}

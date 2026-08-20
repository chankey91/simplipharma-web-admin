/**
 * Runtime config: prefer process.env (from functions/.env.<projectId> or Secret Manager),
 * fall back to legacy functions.config() so behavior stays identical during migration.
 *
 * Populate env files with:
 *   npx firebase functions:config:export
 * or copy from functions/.env.example (no secrets in git).
 */
import * as functions from 'firebase-functions';

function fromEnv(key: string): string | undefined {
  const v = process.env[key];
  if (v == null) return undefined;
  const s = String(v).trim();
  return s === '' ? undefined : s;
}

function fromLegacy(section: string, key: string): string | undefined {
  try {
    const sectionCfg = (functions.config() as Record<string, Record<string, unknown> | undefined>)[
      section
    ];
    const v = sectionCfg?.[key];
    if (v == null) return undefined;
    const s = String(v).trim();
    return s === '' ? undefined : s;
  } catch {
    return undefined;
  }
}

/** Resolve a config value: env first, then functions.config()[section][key]. */
export function configValue(section: string, key: string, envKey: string): string | undefined {
  return fromEnv(envKey) ?? fromLegacy(section, key);
}

export type SmtpRuntimeConfig = {
  user: string;
  password: string;
  host: string;
  port: number;
  adminNotify?: string;
};

export function getSmtpConfig(): SmtpRuntimeConfig | null {
  const user = configValue('smtp', 'user', 'SMTP_USER');
  const password = configValue('smtp', 'password', 'SMTP_PASSWORD');
  if (!user || !password) return null;
  const host = configValue('smtp', 'host', 'SMTP_HOST') || 'smtp.zoho.in';
  const port = Number(configValue('smtp', 'port', 'SMTP_PORT') || 587) || 587;
  const adminNotify = configValue('smtp', 'admin_notify', 'SMTP_ADMIN_NOTIFY');
  return { user, password, host, port, ...(adminNotify ? { adminNotify } : {}) };
}

export type TypesenseRuntimeConfig = {
  host: string;
  apiKey: string;
  searchApiKey: string;
  protocol: string;
  port: number;
};

export function getTypesenseRuntimeConfig(): TypesenseRuntimeConfig | null {
  const host = configValue('typesense', 'host', 'TYPESENSE_HOST');
  const apiKey = configValue('typesense', 'api_key', 'TYPESENSE_API_KEY');
  if (!host || !apiKey) return null;
  const protocol = (configValue('typesense', 'protocol', 'TYPESENSE_PROTOCOL') || 'https').replace(
    /:$/,
    ''
  );
  const defaultPort = protocol === 'https' ? '443' : '8108';
  const port =
    parseInt(String(configValue('typesense', 'port', 'TYPESENSE_PORT') || defaultPort), 10) ||
    (protocol === 'https' ? 443 : 8108);
  const searchApiKey =
    configValue('typesense', 'search_api_key', 'TYPESENSE_SEARCH_API_KEY') || apiKey;
  return {
    host,
    apiKey,
    searchApiKey,
    protocol,
    port,
  };
}

export function getAppConfigValue(
  key:
    | 'panel_url'
    | 'so_password_reset_continue_url'
    | 'po_password_reset_continue_url'
    | 'retailer_password_reset_continue_url'
    | 'retailer_landing_url',
  envKey: string
): string | undefined {
  return configValue('app', key, envKey);
}

export function getSupportNotifyEmails(): string | undefined {
  return configValue('support', 'notify_emails', 'SUPPORT_NOTIFY_EMAILS');
}

export function getGeminiModel(): string {
  return (
    configValue('gemini', 'model', 'GOOGLE_GEMINI_MODEL') ||
    fromEnv('GOOGLE_GEMINI_MODEL') ||
    'gemini-2.5-flash'
  );
}

export function getGeminiApiKey(): string | undefined {
  return configValue('gemini', 'api_key', 'GOOGLE_GEMINI_API_KEY') || fromEnv('GOOGLE_GEMINI_API_KEY');
}

export function getGeminiProject(): string | undefined {
  return (
    fromEnv('GCLOUD_PROJECT') ||
    fromEnv('GCP_PROJECT') ||
    configValue('gemini', 'project', 'GOOGLE_GEMINI_PROJECT')
  );
}

export function getGeminiLocation(): string {
  return (
    configValue('gemini', 'location', 'GOOGLE_VERTEX_LOCATION') ||
    fromEnv('GOOGLE_VERTEX_LOCATION') ||
    'asia-south1'
  );
}

export function getVisionApiKey(): string | undefined {
  return configValue('ocr', 'api_key', 'GOOGLE_VISION_API_KEY') || fromEnv('GOOGLE_VISION_API_KEY');
}

/** Stable compare for Typesense docs (skip no-op upserts). */
export function typesenseDocsEqual(
  a: Record<string, unknown> | null,
  b: Record<string, unknown> | null
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

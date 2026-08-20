"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.configValue = configValue;
exports.getSmtpConfig = getSmtpConfig;
exports.getTypesenseRuntimeConfig = getTypesenseRuntimeConfig;
exports.getAppConfigValue = getAppConfigValue;
exports.getSupportNotifyEmails = getSupportNotifyEmails;
exports.getGeminiModel = getGeminiModel;
exports.getGeminiApiKey = getGeminiApiKey;
exports.getGeminiProject = getGeminiProject;
exports.getGeminiLocation = getGeminiLocation;
exports.getVisionApiKey = getVisionApiKey;
exports.typesenseDocsEqual = typesenseDocsEqual;
/**
 * Runtime config: prefer process.env (from functions/.env.<projectId> or Secret Manager),
 * fall back to legacy functions.config() so behavior stays identical during migration.
 *
 * Populate env files with:
 *   npx firebase functions:config:export
 * or copy from functions/.env.example (no secrets in git).
 */
const functions = require("firebase-functions");
function fromEnv(key) {
    const v = process.env[key];
    if (v == null)
        return undefined;
    const s = String(v).trim();
    return s === '' ? undefined : s;
}
function fromLegacy(section, key) {
    try {
        const sectionCfg = functions.config()[section];
        const v = sectionCfg === null || sectionCfg === void 0 ? void 0 : sectionCfg[key];
        if (v == null)
            return undefined;
        const s = String(v).trim();
        return s === '' ? undefined : s;
    }
    catch (_a) {
        return undefined;
    }
}
/** Resolve a config value: env first, then functions.config()[section][key]. */
function configValue(section, key, envKey) {
    var _a;
    return (_a = fromEnv(envKey)) !== null && _a !== void 0 ? _a : fromLegacy(section, key);
}
function getSmtpConfig() {
    const user = configValue('smtp', 'user', 'SMTP_USER');
    const password = configValue('smtp', 'password', 'SMTP_PASSWORD');
    if (!user || !password)
        return null;
    const host = configValue('smtp', 'host', 'SMTP_HOST') || 'smtp.zoho.in';
    const port = Number(configValue('smtp', 'port', 'SMTP_PORT') || 587) || 587;
    const adminNotify = configValue('smtp', 'admin_notify', 'SMTP_ADMIN_NOTIFY');
    return Object.assign({ user, password, host, port }, (adminNotify ? { adminNotify } : {}));
}
function getTypesenseRuntimeConfig() {
    const host = configValue('typesense', 'host', 'TYPESENSE_HOST');
    const apiKey = configValue('typesense', 'api_key', 'TYPESENSE_API_KEY');
    if (!host || !apiKey)
        return null;
    const protocol = (configValue('typesense', 'protocol', 'TYPESENSE_PROTOCOL') || 'https').replace(/:$/, '');
    const defaultPort = protocol === 'https' ? '443' : '8108';
    const port = parseInt(String(configValue('typesense', 'port', 'TYPESENSE_PORT') || defaultPort), 10) ||
        (protocol === 'https' ? 443 : 8108);
    const searchApiKey = configValue('typesense', 'search_api_key', 'TYPESENSE_SEARCH_API_KEY') || apiKey;
    return {
        host,
        apiKey,
        searchApiKey,
        protocol,
        port,
    };
}
function getAppConfigValue(key, envKey) {
    return configValue('app', key, envKey);
}
function getSupportNotifyEmails() {
    return configValue('support', 'notify_emails', 'SUPPORT_NOTIFY_EMAILS');
}
function getGeminiModel() {
    return (configValue('gemini', 'model', 'GOOGLE_GEMINI_MODEL') ||
        fromEnv('GOOGLE_GEMINI_MODEL') ||
        'gemini-2.5-flash');
}
function getGeminiApiKey() {
    return configValue('gemini', 'api_key', 'GOOGLE_GEMINI_API_KEY') || fromEnv('GOOGLE_GEMINI_API_KEY');
}
function getGeminiProject() {
    return (fromEnv('GCLOUD_PROJECT') ||
        fromEnv('GCP_PROJECT') ||
        configValue('gemini', 'project', 'GOOGLE_GEMINI_PROJECT'));
}
function getGeminiLocation() {
    return (configValue('gemini', 'location', 'GOOGLE_VERTEX_LOCATION') ||
        fromEnv('GOOGLE_VERTEX_LOCATION') ||
        'asia-south1');
}
function getVisionApiKey() {
    return configValue('ocr', 'api_key', 'GOOGLE_VISION_API_KEY') || fromEnv('GOOGLE_VISION_API_KEY');
}
/** Stable compare for Typesense docs (skip no-op upserts). */
function typesenseDocsEqual(a, b) {
    if (a === b)
        return true;
    if (!a || !b)
        return false;
    return JSON.stringify(a) === JSON.stringify(b);
}
//# sourceMappingURL=runtimeConfig.js.map
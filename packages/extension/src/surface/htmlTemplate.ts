import { randomBytes } from 'node:crypto';

/** Replaces `{{key}}` placeholders in the Webview HTML template. */
export function renderWebviewHtml(template: string, substitutions: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => substitutions[key] ?? '');
}

/**
 * Serializes initial data for embedding in an inline `<script>`. `<` is escaped
 * to `\u003c` so the JSON can never terminate the script block early.
 */
export function escapeInitialData(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

/** A fresh base64 nonce for the Webview's Content-Security-Policy. */
export function newNonce(): string {
  return randomBytes(16).toString('base64');
}

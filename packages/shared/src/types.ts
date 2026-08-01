export type Role = 'Reason' | 'Build' | 'Review' | 'Write' | 'Repair';

export const ROLES: readonly Role[] = ['Reason', 'Build', 'Review', 'Write', 'Repair'];

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

export type CallbackStatus = 'done' | 'error' | 'needs-input';

export const CALLBACK_STATUSES: readonly CallbackStatus[] = ['done', 'error', 'needs-input'];

export function isCallbackStatus(value: unknown): value is CallbackStatus {
  return typeof value === 'string' && (CALLBACK_STATUSES as readonly string[]).includes(value);
}

export interface CompletionSummary {
  confidence: number;
  actions: string[];
  notes?: string;
}

export interface CompletionFrame {
  status: CallbackStatus;
  correlationId: string;
  summary: CompletionSummary;
}

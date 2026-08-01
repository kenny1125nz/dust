import { CompletionFrame, CompletionSummary, isCallbackStatus } from '@dust/shared';

/** Validates a parsed JSON frame against the CompletionFrame shape. */
export function validateFrame(raw: unknown): CompletionFrame {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('completion frame must be a JSON object');
  }
  const frame = raw as Partial<CompletionFrame>;

  const status = frame.status;
  if (!isCallbackStatus(status)) {
    throw new Error('completion frame status must be one of: done, error, needs-input');
  }

  const correlationId = frame.correlationId;
  if (typeof correlationId !== 'string' || correlationId.length === 0) {
    throw new Error('completion frame correlationId must be a non-empty string');
  }

  return {
    status,
    correlationId,
    summary: validateSummary(frame.summary),
  };
}

function validateSummary(raw: unknown): CompletionSummary {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('completion frame summary must be a JSON object');
  }
  const summary = raw as Partial<CompletionSummary>;

  const confidence = summary.confidence;
  if (typeof confidence !== 'number' || Number.isNaN(confidence) || confidence < 0 || confidence > 100) {
    throw new Error('completion frame summary.confidence must be a number between 0 and 100');
  }

  const actions = summary.actions;
  if (!Array.isArray(actions) || actions.some((action) => typeof action !== 'string')) {
    throw new Error('completion frame summary.actions must be an array of strings');
  }

  const notes = summary.notes;
  if (notes !== undefined && typeof notes !== 'string') {
    throw new Error('completion frame summary.notes must be a string');
  }

  return notes === undefined ? { confidence, actions } : { confidence, actions, notes };
}

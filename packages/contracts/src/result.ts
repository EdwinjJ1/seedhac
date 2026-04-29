/**
 * 跨 package 调用统一返回 Result，避免 throw 散落各处。
 * 业务逻辑只在 Skill.run / adapter 边界 throw，runtime 层捕获后包成 Result。
 */
export type Result<T, E = AppError> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });

export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

export enum ErrorCode {
  RATE_LIMITED = 'RATE_LIMITED',
  BITABLE_QPS = 'BITABLE_QPS',
  LLM_TIMEOUT = 'LLM_TIMEOUT',
  LLM_INVALID_RESPONSE = 'LLM_INVALID_RESPONSE',
  SKILL_NOT_FOUND = 'SKILL_NOT_FOUND',
  SKILL_NOT_IMPLEMENTED = 'SKILL_NOT_IMPLEMENTED',
  INVALID_INPUT = 'INVALID_INPUT',
  FEISHU_API_ERROR = 'FEISHU_API_ERROR',
  CONFIG_MISSING = 'CONFIG_MISSING',
  UNKNOWN = 'UNKNOWN',
}

export interface AppError {
  readonly code: ErrorCode;
  readonly message: string;
  readonly cause?: unknown;
  readonly meta?: Record<string, unknown>;
}

export const makeError = (
  code: ErrorCode,
  message: string,
  cause?: unknown,
  meta?: Record<string, unknown>,
): AppError => {
  const error: AppError = { code, message };
  return {
    ...error,
    ...(cause !== undefined && { cause }),
    ...(meta !== undefined && { meta }),
  };
};

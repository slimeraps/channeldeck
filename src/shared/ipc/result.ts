/**
 * Every invoke handler resolves to an IpcResult instead of throwing, so errors reach the
 * renderer with a stable code and a safe message (never a stack trace or secret).
 */

/**
 * invalid_input: payload failed the channel's schema. rejected: the action was refused for a
 * reason the user can act on (message is safe to show). internal: unexpected failure.
 */
export type IpcErrorCode =
  'invalid_input' | 'forbidden' | 'unknown_channel' | 'rejected' | 'internal'

export interface IpcIssue {
  path: string
  message: string
}

export interface IpcErrorBody {
  code: IpcErrorCode
  message: string
  issues?: IpcIssue[]
}

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: IpcErrorBody }

export function ipcOk<T>(data: T): IpcResult<T> {
  return { ok: true, data }
}

export function ipcErr<T = never>(
  code: IpcErrorCode,
  message: string,
  issues?: IpcIssue[]
): IpcResult<T> {
  return { ok: false, error: issues ? { code, message, issues } : { code, message } }
}

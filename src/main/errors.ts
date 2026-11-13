/**
 * An error whose message is written for Cody and is safe to show in the UI (no secrets,
 * no stack traces). IPC passes these through as `rejected`; any other error becomes a
 * generic "failed, see the log" message.
 */
export class UserFacingError extends Error {
  readonly userFacing = true as const

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'UserFacingError'
  }
}

export function isUserFacing(error: unknown): error is UserFacingError {
  return error instanceof Error && (error as Partial<UserFacingError>).userFacing === true
}

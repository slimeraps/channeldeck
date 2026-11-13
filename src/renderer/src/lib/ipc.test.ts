import { describe, expect, it } from 'vitest'
import { ipcErr, ipcOk } from '@shared/ipc/result'
import { IpcError, unwrap } from './ipc'

describe('unwrap', () => {
  it('returns data from an ok result', () => {
    expect(unwrap(ipcOk({ reply: 'pong' }))).toEqual({ reply: 'pong' })
  })

  it('throws a typed IpcError with code and issues', () => {
    const result = ipcErr('invalid_input', 'Invalid input for app:ping', [
      { path: 'message', message: 'Too small' }
    ])
    try {
      unwrap(result)
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(IpcError)
      const ipcError = error as IpcError
      expect(ipcError.code).toBe('invalid_input')
      expect(ipcError.message).toBe('Invalid input for app:ping')
      expect(ipcError.issues).toEqual([{ path: 'message', message: 'Too small' }])
    }
  })
})

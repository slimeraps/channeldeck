import { describe, expect, it, type Mock, vi } from 'vitest'
import { createGatedHandler, createInvokeHandler } from './invoke'

type LogFn = (...args: unknown[]) => void

function fakeLogger(): { warn: Mock<LogFn>; error: Mock<LogFn> } {
  return { warn: vi.fn<LogFn>(), error: vi.fn<LogFn>() }
}

describe('createInvokeHandler', () => {
  it('runs the handler with parsed input and wraps the result', async () => {
    const logger = fakeLogger()
    const handler = vi.fn((input: { message: string }) => ({
      reply: `pong: ${input.message}`,
      receivedAt: '2026-11-12T00:00:00.000Z'
    }))
    const invoke = createInvokeHandler('app:ping', handler, logger)

    await expect(invoke({ message: 'hi' })).resolves.toEqual({
      ok: true,
      data: { reply: 'pong: hi', receivedAt: '2026-11-12T00:00:00.000Z' }
    })
    expect(handler).toHaveBeenCalledWith({ message: 'hi' })
  })

  it('rejects a malformed payload without calling the handler', async () => {
    const logger = fakeLogger()
    const handler = vi.fn()
    const invoke = createInvokeHandler('app:ping', handler, logger)

    for (const bad of [
      undefined,
      null,
      'hi',
      { message: 42 },
      { message: '' },
      { message: 'a', x: 1 }
    ]) {
      const result = await invoke(bad)
      expect(result.ok, JSON.stringify(bad)).toBe(false)
      if (!result.ok) expect(result.error.code).toBe('invalid_input')
    }
    expect(handler).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalled()
  })

  it('rejects a payload on a channel that takes none', async () => {
    const handler = vi.fn()
    const invoke = createInvokeHandler('app:getInfo', handler, fakeLogger())
    const result = await invoke({ sneaky: true })
    expect(result.ok).toBe(false)
    expect(handler).not.toHaveBeenCalled()
  })

  it('hides handler errors from the renderer but logs them', async () => {
    const logger = fakeLogger()
    const invoke = createInvokeHandler(
      'app:openLogsFolder',
      () => {
        throw new Error('EACCES /Users/cody/secret/path')
      },
      logger
    )
    const result = await invoke(undefined)
    expect(result).toEqual({
      ok: false,
      error: { code: 'internal', message: 'app:openLogsFolder failed. Details are in the log.' }
    })
    expect(logger.error).toHaveBeenCalledOnce()
  })
})

describe('createGatedHandler (sender check)', () => {
  const devOrigin = { devServerUrl: 'http://localhost:5173' }
  const packagedOrigin = { devServerUrl: undefined }
  const forbidden = {
    ok: false,
    error: { code: 'forbidden', message: 'This sender may not call ChannelDeck IPC.' }
  }

  it('refuses a sender from another page and never runs the handler', async () => {
    const logger = fakeLogger()
    const handler = vi.fn()
    const gated = createGatedHandler('app:ping', handler, logger, () => devOrigin)

    const result = await gated(
      { senderFrame: { url: 'https://evil.example/index.html' } },
      { message: 'hi' }
    )
    expect(result).toEqual(forbidden)
    expect(handler).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledOnce()
  })

  it('refuses a missing or destroyed sender frame', async () => {
    const handler = vi.fn()
    const gated = createGatedHandler('app:ping', handler, fakeLogger(), () => devOrigin)
    expect(await gated({ senderFrame: null }, { message: 'hi' })).toEqual(forbidden)
    expect(await gated({}, { message: 'hi' })).toEqual(forbidden)
    expect(handler).not.toHaveBeenCalled()
  })

  it('refuses everything until the app origin has been set', async () => {
    const handler = vi.fn()
    const gated = createGatedHandler('app:ping', handler, fakeLogger(), () => null)
    const result = await gated(
      { senderFrame: { url: 'http://localhost:5173/' } },
      { message: 'hi' }
    )
    expect(result).toEqual(forbidden)
    expect(handler).not.toHaveBeenCalled()
  })

  it('refuses a file:// page when packaged only if it is not our renderer', async () => {
    const handler = vi.fn()
    const gated = createGatedHandler('app:ping', handler, fakeLogger(), () => packagedOrigin)
    const other = { senderFrame: { url: 'file:///Users/cody/Downloads/page.html' } }
    expect(await gated(other, { message: 'hi' })).toEqual(forbidden)
    expect(handler).not.toHaveBeenCalled()
  })

  it('lets our own renderer through (dev server and packaged)', async () => {
    const handler = vi.fn((input: { message: string }) => ({
      reply: input.message,
      receivedAt: '2026-11-12T00:00:00.000Z'
    }))
    const dev = createGatedHandler('app:ping', handler, fakeLogger(), () => devOrigin)
    const packaged = createGatedHandler('app:ping', handler, fakeLogger(), () => packagedOrigin)

    const fromDev = await dev({ senderFrame: { url: 'http://localhost:5173/' } }, { message: 'a' })
    const fromApp = await packaged(
      { senderFrame: { url: 'file:///Applications/ChannelDeck.app/out/renderer/index.html' } },
      { message: 'b' }
    )
    expect(fromDev.ok).toBe(true)
    expect(fromApp.ok).toBe(true)
    expect(handler).toHaveBeenCalledTimes(2)
  })
})

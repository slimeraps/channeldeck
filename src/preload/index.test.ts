import { beforeEach, describe, expect, it, vi } from 'vitest'

// Stand-ins for the Electron modules the sandboxed preload is allowed to use.
const { exposed, ipcRenderer } = vi.hoisted(() => ({
  exposed: new Map<string, unknown>(),
  ipcRenderer: {
    invoke: vi.fn(async () => ({ ok: true, data: 'from-main' })),
    on: vi.fn(),
    removeListener: vi.fn()
  }
}))

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (key: string, value: unknown) => exposed.set(key, value)
  },
  ipcRenderer,
  webUtils: { getPathForFile: () => '/Users/cody/Movies/drop.mp4' }
}))

async function loadPreload(): Promise<void> {
  exposed.clear()
  vi.resetModules()
  await import('./index')
}

interface ExposedApi {
  invoke: (channel: string, input?: unknown) => Promise<unknown>
  on: (channel: string, listener: (payload: unknown) => void) => () => void
}

function exposedApi(): ExposedApi {
  return exposed.get('api') as ExposedApi
}

describe('preload bridge', () => {
  beforeEach(async () => {
    ipcRenderer.invoke.mockClear()
    ipcRenderer.on.mockClear()
    ipcRenderer.removeListener.mockClear()
    await loadPreload()
  })

  it('exposes only window.api, with only invoke, on and getPathForFile', () => {
    expect([...exposed.keys()]).toEqual(['api'])
    const api = exposedApi()
    expect(Object.keys(api).sort()).toEqual(['getPathForFile', 'invoke', 'on'])
    expect(Object.isFrozen(api)).toBe(true)
    // Nothing that would hand the renderer Node or raw IPC.
    for (const leaked of ['ipcRenderer', 'require', 'process', 'send', 'sendSync']) {
      expect(api).not.toHaveProperty(leaked)
    }
  })

  it('forwards known invoke channels to main', async () => {
    await expect(exposedApi().invoke('app:ping', { message: 'hi' })).resolves.toEqual({
      ok: true,
      data: 'from-main'
    })
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('app:ping', { message: 'hi' })
  })

  it('refuses unknown invoke channels without contacting main', async () => {
    const result = await exposedApi().invoke('fs:readFile', '/etc/passwd')
    expect(result).toMatchObject({ ok: false, error: { code: 'unknown_channel' } })
    expect(ipcRenderer.invoke).not.toHaveBeenCalled()
  })

  it('subscribes to known events, strips the Electron event, and unsubscribes', () => {
    const listener = vi.fn()
    const off = exposedApi().on('ui:newPost', listener)

    expect(ipcRenderer.on).toHaveBeenCalledOnce()
    const [channel, wrapped] = ipcRenderer.on.mock.calls[0] as unknown as [
      string,
      (event: unknown, payload: unknown) => void
    ]
    expect(channel).toBe('ui:newPost')

    wrapped({ sender: 'electron-internals' }, undefined)
    expect(listener).toHaveBeenCalledWith(undefined)

    off()
    expect(ipcRenderer.removeListener).toHaveBeenCalledWith('ui:newPost', wrapped)
  })

  it('throws on unknown event channels', () => {
    expect(() => exposedApi().on('anything:else', vi.fn())).toThrow(/Unknown IPC event/)
    expect(ipcRenderer.on).not.toHaveBeenCalled()
  })
})

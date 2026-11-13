import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { clientIdHint, createClientConfigStore, parseClientFile } from './clientConfig'

const desktop = JSON.stringify({
  installed: {
    client_id: '1234567890-abcdefghijklmnop.apps.googleusercontent.com',
    project_id: 'channeldeck-1234',
    auth_uri: 'https://accounts.google.com/o/oauth2/auth',
    token_uri: 'https://oauth2.googleapis.com/token',
    client_secret: 'GOCSPX-abc',
    redirect_uris: ['http://localhost']
  }
})

describe('parseClientFile', () => {
  it('reads a Desktop app client file', () => {
    expect(parseClientFile(desktop)).toEqual({
      clientId: '1234567890-abcdefghijklmnop.apps.googleusercontent.com',
      clientSecret: 'GOCSPX-abc',
      projectId: 'channeldeck-1234'
    })
  })

  it('explains a Web application client', () => {
    expect(() => parseClientFile(JSON.stringify({ web: { client_id: 'x' } }))).toThrow(
      /Desktop app/
    )
  })

  it('rejects non-JSON and unrelated JSON', () => {
    expect(() => parseClientFile('not json')).toThrow(/valid JSON/)
    expect(() => parseClientFile('{"installed":{"client_id":"abc"}}')).toThrow(/OAuth client file/)
  })

  it('shows only a short, non-secret hint of the client id', () => {
    expect(clientIdHint('1234567890-abcdefghijklmnop.apps.googleusercontent.com')).toBe(
      '1234567890-abc…'
    )
  })
})

describe('client config store', () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
  })

  it('saves with owner-only permissions and loads it back', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cd-client-'))
    dirs.push(dir)
    const store = createClientConfigStore(dir)
    expect(store.load()).toBeNull()
    store.save(desktop)
    expect(store.load()?.projectId).toBe('channeldeck-1234')
    expect(statSync(join(dir, 'google-client.json')).mode & 0o777).toBe(0o600)
    store.remove()
    expect(store.load()).toBeNull()
  })

  it('does not save an invalid file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cd-client-'))
    dirs.push(dir)
    const store = createClientConfigStore(dir)
    expect(() => store.save('{"web":{}}')).toThrow()
    expect(store.load()).toBeNull()
  })
})

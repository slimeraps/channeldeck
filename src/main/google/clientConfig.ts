import { chmodSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { UserFacingError } from '../errors'

/**
 * The Desktop-app OAuth client from Google Cloud Console ("client_secret_….json").
 * It's copied into userData as google-client.json (never into the repo).
 */

export interface GoogleClientConfig {
  clientId: string
  clientSecret: string
  projectId: string | null
}

const installedSchema = z.object({
  installed: z.object({
    client_id: z.string().regex(/\.apps\.googleusercontent\.com$/, 'not a Google OAuth client id'),
    client_secret: z.string().min(1),
    project_id: z.string().optional()
  })
})

export function parseClientFile(text: string): GoogleClientConfig {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    throw new UserFacingError(
      "That file isn't valid JSON. Pick the client_secret_….json you downloaded from Google Cloud."
    )
  }
  if (json && typeof json === 'object' && 'web' in json) {
    throw new UserFacingError(
      'That is a "Web application" client. ChannelDeck needs a "Desktop app" client: in Google Cloud, create an OAuth client ID of type Desktop app and download its JSON.'
    )
  }
  const parsed = installedSchema.safeParse(json)
  if (!parsed.success) {
    throw new UserFacingError(
      'That doesn\'t look like a Google OAuth client file. It should contain an "installed" section with a client_id and client_secret.'
    )
  }
  const { client_id, client_secret, project_id } = parsed.data.installed
  return { clientId: client_id, clientSecret: client_secret, projectId: project_id ?? null }
}

/** A short, non-secret way to show which client is imported. */
export function clientIdHint(clientId: string): string {
  const prefix = clientId.split('.')[0] ?? clientId
  return prefix.length > 14 ? `${prefix.slice(0, 14)}…` : prefix
}

export const CLIENT_FILE_NAME = 'google-client.json'

export interface ClientConfigStore {
  load(): GoogleClientConfig | null
  /** Validates, then saves with owner-only permissions. Returns the parsed config. */
  save(text: string): GoogleClientConfig
  remove(): void
}

export function createClientConfigStore(dir: string): ClientConfigStore {
  const path = join(dir, CLIENT_FILE_NAME)
  return {
    load() {
      if (!existsSync(path)) return null
      return parseClientFile(readFileSync(path, 'utf8'))
    },
    save(text) {
      const config = parseClientFile(text)
      writeFileSync(path, text, { mode: 0o600 })
      chmodSync(path, 0o600)
      return config
    },
    remove() {
      rmSync(path, { force: true })
    }
  }
}

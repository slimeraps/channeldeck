import { createReadStream } from 'node:fs'
import { Readable } from 'node:stream'
import { classifyGoogleError, YouTubeHttpError } from './errors'
import { type BackoffOptions, DEFAULT_BACKOFF, withRetry } from '../jobs/retry'

/**
 * YouTube's resumable upload protocol
 * (https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol):
 *   1. POST metadata with uploadType=resumable → session URI in the Location header.
 *   2. PUT the file to the session URI → 201/200 with the video resource.
 *   3. After an interruption or 5xx: PUT `Content-Range: bytes * /SIZE` → 308 with
 *      `Range: bytes=0-N`, then resume with the bytes after N.
 * The session URI is kept in memory only; after an app restart the upload starts over.
 */

export const UPLOAD_URL = 'https://www.googleapis.com/upload/youtube/v3/videos'

export interface ResumableUploadOptions {
  accessToken: () => Promise<string>
  /** The `video` resource to create (snippet, status). */
  resource: Record<string, unknown>
  parts: string[]
  notifySubscribers: boolean
  filePath: string
  sizeBytes: number
  contentType: string
  onProgress?: (sentBytes: number, totalBytes: number) => void
  onRetry?: (message: string, attempt: number, delayMs: number) => void
  signal?: AbortSignal
  fetchImpl?: typeof fetch
  backoff?: BackoffOptions
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
}

export interface UploadedVideo {
  id: string
  status?: { privacyStatus?: string; publishAt?: string; uploadStatus?: string }
  [key: string]: unknown
}

class SessionExpiredError extends Error {
  constructor() {
    super('The upload session expired; starting a new one.')
    this.name = 'SessionExpiredError'
  }
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text()
  try {
    return text ? JSON.parse(text) : null
  } catch {
    return null
  }
}

async function failure(res: Response): Promise<YouTubeHttpError> {
  return new YouTubeHttpError(res.status, await readJson(res), res.headers.get('retry-after'))
}

/** Parses "bytes=0-12345" into the next byte to send (12346). No header → 0. */
export function nextOffsetFromRange(range: string | null): number {
  if (!range) return 0
  const m = /bytes=0-(\d+)/.exec(range)
  return m ? Number(m[1]) + 1 : 0
}

export async function uploadResumable(opts: ResumableUploadOptions): Promise<UploadedVideo> {
  const doFetch = opts.fetchImpl ?? fetch
  const total = opts.sizeBytes

  const startSession = async (): Promise<string> => {
    const url = new URL(UPLOAD_URL)
    url.searchParams.set('uploadType', 'resumable')
    url.searchParams.set('part', opts.parts.join(','))
    url.searchParams.set('notifySubscribers', String(opts.notifySubscribers))
    const res = await doFetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await opts.accessToken()}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Length': String(total),
        'X-Upload-Content-Type': opts.contentType
      },
      body: JSON.stringify(opts.resource),
      signal: opts.signal ?? null
    })
    if (!res.ok) throw await failure(res)
    const location = res.headers.get('location')
    if (!location) throw new Error('YouTube did not return an upload session URL.')
    return location
  }

  /** Asks how many bytes YouTube has. Returns the next offset, or the finished video. */
  const queryStatus = async (session: string): Promise<number | UploadedVideo> => {
    const res = await doFetch(session, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${await opts.accessToken()}`,
        'Content-Length': '0',
        'Content-Range': `bytes */${total}`
      },
      signal: opts.signal ?? null
    })
    if (res.status === 308) return nextOffsetFromRange(res.headers.get('range'))
    if (res.status === 200 || res.status === 201) return (await readJson(res)) as UploadedVideo
    if (res.status === 404) throw new SessionExpiredError()
    throw await failure(res)
  }

  const sendFrom = async (session: string, offset: number): Promise<UploadedVideo | null> => {
    let sent = offset
    const counter = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        sent += chunk.byteLength
        opts.onProgress?.(sent, total)
        controller.enqueue(chunk)
      }
    })
    const body = (
      Readable.toWeb(
        createReadStream(opts.filePath, { start: offset })
      ) as ReadableStream<Uint8Array>
    ).pipeThrough(counter)
    const headers: Record<string, string> = {
      Authorization: `Bearer ${await opts.accessToken()}`,
      'Content-Type': opts.contentType,
      'Content-Length': String(total - offset)
    }
    if (offset > 0) headers['Content-Range'] = `bytes ${offset}-${total - 1}/${total}`
    const res = await doFetch(session, {
      method: 'PUT',
      headers,
      body,
      // Node's fetch needs this to stream a request body.
      duplex: 'half',
      signal: opts.signal ?? null
    } as RequestInit)
    if (res.status === 200 || res.status === 201) return (await readJson(res)) as UploadedVideo
    if (res.status === 308) return null // incomplete: ask where to resume
    if (res.status === 404) throw new SessionExpiredError()
    throw await failure(res)
  }

  let session: string | null = null
  let needsStatusCheck = false
  opts.onProgress?.(0, total)

  const video = await withRetry<UploadedVideo>(
    async () => {
      if (!session) {
        session = await startSession()
        needsStatusCheck = false
      }
      let offset = 0
      if (needsStatusCheck) {
        const status = await queryStatus(session)
        if (typeof status !== 'number') return status
        offset = status
        opts.onProgress?.(offset, total)
      }
      needsStatusCheck = true
      const result = await sendFrom(session, offset)
      if (result) return result
      // 308 after a full body: ask where we are and continue straight away.
      const status = await queryStatus(session)
      if (typeof status !== 'number') return status
      throw Object.assign(new Error('Upload incomplete; resuming'), { code: 'ECONNRESET' })
    },
    {
      shouldRetry: (error) => {
        if (error instanceof SessionExpiredError) {
          session = null
          return { retry: true, afterMs: 0 }
        }
        const c = classifyGoogleError(error)
        return { retry: c.kind === 'retryable', afterMs: c.retryAfterMs }
      },
      onRetry: (error, attempt, delay) =>
        opts.onRetry?.(error instanceof Error ? error.message : String(error), attempt, delay),
      ...(opts.signal ? { signal: opts.signal } : {}),
      ...(opts.sleep ? { sleep: opts.sleep } : {})
    },
    opts.backoff ?? DEFAULT_BACKOFF
  )
  opts.onProgress?.(total, total)
  if (!video?.id) throw new Error('YouTube finished the upload but did not return a video id.')
  return video
}

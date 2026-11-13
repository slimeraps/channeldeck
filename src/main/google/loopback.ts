import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { UserFacingError } from '../errors'

/**
 * A one-shot HTTP listener on 127.0.0.1 with a random port, for Google's loopback redirect
 * (https://developers.google.com/identity/protocols/oauth2/native-app). It accepts exactly
 * one callback whose `state` matches, then shuts down.
 */

export interface LoopbackReceiver {
  redirectUri: string
  /** Resolves with the authorization code, or rejects on error / timeout / abort. */
  waitForCode(
    expectedState: string,
    options: { timeoutMs: number; signal?: AbortSignal }
  ): Promise<string>
  close(): void
}

const page = (title: string, body: string): string => `<!doctype html>
<html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font:16px -apple-system,system-ui,sans-serif;background:#09090b;color:#fafafa;display:grid;place-items:center;height:100vh;margin:0}
main{max-width:28rem;text-align:center}p{color:#a1a1aa}</style></head>
<body><main><h1>${title}</h1><p>${body}</p></main></body></html>`

function respond(res: ServerResponse, status: number, html: string): void {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'"
  })
  res.end(html)
}

export interface LoopbackOptions {
  /** Fixed port (Twitch needs the registered redirect); default: any free port. */
  port?: number
  /** Callback path, default "/". */
  path?: string
  /**
   * Host name used in the redirect URI. "127.0.0.1" (default, Google) binds only IPv4;
   * "localhost" (Twitch) binds both 127.0.0.1 and ::1, since browsers may use either.
   */
  host?: '127.0.0.1' | 'localhost'
  /** Wording on the browser page, e.g. "Google" or "Twitch". */
  provider?: string
}

export async function startLoopbackReceiver(
  options: LoopbackOptions = {}
): Promise<LoopbackReceiver> {
  const path = options.path ?? '/'
  const host = options.host ?? '127.0.0.1'
  const provider = options.provider ?? 'Google'
  let onRequest: ((req: IncomingMessage, res: ServerResponse) => void) | null = null
  const handler = (req: IncomingMessage, res: ServerResponse): void => {
    if (onRequest) onRequest(req, res)
    else respond(res, 404, page('Not found', 'ChannelDeck is not waiting for a sign-in.'))
  }

  const listen = (address: string, port: number) =>
    new Promise<ReturnType<typeof createServer>>((resolve, reject) => {
      const server = createServer(handler)
      server.once('error', reject)
      server.listen(port, address, () => resolve(server))
    })

  const servers: ReturnType<typeof createServer>[] = []
  try {
    servers.push(await listen('127.0.0.1', options.port ?? 0))
  } catch (error) {
    if ((error as { code?: string }).code === 'EADDRINUSE') {
      throw new UserFacingError(
        `Port ${options.port ?? ''} is already in use, so the sign-in can't receive its reply. Close whatever is using it (or another ChannelDeck sign-in) and try again.`
      )
    }
    throw error
  }
  const [first] = servers
  if (!first) throw new Error('Sign-in listener did not start')
  const { port } = first.address() as AddressInfo
  if (host === 'localhost') {
    // Best effort: some browsers resolve "localhost" to ::1 first.
    try {
      servers.push(await listen('::1', port))
    } catch {
      // IPv6 loopback unavailable; IPv4 is enough.
    }
  }
  const redirectUri = `http://${host}:${port}${path === '/' ? '' : path}`

  const close = (): void => {
    onRequest = null
    for (const server of servers) {
      server.close()
      server.closeAllConnections()
    }
  }

  return {
    redirectUri,
    close,
    waitForCode(expectedState, { timeoutMs, signal }) {
      return new Promise<string>((resolve, reject) => {
        const finish = (fn: () => void): void => {
          clearTimeout(timer)
          signal?.removeEventListener('abort', onAbort)
          onRequest = null
          fn()
        }
        const timer = setTimeout(
          () =>
            finish(() =>
              reject(new UserFacingError('Sign-in timed out. Click Add channel to try again.'))
            ),
          timeoutMs
        )
        const onAbort = (): void => finish(() => reject(new UserFacingError('Sign-in canceled.')))
        if (signal?.aborted) return onAbort()
        signal?.addEventListener('abort', onAbort, { once: true })

        onRequest = (req, res) => {
          const url = new URL(req.url ?? '/', `http://${host}:${port}`)
          if (url.pathname !== path) {
            respond(res, 404, page('Not found', ''))
            return
          }
          // A callback for some other attempt (or a forged one): ignore it and keep waiting.
          if (url.searchParams.get('state') !== expectedState) {
            respond(
              res,
              400,
              page('Sign-in link expired', 'Go back to ChannelDeck and start the sign-in again.')
            )
            return
          }
          const error = url.searchParams.get('error')
          if (error) {
            respond(
              res,
              200,
              page('Sign-in canceled', 'You can close this tab and return to ChannelDeck.')
            )
            finish(() =>
              reject(
                new UserFacingError(
                  error === 'access_denied'
                    ? `You declined access in the ${provider} window, so nothing was connected.`
                    : `${provider} sign-in failed (${error}).`
                )
              )
            )
            return
          }
          const code = url.searchParams.get('code')
          if (!code) {
            respond(
              res,
              400,
              page(
                'Something went wrong',
                'Google did not send a sign-in code. Try again from ChannelDeck.'
              )
            )
            return
          }
          respond(res, 200, page('Signed in', 'You can close this tab and return to ChannelDeck.'))
          finish(() => resolve(code))
        }
      })
    }
  }
}

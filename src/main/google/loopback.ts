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

export async function startLoopbackReceiver(): Promise<LoopbackReceiver> {
  let onRequest: ((req: IncomingMessage, res: ServerResponse) => void) | null = null
  const server = createServer((req, res) => {
    if (onRequest) onRequest(req, res)
    else respond(res, 404, page('Not found', 'ChannelDeck is not waiting for a sign-in.'))
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const { port } = server.address() as AddressInfo
  const redirectUri = `http://127.0.0.1:${port}`

  const close = (): void => {
    onRequest = null
    server.close()
    server.closeAllConnections()
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
          const url = new URL(req.url ?? '/', redirectUri)
          if (url.pathname !== '/') {
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
                    ? 'You declined access in the Google window, so no channel was added.'
                    : `Google sign-in failed (${error}).`
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

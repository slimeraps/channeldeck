import { OAuth2Client } from 'google-auth-library'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ANALYTICS_URL, createAnalyticsApi } from './analytics'

const seen: { url: URL; auth: string | null }[] = []
const server = setupServer(
  http.get(ANALYTICS_URL, ({ request }) => {
    seen.push({ url: new URL(request.url), auth: request.headers.get('authorization') })
    return HttpResponse.json({
      kind: 'youtubeAnalytics#resultTable',
      columnHeaders: [{ name: 'views' }],
      rows: [[42]]
    })
  })
)
beforeAll(() => server.listen({ onUnhandledFrame: 'bypass' }))
afterAll(() => server.close())

describe('YouTube Analytics reports.query', () => {
  it('asks for the signed-in channel with the token and the given params', async () => {
    const auth = new OAuth2Client({ clientId: 'id', clientSecret: 'secret' })
    auth.setCredentials({ access_token: 'at-analytics', expiry_date: Date.now() + 3_600_000 })
    const table = await createAnalyticsApi(auth).query({
      startDate: '2026-11-01',
      endDate: '2026-11-07',
      metrics: ['views', 'likes'],
      dimensions: ['video'],
      sort: '-views',
      maxResults: 10
    })
    expect(table.rows).toEqual([[42]])
    const [call] = seen
    expect(call?.auth).toBe('Bearer at-analytics')
    expect(Object.fromEntries(call?.url.searchParams ?? [])).toEqual({
      ids: 'channel==MINE',
      startDate: '2026-11-01',
      endDate: '2026-11-07',
      metrics: 'views,likes',
      dimensions: 'video',
      sort: '-views',
      maxResults: '10'
    })
  })
})

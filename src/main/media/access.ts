import { normalize } from 'node:path'
import type { MediaPolicy } from './mediaUrl'

/**
 * Which local files the renderer may preview through cdmedia://. Files the user picked or
 * dropped this session are granted explicitly; files referenced by a post and anything in
 * the clip folder are allowed by policy.
 */
export interface MediaAccess {
  grant(path: string): void
  policy(): MediaPolicy
}

export function createMediaAccess(deps: {
  roots: () => string[]
  isReferenced: (path: string) => boolean
}): MediaAccess {
  const granted = new Set<string>()
  return {
    grant: (path) => {
      granted.add(normalize(path))
    },
    policy: () => ({
      roots: deps.roots(),
      isAllowedFile: (path) => granted.has(path) || deps.isReferenced(path)
    })
  }
}

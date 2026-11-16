export type ClipOrientation = 'landscape' | 'portrait'

export const CLIP_ORIENTATIONS: readonly ClipOrientation[] = ['landscape', 'portrait']

export const ORIENTATION_LABEL: Record<ClipOrientation, string> = {
  landscape: 'Horizontal',
  portrait: 'Vertical'
}

interface ClipFiles {
  landscapeUrl: string | null
  portraitUrl: string | null
  downloadStatus: string
}

export interface OrientationOption {
  orientation: ClipOrientation
  url: string | null
  enabled: boolean
  /** Tooltip text: what clicking does, or why the version can't be played. */
  hint: string
}

/** Why one version of a clip isn't on disk, from the clip's download status. */
function missingReason(orientation: ClipOrientation, downloadStatus: string): string {
  const name = orientation === 'landscape' ? 'horizontal' : 'vertical'
  switch (downloadStatus) {
    case 'pending':
      return `Not downloaded yet: the ${name} file is waiting to download.`
    case 'downloading':
      return `Not downloaded yet: the ${name} file is downloading.`
    case 'failed':
      return `Not on disk: the download failed. It retries on its own.`
    case 'not_downloadable':
      return `Not on disk: Twitch doesn’t let this account download the clip.`
    case 'deleted':
      return `Not on disk: the clip’s local files were deleted.`
    default:
      return `Not on disk: Twitch had no ${name} version of this clip, or the file was removed.`
  }
}

/** Both orientation buttons of the clip viewer, with whether each can be played and why not. */
export function orientationOptions(clip: ClipFiles): OrientationOption[] {
  return CLIP_ORIENTATIONS.map((orientation) => {
    const url = orientation === 'landscape' ? clip.landscapeUrl : clip.portraitUrl
    return {
      orientation,
      url,
      enabled: url !== null,
      hint: url
        ? `Play the ${orientation === 'landscape' ? 'horizontal (16:9)' : 'vertical (9:16)'} file`
        : missingReason(orientation, clip.downloadStatus)
    }
  })
}

/**
 * Which version the viewer plays. Keeps the user's pick while that file exists;
 * otherwise portrait first (what the viewer always showed), then landscape, else nothing.
 */
export function pickOrientation(
  clip: Pick<ClipFiles, 'landscapeUrl' | 'portraitUrl'>,
  wanted?: ClipOrientation | null
): ClipOrientation | null {
  if (wanted === 'landscape' && clip.landscapeUrl) return 'landscape'
  if (wanted === 'portrait' && clip.portraitUrl) return 'portrait'
  if (clip.portraitUrl) return 'portrait'
  if (clip.landscapeUrl) return 'landscape'
  return null
}

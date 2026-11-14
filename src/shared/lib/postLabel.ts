/**
 * How a post is named outside the app window (notifications, the menu bar). With "Hide post
 * titles" on (for streaming), private titles never show: the post is just "a video".
 */
export function postLabel(title: string, hideTitles: boolean): string {
  return hideTitles ? 'a video' : `"${title || 'Untitled'}"`
}

/** Capitalizes the first letter, for a label that starts a sentence ("A video is now public"). */
export function sentence(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** Calendar colors for channels. New channels take the next unused one. */
export const CHANNEL_COLORS = [
  '#6366f1', // indigo
  '#f97316', // orange
  '#22c55e', // green
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#eab308', // yellow
  '#a855f7', // purple
  '#ef4444' // red
] as const

export const HEX_COLOR = /^#[0-9a-f]{6}$/i

export function nextChannelColor(used: readonly string[]): string {
  const taken = new Set(used.map((c) => c.toLowerCase()))
  const free = CHANNEL_COLORS.find((c) => !taken.has(c))
  return free ?? CHANNEL_COLORS[used.length % CHANNEL_COLORS.length] ?? CHANNEL_COLORS[0]
}

import { cn } from '@renderer/lib/utils'
import { MARK, WORDMARK } from './paths'

/** The brand pink. Keep in step with BRAND_MARK in scripts/draw-icons.swift and --brand in globals.css. */
export const BRAND_PINK = '#ffa6c9'

/** The ChannelDeck mark on its own, sized by `className` (height; width follows). */
export function BrandMark({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg
      viewBox={`0 0 ${MARK.width} ${MARK.height}`}
      className={cn('h-5 w-auto shrink-0', className)}
      aria-hidden
    >
      <path d={MARK.d} fill={BRAND_PINK} fillRule="evenodd" />
    </svg>
  )
}

/** Mark + "channeldeck" wordmark. The wordmark takes the text color (`currentColor`). */
export function BrandLogo({ className }: { className?: string }): React.JSX.Element {
  // Laid out like the brand sheet: the wordmark sits beside the mark, about a third of its height.
  const gap = MARK.width * 0.18
  const wordScale = (MARK.height * 0.42) / WORDMARK.height
  const wordWidth = WORDMARK.width * wordScale
  const width = MARK.width + gap + wordWidth
  const wordTop = (MARK.height - WORDMARK.height * wordScale) / 2
  return (
    <svg
      viewBox={`0 0 ${width} ${MARK.height}`}
      className={cn('h-6 w-auto', className)}
      role="img"
      aria-label="ChannelDeck"
    >
      <path d={MARK.d} fill={BRAND_PINK} fillRule="evenodd" />
      <path
        d={WORDMARK.d}
        fill="currentColor"
        fillRule="evenodd"
        transform={`translate(${MARK.width + gap} ${wordTop}) scale(${wordScale})`}
      />
    </svg>
  )
}

import { X } from 'lucide-react'
import { useState } from 'react'
import { TAGS_MAX_CHARS } from '@shared/constants/limits'
import { normalizeTags, tagsLength } from '@shared/schemas/post'
import { cn } from '@renderer/lib/utils'

interface TagInputProps {
  id: string
  value: string[]
  onChange: (tags: string[]) => void
  invalid?: boolean
}

/** Chip input: Enter or comma adds a tag, Backspace on empty removes the last one. */
export function TagInput({ id, value, onChange, invalid }: TagInputProps): React.JSX.Element {
  const [draft, setDraft] = useState('')
  const used = tagsLength(value)

  const commit = (text: string): void => {
    const parts = text.split(',')
    const next = normalizeTags([...value, ...parts])
    if (next.length !== value.length) onChange(next)
    setDraft('')
  }

  return (
    <div>
      <div
        className={cn(
          'flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border bg-transparent px-2 py-1.5 text-sm shadow-xs focus-within:ring-[3px] focus-within:ring-ring/50',
          invalid && 'border-destructive'
        )}
      >
        {value.map((tag) => (
          <span
            key={tag}
            className="flex items-center gap-1 rounded bg-secondary px-1.5 py-0.5 text-xs"
          >
            {tag}
            <button
              type="button"
              aria-label={`Remove tag ${tag}`}
              onClick={() => onChange(value.filter((t) => t !== tag))}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="size-3" aria-hidden />
            </button>
          </span>
        ))}
        <input
          id={id}
          value={draft}
          placeholder={value.length === 0 ? 'Type a tag and press Enter' : ''}
          className="min-w-24 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
          onChange={(e) => {
            const text = e.target.value
            if (text.includes(',')) commit(text)
            else setDraft(text)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              if (draft.trim()) commit(draft)
            } else if (e.key === 'Backspace' && draft === '' && value.length > 0) {
              onChange(value.slice(0, -1))
            }
          }}
          onBlur={() => draft.trim() && commit(draft)}
        />
      </div>
      <p
        className={cn(
          'mt-1 text-right text-xs text-muted-foreground',
          used > TAGS_MAX_CHARS && 'text-destructive'
        )}
      >
        {used}/{TAGS_MAX_CHARS}
      </p>
    </div>
  )
}

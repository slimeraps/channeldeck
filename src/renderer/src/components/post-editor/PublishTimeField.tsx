import { DateTime } from 'luxon'
import { useEffect, useState } from 'react'
import { localToUtcIso, utcIsoToLocalParts } from '@shared/lib/time'
import { Input } from '@renderer/components/ui/input'
import { formatRelative } from '@renderer/lib/time'

interface Props {
  value: string | null
  onChange: (utcIso: string | null) => void
  invalid?: boolean
}

const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone

/** Date + time in the Mac's time zone, with the UTC value and "in 3h 20m" underneath. */
export function PublishTimeField({ value, onChange, invalid }: Props): React.JSX.Element {
  const parts = value ? utcIsoToLocalParts(value) : { date: '', time: '' }
  const [now, setNow] = useState(() => new Date())

  // Keep "in 3h 20m" honest while the editor is open.
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(timer)
  }, [])

  const update = (next: { date?: string; time?: string }): void => {
    const date = next.date ?? parts.date
    const time = next.time ?? (parts.time || '09:00')
    onChange(date ? localToUtcIso({ date, time }) : null)
  }

  return (
    <div className="space-y-1.5">
      <div className="flex gap-2">
        <Input
          type="date"
          aria-label="Publish date"
          value={parts.date}
          onChange={(e) => update({ date: e.target.value })}
          aria-invalid={invalid}
          className="w-44"
        />
        <Input
          type="time"
          aria-label="Publish time"
          value={parts.time}
          onChange={(e) => update({ time: e.target.value })}
          aria-invalid={invalid}
          className="w-32"
        />
        <span className="self-center text-xs text-muted-foreground">{localZone}</span>
      </div>
      {value ? (
        <p className="text-xs text-muted-foreground">
          UTC {DateTime.fromISO(value, { zone: 'utc' }).toFormat('yyyy-LL-dd HH:mm')} ·{' '}
          <span className="text-foreground">{formatRelative(value, now)}</span>
        </p>
      ) : null}
    </div>
  )
}

import { cn } from '@renderer/lib/utils'

/** Small controls shared by the editor's panels. */

export function Slider({
  label,
  value,
  min,
  max,
  step,
  suffix = '',
  onChange,
  onCommit
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  suffix?: string
  onChange: (value: number) => void
  onCommit: () => void
}): React.JSX.Element {
  return (
    <label className="block space-y-1">
      <span className="flex justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        <span className="tabular-nums">
          {value}
          {suffix}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={onCommit}
        onKeyUp={onCommit}
        className="w-full accent-primary"
      />
    </label>
  )
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange
}: {
  label?: string
  value: T
  options: readonly (readonly [T, string])[]
  onChange: (value: T) => void
}): React.JSX.Element {
  return (
    <div className="flex flex-1 items-center gap-2">
      {label ? <span className="text-xs text-muted-foreground">{label}</span> : null}
      <div className="flex flex-1 rounded-md border p-0.5" role="group" aria-label={label}>
        {options.map(([v, text]) => (
          <button
            key={v}
            type="button"
            aria-pressed={value === v}
            onClick={() => onChange(v)}
            className={cn(
              'flex-1 rounded px-1.5 py-0.5 text-xs',
              value === v ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'
            )}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  )
}

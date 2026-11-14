/** Seconds as m:ss, or m:ss.t with tenths (the editor's timeline and transport). */
export function formatClock(sec: number, tenths = false): string {
  const total = Math.max(0, sec)
  const m = Math.floor(total / 60)
  const s = total - m * 60
  const whole = Math.floor(s)
  const base = `${m}:${String(whole).padStart(2, '0')}`
  return tenths ? `${base}.${Math.floor((s - whole) * 10)}` : base
}

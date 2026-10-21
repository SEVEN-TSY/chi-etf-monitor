import type { Change, Observation, Payload, Point, Preset, Range } from './types'

export function createModel(payload: Payload) {
  const dates = [...new Set(payload.rows.map(r => r[0]))].sort()
  const records = new Map(payload.rows.map(([day, code, shares, status]) => [day + ':' + code, { shares: shares / 1e8, status }]))
  const checked = new Set(payload.checked)
  const observation = (day: string, code: string) => records.get(day + ':' + code)
  const final = (row: Observation | undefined): row is Observation => !!row && row.status !== '待早间复核'
  function hasGap(from: string, to: string) {
    const date = new Date(from + 'T00:00:00Z')
    for (date.setUTCDate(date.getUTCDate() + 1); date.toISOString().slice(0, 10) <= to; date.setUTCDate(date.getUTCDate() + 1)) {
      if (![0, 6].includes(date.getUTCDay()) && !checked.has(date.toISOString().slice(0, 10))) return true
    }
    return false
  }
  function interval(code: string, index: number, period: number): Change | null {
    if (index < period || index >= dates.length) return null
    const days = dates.slice(index - period, index + 1)
    if (hasGap(days[0]!, days.at(-1)!)) return null
    const rows = days.map(day => observation(day, code))
    if (!rows.every(final)) return null
    const base = rows[0]!.shares, delta = rows.at(-1)!.shares - base
    return { delta, rate: base > 0 ? delta / base * 100 : null, start: days[0]! }
  }
  const points: Point[] = dates.map((day, i) => {
    const rows = payload.funds.map(f => observation(day, f.code))
    const total = rows.every(final) ? rows.reduce((n, r) => n + r.shares, 0) : null
    const changes = payload.funds.map(f => interval(f.code, i, 1))
    const delta = changes.every(c => c !== null) ? changes.reduce((n, c) => n + c.delta, 0) : null
    const prior = total !== null && delta !== null ? total - delta : null
    return { day, i, total, delta, rate: prior !== null && prior > 0 && delta !== null ? delta / prior * 100 : null,
      rate5: null, rate20: null, parts: Object.fromEntries(payload.funds.map((f, j) => [f.code, total === null ? null : rows[j]!.shares])) }
  })
  points.forEach((p, i) => {
    for (const count of [5, 20] as const) {
      const window = points.slice(Math.max(0, i - count + 1), i + 1)
      p[count === 5 ? 'rate5' : 'rate20'] = window.length === count && window.every(x => x.rate !== null)
        ? window.reduce((n, x) => n + x.rate!, 0) / count : null
    }
  })
  return { dates, points, observation, interval, final, funds: payload.funds, latest: dates.at(-1)! }
}
export type Model = ReturnType<typeof createModel>

export function constrainRange(range: Range, max: number): Range {
  const span = Math.max(Math.min(5, max), Math.min(max, range[1] - range[0]))
  const from = Math.max(0, Math.min(max - span, range[0]))
  return [from, from + span]
}
export function presetRange(dates: string[], preset: Exclude<Preset, 'custom'>): Range {
  if (!dates.length) return [0, 0]
  const latest = dates.at(-1)!, end = new Date(latest + 'T00:00:00Z')
  let cutoff = latest.slice(0, 4) + '-01-01'
  if (preset !== 'ytd') {
    const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - (preset === '1m' ? 1 : 3), 1))
    start.setUTCDate(Math.min(end.getUTCDate(), new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate()))
    cutoff = start.toISOString().slice(0, 10)
  }
  const first = dates.findIndex(d => d >= cutoff)
  return [Math.max(0, first), dates.length - 1]
}

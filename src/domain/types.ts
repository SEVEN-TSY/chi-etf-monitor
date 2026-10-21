export interface Fund { code: string; name: string; short: string; exchange: string; group: string }
export interface Payload {
  funds: Fund[]
  rows: [day: string, code: string, shares: number, status: string][]
  checked: string[]
  fetched: string | null
  generated: string
  amv?: [day: string, changePercent: number][]
}
export interface Observation { shares: number; status: string }
export interface AmvObservation { day: string; changePercent: number }
export interface AmvTrigger extends AmvObservation { type: 'daily-decline' | 'two-day-rise' }
export interface AmvCard {
  latest: AmvObservation | null
  latestTarget: string | null
  cutoff: string
  trigger: AmvTrigger | null
}
export interface Change { delta: number; rate: number | null; start: string }
export interface Point {
  day: string; i: number; total: number | null; delta: number | null
  rate: number | null; rate5: number | null; rate20: number | null
  rateChange: number | null; amv: number | null
  grossRate: number | null; anomalyPercentile: number | null
  breadth: { up: number; down: number; unchanged: number; missing: number; total: number }
  parts: Record<string, number | null>
}
export type RateKey = 'rate' | 'rate5' | 'rate20'
export type Preset = '1m' | '3m' | 'ytd' | 'custom'
export type Range = [number, number]
export interface ChartSeries {
  key: string; label: string; color: string; values: (number | null)[]
  kind?: 'line' | 'area' | 'bar'; secondary?: boolean; dash?: string
}
export interface TooltipRow { label: string; value: string; color?: string }

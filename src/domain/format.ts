export const number = (value: number | null | undefined, digits = 2) =>
  value == null ? '—' : value.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits })
export const signed = (value: number | null | undefined, digits = 2) =>
  value == null ? '—' : (value >= 0 ? '+' : '−') + number(Math.abs(value), digits)
export const percent = (value: number | null | undefined) => value == null ? '—' : signed(value) + '%'
export const colors = Array.from({ length: 8 }, (_, i) => `var(--series-${i + 1})`)
export const rates = [
  { key: 'rate', label: '单日增减率', color: colors[0]!, kind: 'line' },
  { key: 'rate5', label: '5日均线', color: colors[2]!, kind: 'line' },
  { key: 'rate20', label: '20日均线', color: colors[3]!, kind: 'line', dash: '6 3' },
] as const

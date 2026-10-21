import type { AmvCard, Payload } from './types.ts'

export function amvDates(now: Date) {
  const beijing = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).format(now)
  const today = beijing.slice(0, 10)
  const closed = new Date(today + 'T00:00:00Z')
  if (Number(beijing.slice(11, 13)) < 15) closed.setUTCDate(closed.getUTCDate() - 1)
  while ([0, 6].includes(closed.getUTCDay())) closed.setUTCDate(closed.getUTCDate() - 1)
  return { today, latestClosed: closed.toISOString().slice(0, 10) }
}

function sumChanges(first: number, second: number) {
  const parts = [first, second].map(value => {
    const [coefficient, exponent = '0'] = String(value).split('e')
    return { units: BigInt(coefficient!.replace('.', '')), scale: (coefficient!.split('.')[1]?.length ?? 0) - Number(exponent) }
  })
  // 按存储数值的十进制精度比较，避免二进制浮点把恰好4%推过阈值。
  const scale = Math.max(0, ...parts.map(part => part.scale))
  const total = parts.reduce((sum, part) => sum + part.units * 10n ** BigInt(scale - part.scale), 0n)
  return { exceedsThreshold: total > 4n * 10n ** BigInt(scale), changePercent: Number(`${total}e-${scale}`) }
}

export function createAmvCard(payload: Payload, selectedDay: string | null, now: Date): AmvCard {
  const { today, latestClosed } = amvDates(now)
  const cutoff = selectedDay ?? today
  const history = [...(payload.amv ?? [])].filter(([day, value]) => day <= latestClosed && Number.isFinite(value)).sort(([a], [b]) => a.localeCompare(b))
  const last = history.at(-1)
  const card: AmvCard = { latest: selectedDay || !last ? null : { day: last[0], changePercent: last[1] },
    latestTarget: selectedDay ? null : latestClosed, cutoff, trigger: null }
  const checked = new Set(payload.checked)
  const knownDays = new Set([...payload.rows.map(([day]) => day), ...(payload.amv ?? []).map(([day]) => day)])
  function adjacent(from: string, to: string) {
    const date = new Date(from + 'T00:00:00Z')
    for (date.setUTCDate(date.getUTCDate() + 1); date.toISOString().slice(0, 10) < to; date.setUTCDate(date.getUTCDate() + 1)) {
      const day = date.toISOString().slice(0, 10)
      // 有交易记录但缺0AMV，或工作日尚未确认休市时，不跨越拼接。
      if (knownDays.has(day) || ![0, 6].includes(date.getUTCDay()) && !checked.has(day)) return false
    }
    return true
  }
  for (let i = history.length - 1; i >= 0; i--) {
    const [day, changePercent] = history[i]!
    if (day > cutoff) continue
    if (changePercent < -2.3) {
      card.trigger = { day, type: 'daily-decline', changePercent }
      break
    }
    if (changePercent > 4) {
      card.trigger = { day, type: 'daily-rise', changePercent }
      break
    }
    const previous = history[i - 1]
    if (previous && adjacent(previous[0], day)) {
      const sum = sumChanges(previous[1], changePercent)
      if (sum.exceedsThreshold) {
        card.trigger = { day, type: 'two-day-rise', changePercent: sum.changePercent }
        break
      }
    }
  }
  return card
}

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createModel, constrainRange, presetRange } from '../src/domain/model'
import type { Payload } from '../src/domain/types'
// 确定性样本独立于本地数据库和联网采集。
const days: string[] = []
for (const d = new Date('2026-01-05T00:00:00Z'); days.length < 45; d.setUTCDate(d.getUTCDate() + 1)) {
  if (![0, 6].includes(d.getUTCDay())) days.push(d.toISOString().slice(0, 10))
}
const funds = ['510300', '159919'].map((code, i) => ({ code, name: '测试ETF' + i, short: code, exchange: 'test', group: 'test' }))
const payload: Payload = { funds, checked: days, fetched: null, generated: '',
  rows: days.flatMap((day, i) => funds.map((fund, j) => [day, fund.code, (100 + j * 10 + i * i * .01) * 1e8, '次日早间口径'] as Payload['rows'][number])) }
const model = createModel(payload)
test('合计与逐只ETF份额一致，单日比率以先前总份额为分母', () => {
  for (let i = 1; i < model.points.length; i++) {
    const p = model.points[i]!, prior = model.points[i - 1]!
    if (p.total !== null) assert.ok(Math.abs(p.total - Object.values(p.parts).reduce<number>((n, v) => n + v!, 0)) < 1e-8)
    if (p.rate !== null && prior.total !== null) assert.ok(Math.abs(p.rate - (p.total! - prior.total) / prior.total * 100) < 1e-8)
  }
})
test('均线取完整历史中的每日比率，视口不影响结果', () => {
  const index = model.points.findIndex((p, i) => i >= 20 && p.rate20 !== null)
  assert.ok(index >= 20)
  const point = model.points[index]!
  assert.ok(Math.abs(point.rate20! - model.points.slice(index - 19, index + 1).reduce((n, p) => n + p.rate!, 0) / 20) < 1e-10)
})
test('缺失和待复核记录打断总量、单日变化和均线', () => {
  const copy: Payload = structuredClone(payload)
  const day = model.dates[30]!, code = model.funds[0]!.code
  copy.rows.find(r => r[0] === day && r[1] === code)![3] = '待早间复核'
  const incomplete = createModel(copy)
  assert.equal(incomplete.points[30]!.total, null)
  assert.equal(incomplete.points[30]!.rate, null)
  assert.equal(incomplete.points[31]!.rate, null)
  assert.equal(incomplete.points[31]!.rate20, null)
  assert.equal(incomplete.interval(code, 31, 5), null)
})
test('缺失的查询日期不按休市或零变化计算', () => {
  const copy: Payload = structuredClone(payload)
  const i = model.dates.findIndex((d, i) => i > 0 && ![0, 6].includes(new Date(d).getUTCDay()) && model.points[i]?.rate !== null)
  copy.checked = copy.checked.filter(d => d !== model.dates[i])
  assert.equal(createModel(copy).points[i]!.rate, null)
})
test('默认近1月及拖动边界', () => {
  const dates = ['2026-08-30', '2026-09-19', '2026-09-21', '2026-10-20']
  assert.deepEqual(presetRange(dates, '1m'), [2, 3])
  assert.deepEqual(constrainRange([-5, 15], 100), [0, 20])
  assert.deepEqual(constrainRange([95, 115], 100), [80, 100])
  assert.deepEqual(constrainRange([40, 41], 100), [40, 45])
})

test('增减相互抵消仍显示份额异动，广度区分增加、减少、持平和缺失', () => {
  const sample: Payload = { funds, checked: days.slice(0, 3), fetched: null, generated: '', amv: [[days[1]!, -.39]],
    rows: [[days[0]!, funds[0]!.code, 100e8, '清算后'], [days[0]!, funds[1]!.code, 100e8, '清算后'],
      [days[1]!, funds[0]!.code, 110e8, '清算后'], [days[1]!, funds[1]!.code, 90e8, '清算后'],
      [days[2]!, funds[0]!.code, 110e8, '清算后'], [days[2]!, funds[1]!.code, 90e8, '待早间复核']] }
  const points = createModel(sample).points
  assert.equal(points[1]!.rate, 0)
  assert.equal(points[1]!.grossRate, 10)
  assert.equal(points[1]!.amv, -.39)
  assert.equal(points[0]!.amv, null)
  assert.deepEqual(points[1]!.breadth, { up: 1, down: 1, unchanged: 0, missing: 0, total: 2 })
  assert.deepEqual(points[2]!.breadth, { up: 0, down: 0, unchanged: 1, missing: 1, total: 2 })
  assert.equal(points[2]!.grossRate, null)
})

test('增减率前日变化使用百分点，0AMV按日期独立关联且保留零值', () => {
  const sample: Payload = { funds: funds.slice(0, 1), checked: days.slice(0, 3), fetched: null, generated: '', amv: [[days[2]!, 0]],
    rows: [[days[0]!, funds[0]!.code, 100e8, '清算后'], [days[1]!, funds[0]!.code, 110e8, '清算后'], [days[2]!, funds[0]!.code, 121e8, '清算后']] }
  const points = createModel(sample).points
  assert.equal(points[1]!.rate, 10)
  assert.equal(points[1]!.rateChange, null)
  assert.equal(points[2]!.rateChange, 0)
  assert.equal(points[2]!.amv, 0)
  assert.equal(points[1]!.amv, null)
})

test('异动分位只使用此前60交易日，不受未来爆量或视口影响，并列持平取中间排名', () => {
  const history: string[] = []
  for (const d = new Date('2026-01-05T00:00:00Z'); history.length < 64; d.setUTCDate(d.getUTCDate() + 1)) {
    if (![0, 6].includes(d.getUTCDay())) history.push(d.toISOString().slice(0, 10))
  }
  const sample: Payload = { funds: funds.slice(0, 1), checked: history, fetched: null, generated: '',
    rows: history.map((day, i) => [day, funds[0]!.code, (i < 62 ? 100 : i === 62 ? 150 : 10000) * 1e8, '清算后']) }
  const points = createModel(sample).points
  assert.equal(points[60]!.anomalyPercentile, null)
  assert.equal(points[61]!.anomalyPercentile, 50)
  assert.equal(points[62]!.anomalyPercentile, 100)
  sample.rows.pop()
  assert.equal(createModel(sample).points[62]!.anomalyPercentile, 100)
  sample.rows[20]![3] = '待早间复核'
  assert.equal(createModel(sample).points[62]!.anomalyPercentile, null)
})

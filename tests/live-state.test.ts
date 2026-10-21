import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRenderer, nextTick, shallowRef } from 'vue'
import { useDashboard } from '../src/composables/useDashboard'
import type { Payload } from '../src/domain/types'

test('数据库刷新更新计算结果，同时保留选择日期、比较区间、时间窗口和详情状态', async () => {
  const descriptors = ['window', 'localStorage'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const)
  Object.defineProperty(globalThis, 'window', { configurable: true, value: new EventTarget() })
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null, setItem: () => {} } })
  const days = Array.from({ length: 25 }, (_, i) => '2026-01-' + String(i + 1).padStart(2, '0'))
  const data = shallowRef<Payload>({ funds: [{ code: '510300', name: 'ETF', short: 'ETF', exchange: 'SH', group: '300' }],
    checked: days, rows: days.map((day, i) => [day, '510300', (100 + i) * 1e8, '清算后']), fetched: null, generated: '' })
  let state: ReturnType<typeof useDashboard> | undefined
  const renderer = createRenderer<object, object>({ patchProp() {}, insert() {}, remove() {}, createElement: () => ({}), createText: () => ({}), createComment: () => ({}), setText() {}, setElementText() {}, parentNode: () => null, nextSibling: () => null })
  const app = renderer.createApp({ setup() { state = useDashboard(data); return () => null } })
  try {
    app.mount({})
    state!.setRange([4, 20])
    state!.selectedDay.value = days[10]!
    state!.period.value = 5
    state!.detailsOpen.value = true
    const updated = structuredClone(data.value)
    updated.rows[10]![2] = 222e8
    updated.rows.push(['2026-01-26', '510300', 150e8, '清算后'])
    updated.checked.push('2026-01-26')
    updated.amv = [[days[10]!, -.39], ['2026-01-26', 1.2]]
    data.value = updated
    await nextTick()
    assert.equal(state!.model.points[10]!.total, 222)
    assert.equal(state!.model.latest, '2026-01-26')
    assert.equal(state!.selectedDay.value, days[10])
    assert.equal(state!.metrics.value?.total, 222)
    assert.equal(state!.metrics.value?.amv, -.39)
    assert.deepEqual(state!.range.value, [4, 20])
    assert.equal(state!.period.value, 5)
    assert.equal(state!.detailsOpen.value, true)
  } finally {
    app.unmount()
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  }
})

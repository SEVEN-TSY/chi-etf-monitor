import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { createRenderer, createSSRApp, h, nextTick, shallowRef } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import { useDashboard } from '../src/composables/useDashboard'
import { useAmvSync } from '../src/composables/useAmvSync'
import type { Payload } from '../src/domain/types'

function dashboard(t: TestContext, amv: NonNullable<Payload['amv']>, savedDay: string | null = null, refresh?: () => void,
  clock = { now: '2026-10-21T08:00:00Z', intervals: false }) {
  const days = ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-19', '2026-10-20']
  const descriptors: [string, PropertyDescriptor | undefined][] = []
  for (const [key, value] of Object.entries({
    window: new EventTarget(),
    document: Object.assign(new EventTarget(), { visibilityState: 'visible' }),
    localStorage: { getItem: () => JSON.stringify({ version: 1, selectedDay: savedDay }), setItem() {} },
  })) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key)
    Object.defineProperty(globalThis, key, { configurable: true, value })
    descriptors.push([key, descriptor])
  }
  t.mock.timers.enable({ apis: clock.intervals ? ['Date', 'setInterval'] : ['Date'], now: new Date(clock.now) })
  const data = shallowRef<Payload>({ funds: [{ code: '510300', name: 'ETF', short: 'ETF', exchange: 'SH', group: '300' }],
    checked: days, rows: days.map(day => [day, '510300', 100e8, '清算后']), amv, fetched: null, generated: '' })
  let state!: ReturnType<typeof useDashboard>
  let sync: ReturnType<typeof useAmvSync> | undefined
  const renderer = createRenderer<object, object>({ patchProp() {}, insert() {}, remove() {}, createElement: () => ({}), createText: () => ({}), createComment: () => ({}), setText() {}, setElementText() {}, parentNode: () => null, nextSibling: () => null })
  const app = renderer.createApp({ setup() { state = useDashboard(data); if (refresh) sync = useAmvSync(state.amvSyncTargets, refresh); return () => null } })
  app.mount({})
  t.after(() => {
    app.unmount()
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  })
  return { state, data, sync }
}

test('0AMV默认主值跟随视口末日，独立最新数据不受ETF末日限制；历史选择移出视口也不变', t => {
  const { state } = dashboard(t, [['2026-10-12', 0], ['2026-10-20', .36], ['2026-10-21', 1.2]])
  assert.equal(state.metrics.value?.amv, .36)
  assert.deepEqual(state.amvCard.value.latest, { day: '2026-10-21', changePercent: 1.2 })
  state.selectedDay.value = '2026-10-20'
  assert.equal(state.amvCard.value.latest, null)
  state.setRange([0, 5])
  assert.equal(state.metrics.value?.day, '2026-10-20')
  assert.equal(state.metrics.value?.amv, .36)
  state.selectedDay.value = '2026-10-12'
  assert.equal(state.metrics.value?.amv, 0)
  state.selectedDay.value = null
  assert.equal(state.metrics.value?.day, '2026-10-19')
  assert.equal(state.metrics.value?.amv, null)
})

test('默认浏览补采独立最新收盘日，成功刷新后保留视口；手动选择只补采所选缺失日期', async t => {
  const requested: string[] = []
  t.mock.method(globalThis, 'fetch', async (_url: string, options: RequestInit) => {
    const day = JSON.parse(options.body as string).day
    requested.push(day)
    return Response.json(day === '2026-10-21' ? { status: 'ready' }
      : { status: 'unavailable', message: '行情尚未返回当日数据', retryAfter: 300 })
  })
  let refreshes = 0
  const { state, data, sync } = dashboard(t, [['2026-10-20', .36]], null, () => {
    refreshes++
    data.value = { ...data.value, amv: [['2026-10-20', .36], ['2026-10-21', 0]] }
  })
  state.setRange([0, 5])
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(refreshes, 1)
  assert.ok(requested.includes('2026-10-21'))
  assert.deepEqual(state.range.value, [0, 5])
  assert.deepEqual(state.amvCard.value.latest, { day: '2026-10-21', changePercent: 0 })
  requested.length = 0
  state.selectedDay.value = '2026-10-12'
  await nextTick()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(requested, ['2026-10-12'])
  assert.equal(sync!.statuses.value['2026-10-12'], '行情尚未返回当日数据')
  assert.equal(state.metrics.value?.amv, null)
  assert.equal(state.amvCard.value.latest, null)
})

test('独立最新数据只使用已收盘日期，页面跨过15点后更新补采目标且不改历史选择', t => {
  const { state } = dashboard(t, [['2026-10-20', .36], ['2026-10-21', -2.5], ['2026-10-22', 10]], null, undefined,
    { now: '2026-10-21T06:59:00Z', intervals: true })
  assert.deepEqual(state.amvCard.value.latest, { day: '2026-10-20', changePercent: .36 })
  assert.equal(state.amvCard.value.trigger, null)
  assert.deepEqual(state.amvSyncTargets.value, [])
  t.mock.timers.tick(60000)
  assert.deepEqual(state.amvCard.value.latest, { day: '2026-10-21', changePercent: -2.5 })
  state.selectedDay.value = '2026-10-20'
  t.mock.timers.tick(60000)
  assert.equal(state.amvCard.value.latest, null)
  assert.equal(state.amvCard.value.cutoff, '2026-10-20')
  assert.equal(state.amvCard.value.trigger, null)
})

test('周末的默认补采目标回到最近已收盘工作日', t => {
  const { state } = dashboard(t, [['2026-10-20', .36], ['2026-10-23', 0]], null, undefined,
    { now: '2026-10-24T08:00:00Z', intervals: false })
  assert.equal(state.amvCard.value.latestTarget, '2026-10-23')
  assert.deepEqual(state.amvSyncTargets.value, [])
})

test('最近触发按日期优先，历史截止日含当日，恢复出的历史选择隐藏最新数据且刷新保留视口', async t => {
  const { state, data } = dashboard(t, [['2026-10-16', -2.31], ['2026-10-19', 3], ['2026-10-20', 1.2], ['2026-10-21', -2.5]], '2026-10-20')
  assert.equal(state.amvCard.value.latest, null)
  assert.deepEqual(state.amvCard.value.trigger, { day: '2026-10-20', type: 'two-day-rise', changePercent: 4.2 })
  state.selectedDay.value = '2026-10-19'
  assert.deepEqual(state.amvCard.value.trigger, { day: '2026-10-16', type: 'daily-decline', changePercent: -2.31 })
  state.setRange([0, 5])
  data.value = { ...data.value, amv: [...data.value.amv!, ['2026-10-22', -10]] }
  await nextTick()
  assert.equal(state.selectedDay.value, '2026-10-19')
  assert.deepEqual(state.range.value, [0, 5])
  assert.equal(state.amvCard.value.trigger?.day, '2026-10-16')
  state.selectedDay.value = null
  assert.deepEqual(state.amvCard.value.trigger, { day: '2026-10-21', type: 'daily-decline', changePercent: -2.5 })
})

test('阈值使用原有精度与算术和，严格边界不触发，同日下跌优先', async t => {
  const { state, data } = dashboard(t, [])
  for (const [rates, expected] of [
    [[3, 1], null],
    [[0, -2.3], null],
    [[0, -2.31], { day: '2026-10-20', type: 'daily-decline', changePercent: -2.31 }],
    [[7, -2.5], { day: '2026-10-20', type: 'daily-decline', changePercent: -2.5 }],
    [[0, -2.300001], { day: '2026-10-20', type: 'daily-decline', changePercent: -2.300001 }],
  ] as const) {
    data.value = { ...data.value, amv: [['2026-10-19', rates[0]], ['2026-10-20', rates[1]]] }
    await nextTick()
    assert.deepEqual(state.amvCard.value.trigger, expected)
  }
})

test('十进制算术和恰好4%不会因浮点误差触发，真实略超4%仍触发', async t => {
  const { state, data } = dashboard(t, [['2026-10-19', -4.05], ['2026-10-20', 8.05]])
  assert.deepEqual(state.amvCard.value.trigger, { day: '2026-10-19', type: 'daily-decline', changePercent: -4.05 })
  data.value = { ...data.value, amv: [['2026-10-19', -4.05], ['2026-10-20', 8.050000000000002]] }
  await nextTick()
  assert.deepEqual(state.amvCard.value.trigger, { day: '2026-10-20', type: 'two-day-rise', changePercent: 4.000000000000002 })
  data.value = { ...data.value, amv: [['2026-10-19', 1e-7], ['2026-10-20', 4]] }
  await nextTick()
  assert.deepEqual(state.amvCard.value.trigger, { day: '2026-10-20', type: 'two-day-rise', changePercent: 4.0000001 })
})

test('两日事件可跨周末和已确认休市日，不跨已知缺失交易日或未知工作日', async t => {
  const { state, data } = dashboard(t, [['2026-10-16', 3], ['2026-10-19', 1.2]])
  assert.deepEqual(state.amvCard.value.trigger, { day: '2026-10-19', type: 'two-day-rise', changePercent: 4.2 })
  data.value = { ...data.value, amv: [['2026-10-16', 3], ['2026-10-20', 1.2]] }
  await nextTick()
  assert.equal(state.amvCard.value.trigger, null)
  data.value = { ...data.value, rows: data.value.rows.filter(([day]) => day !== '2026-10-19') }
  await nextTick()
  assert.deepEqual(state.amvCard.value.trigger, { day: '2026-10-20', type: 'two-day-rise', changePercent: 4.2 })
  data.value = { ...data.value, checked: data.value.checked.filter(day => day !== '2026-10-19') }
  await nextTick()
  assert.equal(state.amvCard.value.trigger, null)
  data.value = { ...data.value, amv: [['2026-10-20', 5]] }
  await nextTick()
  assert.equal(state.amvCard.value.trigger, null)
})

test('四张卡片的可见文本区分主值、独立最新值、最近事件和历史无触发状态', async t => {
  const { state } = dashboard(t, [['2026-10-19', 7], ['2026-10-20', -2.5], ['2026-10-21', 0]])
  const server = await createServer({ configFile: false, plugins: [vue()], server: { middlewareMode: true }, appType: 'custom' })
  t.after(() => server.close())
  const { default: MetricCards } = await server.ssrLoadModule('/src/components/MetricCards.vue')
  const render = () => renderToString(createSSRApp({ render: () => h(MetricCards, {
    point: state.metrics.value, amv: state.amvCard.value, amvStatus: '正在补采当日数据…',
  }) }))
  let html = await render()
  assert.equal((html.match(/class="metric-card(?:"| )/g) ?? []).length, 4)
  assert.match(html, /最新已收盘.*2026-10-21.*\+0\.00%/s)
  assert.match(html, /2026-10-20.*单日跌破−2\.3%.*−2\.50%/s)
  assert.doesNotMatch(html, /两日合计涨幅超过4%/)
  state.selectedDay.value = '2026-10-19'
  html = await render()
  assert.doesNotMatch(html, /最新已收盘|2026-10-21/)
  assert.match(html, /截至2026-10-19的可用历史中暂无触发/)
  state.selectedDay.value = '2026-10-12'
  html = await render()
  assert.match(html, /正在补采当日数据/)
  assert.match(html, /截至2026-10-12的可用历史中暂无触发/)
})

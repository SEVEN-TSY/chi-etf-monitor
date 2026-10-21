import { computed, onBeforeUnmount, onMounted, ref, shallowReactive, toValue, watch, type MaybeRefOrGetter } from 'vue'
import { constrainRange, createModel, presetRange } from '../domain/model'
import { createAmvCard } from '../domain/amv'
import type { Payload, Preset, Range, RateKey } from '../domain/types'

interface SavedState {
  version: 1; selectedDay: string | null; period: number; fund: string
  preset: Preset; range: Range; visibleRates: RateKey[]; detailsOpen: boolean
}
interface WidgetBridge {
  widgetState?: { privateContent?: { frontend?: SavedState } }
  setWidgetState?: (state: unknown) => Promise<void>
}
declare global { interface Window { openai?: WidgetBridge } }
const storageKey = 'etf-dashboard-vue-v1'
const isPreset = (v: unknown): v is Preset => ['1m', '3m', 'ytd', 'custom'].includes(String(v))

export function useDashboard(payload: MaybeRefOrGetter<Payload>) {
  const model = shallowReactive(createModel(toValue(payload)))
  const selectedDay = ref<string | null>(null)
  const period = ref(1)
  const fund = ref(model.funds[0]?.code ?? '')
  const preset = ref<Preset>('1m')
  const range = ref<Range>(presetRange(model.dates, '1m'))
  const visibleRates = ref<RateKey[]>(['rate', 'rate5', 'rate20'])
  const detailsOpen = ref(false)
  const now = ref(new Date())
  let restoring = false
  function restore(value: unknown) {
    if (!value || typeof value !== 'object') return
    const s = value as Partial<SavedState>
    if (s.version !== 1) return
    restoring = true
    selectedDay.value = typeof s.selectedDay === 'string' && model.dates.includes(s.selectedDay) ? s.selectedDay : null
    if (s.period && [1, 5, 20].includes(s.period)) period.value = s.period
    if (model.funds.some(f => f.code === s.fund)) fund.value = s.fund!
    if (isPreset(s.preset)) preset.value = s.preset
    range.value = preset.value !== 'custom' ? presetRange(model.dates, preset.value)
      : Array.isArray(s.range) && s.range.length === 2 && s.range.every(Number.isFinite)
        ? constrainRange(s.range, model.dates.length - 1) : presetRange(model.dates, '1m')
    const keys = Array.isArray(s.visibleRates) ? s.visibleRates.filter(k => ['rate', 'rate5', 'rate20'].includes(k)) : null
    if (keys?.length) visibleRates.value = keys
    detailsOpen.value = s.detailsOpen === true
    restoring = false
  }
  try { restore(window.openai?.widgetState?.privateContent?.frontend ?? JSON.parse(localStorage.getItem(storageKey) ?? 'null')) } catch { /* Storage may be unavailable in embedded previews. */ }
  const visiblePoints = computed(() => model.points.slice(Math.ceil(range.value[0]), Math.floor(range.value[1]) + 1))
  const metrics = computed(() => selectedDay.value
    ? model.points.find(p => p.day === selectedDay.value) : visiblePoints.value.at(-1))
  const amvCard = computed(() => createAmvCard(toValue(payload), selectedDay.value, now.value))
  const amvSyncTargets = computed(() => {
    const days = new Set<string>()
    if (metrics.value?.amv == null && metrics.value?.day) days.add(metrics.value.day)
    const latest = amvCard.value.latestTarget
    if (latest && !(toValue(payload).amv ?? []).some(([day]) => day === latest)) days.add(latest)
    return [...days]
  })
  const detailDay = computed(() => selectedDay.value ?? model.latest)
  const detailIndex = computed(() => model.dates.indexOf(detailDay.value))
  const historyDays = computed(() => model.dates.slice(0, detailIndex.value + 1))
  const selectedFund = computed(() => model.funds.find(f => f.code === fund.value)!)
  const comparisons = computed(() => model.funds.map(f => ({ ...f, change: model.interval(f.code, detailIndex.value, period.value) })))
  function setPreset(value: Exclude<Preset, 'custom'>) {
    preset.value = value
    range.value = presetRange(model.dates, value)
  }
  function setRange(value: Range) {
    preset.value = 'custom'
    range.value = constrainRange(value, model.dates.length - 1)
  }
  function toggleRate(key: RateKey) {
    if (!visibleRates.value.includes(key)) visibleRates.value = [...visibleRates.value, key]
    else if (visibleRates.value.length > 1) visibleRates.value = visibleRates.value.filter(k => k !== key)
  }
  watch(() => toValue(payload), data => {
    const fromDay = model.dates[Math.ceil(range.value[0])]
    const toDay = model.dates[Math.floor(range.value[1])]
    Object.assign(model, createModel(data))
    if (selectedDay.value && !model.dates.includes(selectedDay.value)) selectedDay.value = null
    if (!model.funds.some(f => f.code === fund.value)) fund.value = model.funds[0]?.code ?? ''
    if (preset.value !== 'custom') range.value = presetRange(model.dates, preset.value)
    else {
      const from = fromDay ? model.dates.indexOf(fromDay) : -1
      const to = toDay ? model.dates.indexOf(toDay) : -1
      range.value = constrainRange(from >= 0 && to >= 0 ? [from, to] : range.value, Math.max(0, model.dates.length - 1))
    }
  })
  let timer: ReturnType<typeof setTimeout> | undefined
  function persist() {
    const s: SavedState = { version: 1, selectedDay: selectedDay.value, period: period.value, fund: fund.value,
      preset: preset.value, range: range.value, visibleRates: visibleRates.value, detailsOpen: detailsOpen.value }
    try { localStorage.setItem(storageKey, JSON.stringify(s)) } catch { /* Optional persistence. */ }
    window.openai?.setWidgetState?.({ privateContent: { frontend: s }, modelContent: { day: model.latest, selectedDay: selectedDay.value,
      period: String(period.value), fund: fund.value, rangeStart: visiblePoints.value[0]?.day, rangeEnd: visiblePoints.value.at(-1)?.day } })?.catch(() => {})
  }
  function onGlobals(event: Event) {
    const saved = (event as CustomEvent).detail?.globals?.widgetState?.privateContent?.frontend
    if (saved) restore(saved)
  }
  watch([selectedDay, period, fund, preset, range, visibleRates, detailsOpen], () => {
    if (restoring) return
    clearTimeout(timer)
    timer = setTimeout(persist, 180)
  }, { flush: 'sync' })
  let clockTimer: ReturnType<typeof setInterval> | undefined
  onMounted(() => {
    window.addEventListener('openai:set_globals', onGlobals)
    clockTimer = setInterval(() => { now.value = new Date() }, 60000)
  })
  onBeforeUnmount(() => {
    clearTimeout(timer)
    clearInterval(clockTimer)
    window.removeEventListener('openai:set_globals', onGlobals)
  })
  return { model, selectedDay, period, fund, preset, range, visibleRates, detailsOpen, visiblePoints,
    metrics, amvCard, amvSyncTargets, detailDay, detailIndex, historyDays, selectedFund, comparisons, setPreset, setRange, toggleRate }
}

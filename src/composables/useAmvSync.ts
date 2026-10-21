import { onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'

export function useAmvSync(days: Readonly<Ref<string[]>>, refresh: () => void) {
  const statuses = ref<Record<string, string>>({})
  const requests = new Map<string, { controller: AbortController; timeout: ReturnType<typeof setTimeout> }>()
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  let disposed = false

  function schedule(day: string, seconds: number) {
    clearTimeout(timers.get(day))
    if (!disposed) timers.set(day, setTimeout(() => { timers.delete(day); void sync(day) }, Math.max(10, seconds) * 1000))
  }
  async function sync(day: string) {
    if (disposed || !days.value.includes(day) || requests.has(day) || timers.has(day)) return
    if (document.visibilityState === 'hidden') { schedule(day, 60); return }
    const controller = new AbortController()
    requests.set(day, { controller, timeout: setTimeout(() => controller.abort(), 30000) })
    statuses.value[day] = '正在补采当日数据…'
    try {
      const response = await fetch('/api/amv/sync', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ day }), signal: controller.signal,
      })
      if (!response.ok) throw new Error('补采暂不可用')
      const result = await response.json() as { status: string; message?: string; retryAfter?: number }
      if (disposed || controller.signal.aborted || !days.value.includes(day)) return
      if (result.status === 'ready') {
        statuses.value[day] = '数据已补齐，正在刷新…'
        refresh()
        schedule(day, 60)
      } else {
        statuses.value[day] = result.message ?? '暂无当日数据'
        schedule(day, result.retryAfter ?? 300)
      }
    } catch {
      if (!disposed && requests.get(day)?.controller === controller && days.value.includes(day)) {
        statuses.value[day] = controller.signal.aborted ? '补采超时，稍后自动重试' : '补采暂不可用，稍后自动重试'
        schedule(day, 300)
      }
    } finally {
      if (requests.get(day)?.controller === controller) {
        clearTimeout(requests.get(day)!.timeout)
        requests.delete(day)
      }
    }
  }
  function cancel(day: string) {
    const request = requests.get(day)
    request?.controller.abort()
    clearTimeout(request?.timeout)
    clearTimeout(timers.get(day))
    requests.delete(day)
    timers.delete(day)
    delete statuses.value[day]
  }
  function reconcile() {
    for (const day of new Set([...requests.keys(), ...timers.keys(), ...Object.keys(statuses.value)])) {
      if (!days.value.includes(day)) cancel(day)
    }
    for (const day of days.value) void sync(day)
  }
  watch(days, reconcile)
  onMounted(reconcile)
  onBeforeUnmount(() => {
    disposed = true
    for (const day of new Set([...requests.keys(), ...timers.keys()])) cancel(day)
  })
  return { statuses }
}

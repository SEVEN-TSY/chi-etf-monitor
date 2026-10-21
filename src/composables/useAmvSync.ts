import { onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'
import type { Point } from '../domain/types'

export function useAmvSync(point: Readonly<Ref<Point | undefined>>, refresh: () => void) {
  const status = ref('')
  let request: AbortController | undefined
  let timeout: ReturnType<typeof setTimeout> | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let disposed = false

  function schedule(seconds: number) {
    clearTimeout(timer)
    if (!disposed) timer = setTimeout(() => { void sync() }, Math.max(10, seconds) * 1000)
  }
  async function sync() {
    const current = point.value
    if (disposed || !current || current.amv !== null || request) return
    if (document.visibilityState === 'hidden') { schedule(60); return }
    const controller = new AbortController()
    request = controller
    status.value = '正在补采当日数据…'
    timeout = setTimeout(() => controller.abort(), 30000)
    try {
      const response = await fetch('/api/amv/sync', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ day: current.day }), signal: controller.signal,
      })
      if (!response.ok) throw new Error('补采暂不可用')
      const result = await response.json() as { status: string; message?: string; retryAfter?: number }
      if (disposed || controller.signal.aborted || point.value?.day !== current.day) return
      if (result.status === 'ready') {
        status.value = '数据已补齐，正在刷新…'
        refresh()
        schedule(60)
      } else {
        status.value = result.message ?? '暂无当日数据'
        schedule(result.retryAfter ?? 300)
      }
    } catch {
      if (!disposed && request === controller && !controller.signal.aborted) {
        status.value = '补采暂不可用，稍后自动重试'
        schedule(300)
      } else if (!disposed && request === controller && point.value?.day === current.day) {
        status.value = '补采超时，稍后自动重试'
        schedule(300)
      }
    } finally {
      if (request === controller) { clearTimeout(timeout); request = undefined }
    }
  }
  watch(() => [point.value?.day, point.value?.amv], () => {
    request?.abort()
    request = undefined
    clearTimeout(timeout)
    clearTimeout(timer)
    status.value = ''
    void sync()
  })
  onMounted(() => { void sync() })
  onBeforeUnmount(() => {
    disposed = true
    request?.abort()
    clearTimeout(timeout)
    clearTimeout(timer)
  })
  return { status }
}

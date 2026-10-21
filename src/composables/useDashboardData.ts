import { onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { fetchDashboard } from '../api'
import type { Payload } from '../domain/types'

export function useDashboardData() {
  const data = shallowRef<Payload | null>(null)
  const error = ref('')
  const loading = ref(false)
  let etag: string | null = null
  let request: AbortController | null = null
  let timeout: ReturnType<typeof setTimeout> | undefined
  let timer: ReturnType<typeof setInterval> | undefined
  let disposed = false
  async function refresh() {
    if (request || disposed) return
    const controller = new AbortController()
    request = controller
    loading.value = true
    timeout = setTimeout(() => controller.abort(), 15000)
    try {
      const result = await fetchDashboard(etag, controller.signal)
      if (disposed) return
      if (result.data) data.value = result.data
      etag = result.etag
      error.value = ''
    } catch (reason) {
      if (!disposed) error.value = controller.signal.aborted ? '读取本地数据库超时，请检查数据服务。'
        : reason instanceof Error ? reason.message : '读取本地数据库失败'
    } finally {
      clearTimeout(timeout)
      request = null
      if (!disposed) loading.value = false
    }
  }
  function visible() { if (document.visibilityState === 'visible') void refresh() }
  onMounted(() => {
    void refresh()
    timer = setInterval(visible, 60000)
    document.addEventListener('visibilitychange', visible)
    window.addEventListener('focus', visible)
  })
  onBeforeUnmount(() => {
    disposed = true
    clearInterval(timer)
    clearTimeout(timeout)
    request?.abort()
    document.removeEventListener('visibilitychange', visible)
    window.removeEventListener('focus', visible)
  })
  return { data, error, loading, refresh }
}

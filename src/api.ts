import type { Payload } from './domain/types'

export interface DashboardResponse { data: Payload | null; etag: string | null }
export async function fetchDashboard(etag: string | null, signal: AbortSignal): Promise<DashboardResponse> {
  const response = await fetch('/api/dashboard', {
    cache: 'no-store', signal, headers: etag ? { 'If-None-Match': etag } : {},
  })
  if (response.status === 304) return { data: null, etag }
  if (!response.ok) {
    const message = await response.json().catch(() => null) as { error?: string } | null
    throw new Error(message?.error ?? '本地应用连接失败，请检查npm run dev是否正在运行。')
  }
  const data = await response.json() as Payload
  if (!Array.isArray(data.rows) || !Array.isArray(data.funds) || !Array.isArray(data.checked)) throw new Error('数据库接口返回的数据格式不正确')
  return { data, etag: response.headers.get('ETag') }
}

import { Hono } from 'hono'
import type { AmvSyncService } from '../services/amvSyncService.ts'

export function amvRoutes(sync: AmvSyncService) {
  return new Hono().post('/amv/sync', async c => {
    const body: unknown = await c.req.json().catch(() => null)
    const day = body && typeof body === 'object' && 'day' in body ? body.day : null
    if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)
      || !Number.isFinite(Date.parse(day)) || new Date(day).toISOString().slice(0, 10) !== day) {
      return c.json({ error: '请提供有效的数据日期' }, 400)
    }
    const result = await sync.ensure(day)
    return c.json(result, result.status === 'invalid' ? 400 : 200)
  })
}

import { Hono } from 'hono'
import type { DashboardService } from '../services/dashboardService.ts'

export function dashboardRoutes(dashboard: DashboardService) {
  return new Hono()
    .get('/dashboard', c => {
      const { payload, etag } = dashboard.read()
      c.header('ETag', etag)
      return c.req.header('If-None-Match') === etag ? c.body(null, 304) : c.json(payload)
    })
    .all('/dashboard', c => {
      c.header('Allow', 'GET')
      return c.json({ error: '只支持读取数据' }, 405)
    })
}

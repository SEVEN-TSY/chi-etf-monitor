import { Hono } from 'hono'
import { createReadDatabase, DatabaseUnavailableError } from './db/connection.ts'
import { createEtfRepository } from './repositories/etfRepository.ts'
import { createDashboardService } from './services/dashboardService.ts'
import { dashboardRoutes } from './routes/dashboard.ts'

export function createApi(databasePath: string) {
  const database = createReadDatabase(databasePath)
  const repository = createEtfRepository(database)
  const dashboard = createDashboardService(repository)
  const app = new Hono()
  app.use('/api/*', async (c, next) => {
    c.header('Cache-Control', 'no-cache')
    await next()
  })
  app.onError((error, c) => {
    if (error instanceof DatabaseUnavailableError) return c.json({ error: error.message }, 503)
    console.error(error)
    return c.json({ error: '读取数据失败，请稍后重试。' }, 500)
  })
  app.notFound(c => c.json({ error: '接口不存在' }, 404))
  return app.route('/api', dashboardRoutes(dashboard))
}

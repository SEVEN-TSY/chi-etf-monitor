import { mkdirSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { resolve } from 'node:path'
import type { Plugin } from 'vite'
import { getRequestListener } from '@hono/node-server'
import { createApi } from './app.ts'

export function dashboardApi(databasePath: string) {
  const listener = getRequestListener(createApi(databasePath).fetch)
  return (request: IncomingMessage, response: ServerResponse, next: () => void) => {
    const path = request.url?.split('?')[0]
    if (!path?.startsWith('/api/')) { next(); return }
    void listener(request, response)
  }
}

export function localDashboard(databasePath: string, dist: string): Plugin {
  const api = dashboardApi(databasePath)
  return {
    name: 'local-sqlite-dashboard',
    configureServer(server) { server.middlewares.use(api) },
    configurePreviewServer(server) { server.middlewares.use(api) },
    closeBundle() {
      mkdirSync(dist, { recursive: true })
      writeFileSync(resolve(dist, 'index.html'), `<!doctype html>
<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>ETF份额监控</title><link rel="stylesheet" href="/dashboard.css"></head><body><div id="etf-app"></div><script src="/dashboard.js"></script></body></html>`, 'utf8')
    },
  }
}

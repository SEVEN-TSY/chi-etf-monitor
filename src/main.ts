import { createApp } from 'vue'
import App from './App.vue'
import DashboardPage from './DashboardPage.vue'
import type { Payload } from './domain/types'
import './style.css'

function boot() {
  const root = document.getElementById('etf-app')
  if (!root) return
  try {
    const embedded = document.getElementById('etf-dashboard-data')?.textContent
    if (embedded) {
      const data = JSON.parse(embedded) as Payload
      if (!Array.isArray(data.rows) || !Array.isArray(data.funds) || !Array.isArray(data.checked)) throw new Error('数据格式不正确')
      createApp(App, { data }).mount(root)
    } else if (location.protocol === 'file:') {
      throw new Error('请在frontend目录运行npm run dev，并打开终端显示的本地地址读取数据库。')
    } else createApp(DashboardPage).mount(root)
  } catch (error) {
    root.setAttribute('role', 'alert')
    root.textContent = error instanceof Error ? error.message : '页面加载失败'
  }
}
boot()

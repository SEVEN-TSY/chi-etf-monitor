import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import type { EtfRepository } from '../repositories/etfRepository.ts'
import { amvDates } from '../../src/domain/amv.ts'

const execute = promisify(execFile)
export type AmvCollector = (databasePath: string, day: string) => Promise<void>
export interface AmvSyncResult {
  status: 'ready' | 'pending' | 'unavailable' | 'invalid'
  message?: string
  retryAfter?: number
}

export const runAmvCollector: AmvCollector = async (databasePath, day) => {
  const script = fileURLToPath(new URL('../../scripts/amv_sync.py', import.meta.url))
  const args = [script, '--database', databasePath, '--date', day]
  if (process.env.AMV_FETCH_SCRIPT) args.push('--fetch-script', process.env.AMV_FETCH_SCRIPT)
  await execute(process.env.AMV_PYTHON || 'python', args, {
    windowsHide: true, timeout: 25000, maxBuffer: 256 * 1024,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  })
}

export function createAmvSyncService(repository: EtfRepository, databasePath: string,
  collect: AmvCollector = runAmvCollector, clock: () => Date = () => new Date()) {
  const retries = new Map<string, number>()
  let active: { day: string; promise: Promise<AmvSyncResult> } | undefined
  function hasDay(day: string) { return repository.readSnapshot().amv.some(r => r.day === day) }
  return {
    async ensure(day: string): Promise<AmvSyncResult> {
      const snapshot = repository.readSnapshot()
      const now = clock()
      if (day > amvDates(now).latestClosed) {
        return { status: 'pending', message: '待当日收盘后补采', retryAfter: 60 }
      }
      if (snapshot.amv.some(r => r.day === day)) return { status: 'ready' }
      if (active) return active.day === day ? active.promise : { status: 'pending', message: '等待0AMV补采', retryAfter: 10 }
      const retry = retries.get(day) ?? 0
      if (retry > now.getTime()) return { status: 'unavailable', message: '当日数据暂缺，稍后自动重试', retryAfter: Math.ceil((retry - now.getTime()) / 1000) }
      const promise = (async (): Promise<AmvSyncResult> => {
        try {
          await collect(databasePath, day)
          if (hasDay(day)) return { status: 'ready' }
          return { status: 'unavailable', message: '行情尚未返回当日数据，稍后自动重试', retryAfter: 300 }
        } catch {
          return { status: 'unavailable', message: '0AMV补采失败，稍后自动重试', retryAfter: 300 }
        } finally {
          retries.set(day, clock().getTime() + 300000)
          active = undefined
        }
      })()
      active = { day, promise }
      return promise
    },
  }
}
export type AmvSyncService = ReturnType<typeof createAmvSyncService>

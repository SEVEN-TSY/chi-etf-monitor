import type { ReadDatabase } from '../db/connection.ts'

interface ObservationRecord { day: string; code: string; shares: number; status: string }
interface AmvRecord { day: string; change_percent: number }

export function createEtfRepository(database: ReadDatabase) {
  return {
    readSnapshot() {
      return database.snapshot(db => {
        const observations = db.prepare('SELECT day,code,shares,status FROM observations ORDER BY day,code').all() as unknown as ObservationRecord[]
        const checked = db.prepare('SELECT day FROM requests ORDER BY day').all() as { day: string }[]
        const latest = db.prepare('SELECT MAX(fetched_at) AS fetched FROM observations').get() as { fetched: string | null }
        const hasAmv = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='amv_observations'").get()
        const amv = hasAmv ? db.prepare('SELECT day,change_percent FROM amv_observations ORDER BY day').all() as unknown as AmvRecord[] : []
        return { observations, checkedDays: checked.map(r => r.day), fetchedAt: latest.fetched, amv }
      })
    },
  }
}
export type EtfRepository = ReturnType<typeof createEtfRepository>

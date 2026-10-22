import { createHash } from 'node:crypto'
import funds from '../../scripts/funds.json' with { type: 'json' }
import type { Payload } from '../../src/domain/types.ts'
import type { EtfRepository } from '../repositories/etfRepository.ts'

export function createDashboardService(repository: EtfRepository) {
  return {
    read() {
      const snapshot = repository.readSnapshot()
      const payload: Payload = {
        funds, rows: snapshot.observations.map(r => [r.day, r.code, r.shares, r.status]),
        checked: snapshot.checkedDays, fetched: snapshot.fetchedAt,
        amv: snapshot.amv.map(r => [r.day, r.change_percent]),
        generated: new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date()),
      }
      const signature = JSON.stringify({ funds: payload.funds, rows: payload.rows, checked: payload.checked, fetched: payload.fetched, amv: payload.amv })
      const etag = '"' + createHash('sha256').update(signature).digest('hex') + '"'
      return { payload, etag }
    },
  }
}
export type DashboardService = ReturnType<typeof createDashboardService>

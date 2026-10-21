import { DatabaseSync } from 'node:sqlite'

export class DatabaseUnavailableError extends Error {
  constructor(cause: unknown) { super('本地数据库暂不可用，请先完成数据采集。', { cause }) }
}

export function createReadDatabase(path: string) {
  return {
    snapshot<T>(query: (db: DatabaseSync) => T): T {
      let db: DatabaseSync | undefined
      try {
        db = new DatabaseSync(path, { readOnly: true, timeout: 5000 })
        db.exec('BEGIN')
        return query(db)
      } catch (error) { throw new DatabaseUnavailableError(error) }
      finally { db?.close() }
    },
  }
}
export type ReadDatabase = ReturnType<typeof createReadDatabase>

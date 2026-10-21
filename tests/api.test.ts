import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { createApi } from '../local/app.ts'

function fixture(t: TestContext) {
  const folder = mkdtempSync(join(tmpdir(), 'etf-database-test-'))
  const path = join(folder, 'test.sqlite3')
  t.after(() => {
    assert.equal(dirname(resolve(folder)), resolve(tmpdir()))
    assert.ok(folder.split(/[\\/]/).at(-1)!.startsWith('etf-database-test-'))
    rmSync(folder, { recursive: true, force: true })
  })
  const db = new DatabaseSync(path)
  try {
    db.exec(`CREATE TABLE observations(day TEXT,code TEXT,shares INTEGER,status TEXT,fetched_at TEXT);
      CREATE TABLE requests(day TEXT,checked_at TEXT);
      INSERT INTO observations VALUES('2026-10-20','510300',100000000,'清算后','2026-10-21T09:10:00+08:00');
      INSERT INTO requests VALUES('2026-10-20','2026-10-21');`)
  } finally { db.close() }
  return { folder, path, app: createApi(path) }
}

test('查询直接反映已提交的同日数据库修订，未变化时返回304', async t => {
  const { app, path } = fixture(t)
  const initial = await app.request('/api/dashboard')
  assert.equal(initial.status, 200)
  assert.equal((await initial.json()).rows[0][2], 100000000)
  const etag = initial.headers.get('ETag')!
  assert.equal((await app.request('/api/dashboard', { headers: { 'If-None-Match': etag } })).status, 304)
  const writer = new DatabaseSync(path)
  try { writer.exec('UPDATE observations SET shares=200000000') } finally { writer.close() }
  const revised = await app.request('/api/dashboard', { headers: { 'If-None-Match': etag } })
  assert.equal(revised.status, 200)
  assert.notEqual(revised.headers.get('ETag'), etag)
  assert.equal((await revised.json()).rows[0][2], 200000000)
})

test('数据库缺失返回503，查询不会创建数据库', async t => {
  const { folder } = fixture(t)
  const missing = join(folder, 'missing.sqlite3')
  const response = await createApi(missing).request('/api/dashboard')
  assert.equal(response.status, 503)
  assert.ok((await response.json()).error)
  assert.equal(existsSync(missing), false)
})

test('所有接口统一响应格式，拒绝写入方法', async t => {
  const { app } = fixture(t)
  const post = await app.request('/api/dashboard', { method: 'POST' })
  assert.equal(post.status, 405)
  assert.equal(post.headers.get('Allow'), 'GET')
  const unknown = await app.request('/api/unknown')
  assert.equal(unknown.status, 404)
  assert.ok((await unknown.json()).error)
})

test('只更新0AMV也刷新ETag，缺表时ETF仍可读取', async t => {
  const { app, path } = fixture(t)
  const initial = await app.request('/api/dashboard')
  assert.deepEqual((await initial.json()).amv, [])
  const writer = new DatabaseSync(path)
  try {
    writer.exec(`CREATE TABLE amv_observations(day TEXT PRIMARY KEY,change_percent REAL);
      INSERT INTO amv_observations VALUES('2026-10-20',0.36)`)
  } finally { writer.close() }
  const revised = await app.request('/api/dashboard', { headers: { 'If-None-Match': initial.headers.get('ETag')! } })
  assert.equal(revised.status, 200)
  assert.deepEqual((await revised.json()).amv, [['2026-10-20', .36]])
  assert.notEqual(revised.headers.get('ETag'), initial.headers.get('ETag'))
})

test('0AMV补采并发去重、入库可读，命中缓存不执行命令', async t => {
  const { path } = fixture(t)
  let calls = 0
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const app = createApi(path, async (databasePath, day) => {
    calls++
    await gate
    const writer = new DatabaseSync(databasePath)
    try {
      writer.exec('CREATE TABLE amv_observations(day TEXT PRIMARY KEY,change_percent REAL)')
      writer.prepare('INSERT INTO amv_observations VALUES(?,?)').run(day, .36)
    } finally { writer.close() }
  })
  const request = () => app.request('/api/amv/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ day: '2026-10-20' }) })
  const first = request(), second = request()
  await new Promise(resolve => setImmediate(resolve))
  release()
  assert.equal((await (await first).json()).status, 'ready')
  assert.equal((await (await second).json()).status, 'ready')
  assert.equal(calls, 1)
  assert.equal((await (await request()).json()).status, 'ready')
  assert.equal(calls, 1)
  assert.deepEqual((await (await app.request('/api/dashboard')).json()).amv, [['2026-10-20', .36]])
})

test('补采失败保留ETF数据并限频，非法日期不执行采集', async t => {
  const { path } = fixture(t)
  let calls = 0
  const app = createApi(path, async () => { calls++; throw new Error('timeout') })
  const request = (day: string) => app.request('/api/amv/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ day }) })
  assert.equal((await request('2026-02-30')).status, 400)
  assert.equal((await request('2026-10-19')).status, 400)
  assert.equal(calls, 0)
  assert.equal((await (await request('2026-10-20')).json()).status, 'unavailable')
  assert.equal((await (await request('2026-10-20')).json()).status, 'unavailable')
  assert.equal(calls, 1)
  assert.equal((await app.request('/api/dashboard')).status, 200)
})

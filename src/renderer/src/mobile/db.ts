/** 手机端本地文档库：IndexedDB 极简封装（无依赖） */

const DB_NAME = 'fictoimg-mobile'
/** 阶段 50 改名前的库名：新库为空时把旧库草稿搬过来，避免手机端离线稿读不到 */
const LEGACY_DB_NAME = 'longform-mobile'
const STORE = 'docs'
const VERSION = 1

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(name: string): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    let req: IDBOpenDBRequest
    try {
      req = indexedDB.open(name, VERSION)
    } catch {
      return resolve(null)
    }
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => resolve(null)
  })
}

function allIn(db: IDBDatabase): Promise<unknown[]> {
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).getAll()
    req.onsuccess = () => resolve(req.result as unknown[])
    req.onerror = () => resolve([])
  })
}

async function migrateLegacy(db: IDBDatabase): Promise<void> {
  if ((await allIn(db)).length) return
  const names = indexedDB.databases ? await indexedDB.databases().catch(() => null) : null
  if (names && !names.some((n) => n.name === LEGACY_DB_NAME)) return
  const old = await openDb(LEGACY_DB_NAME)
  if (!old) return
  const rows = await allIn(old)
  if (!rows.length) return void old.close()
  const tx = db.transaction(STORE, 'readwrite')
  for (const row of rows) tx.objectStore(STORE).put(row)
  await new Promise<void>((resolve) => {
    tx.oncomplete = () => resolve()
    tx.onabort = () => resolve()
    tx.onerror = () => resolve()
  })
  old.close()
}

function open(): Promise<IDBDatabase> {
  if (!dbPromise) dbPromise = openDb(DB_NAME).then(async (db) => {
    if (!db) throw new Error('IndexedDB 打开失败')
    await migrateLegacy(db)
    return db
  })
  return dbPromise
}

function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode)
        const req = fn(tx.objectStore(STORE))
        req.onsuccess = () => resolve(req.result as T)
        req.onerror = () => reject(req.error ?? new Error('IndexedDB 操作失败'))
      })
  )
}

export function dbAll<T>(): Promise<T[]> {
  return run<T[]>('readonly', (s) => s.getAll())
}

export function dbPut(value: unknown): Promise<unknown> {
  return run('readwrite', (s) => s.put(value))
}

export function dbDelete(id: string): Promise<unknown> {
  return run('readwrite', (s) => s.delete(id))
}

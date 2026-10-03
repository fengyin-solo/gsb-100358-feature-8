import { SEED_QUEUES, SEED_ROWS } from './seed'
import type { EntryRow, PrepQueue } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'hydrology-monitor-station:entries'
// 准备队列单独存一份：它按 日期+管理单位 归集，不属于任何一个业务模块的条目表。
const QUEUE_STORAGE_KEY = 'hydrology-monitor-station:prep-queues'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    return { ...fallback, ...parsed }
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}

function readQueueStorage(): PrepQueue[] {
  const fallback = clone(SEED_QUEUES)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(QUEUE_STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    return JSON.parse(raw) as PrepQueue[]
  } catch {
    window.localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let queueCache: PrepQueue[] | null = null

export function listQueues(): PrepQueue[] {
  if (queueCache === null) {
    queueCache = readQueueStorage()
  }
  return queueCache
}

export function saveQueues(queues: PrepQueue[]): void {
  queueCache = queues
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(queues))
  }
}

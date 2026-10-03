import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listQueues, listRows, resetRows, saveQueues, saveRows } from '@/data/local-store'
import type {
  ActionResult,
  EntryRow,
  ModuleMeta,
  OperatorContext,
  OverviewResult,
  PageResult,
  PrepQueue,
  PrepQueueBuild,
  PrepQueueItem,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

// 筛选条件与最近维护记录冲突时的取舍：准备队列以最近维护记录为准。
// 近 30 天内有维护记录的设备即使命中筛选条件也不入队——刚维护过的设备重复派工，
// 还会在通讯系统里重复生成更换工单。被剔除的设备会在页面上列明原因。
const RECENT_MAINTENANCE_DAYS = 30

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function runAction(
  key: string,
  id: number,
  action: string,
  context?: OperatorContext,
): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  // 通讯更换工单不只有准备队列一个入口：通讯系统页「申请更换」也要同步把工单戳齐。
  if (key === 'communication' && target === '待更换') {
    stampReplacementOrder(updated, context?.operator ?? '值班管理员')
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

function dayLabel(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

function nowLabel(): string {
  const now = new Date()
  const hour = String(now.getHours()).padStart(2, '0')
  const minute = String(now.getMinutes()).padStart(2, '0')
  return `${dayLabel(now)} ${hour}:${minute}`
}

function parseDay(value: string): number | null {
  const time = Date.parse(value)
  return Number.isNaN(time) ? null : time
}

// 站点默认通讯方式：旧设备没登记通讯方式时，建队沿用所属站点的默认值。
function stationDefaultComm(stationName: string): string {
  const station = listRows('station').find(
    (row) => row['站点名称'] === stationName || row['站点编号'] === stationName,
  )
  const fallback = String(station?.['默认通讯方式'] ?? '').trim()
  return fallback || '未登记'
}

function toQueueItem(row: EntryRow): PrepQueueItem {
  const registered = String(row['通讯方式'] ?? '').trim()
  const station = String(row['所属站点'] ?? '')
  return {
    设备编号: String(row['设备编号'] ?? ''),
    设备类型: String(row['设备类型'] ?? ''),
    所属站点: station,
    通讯方式: registered || stationDefaultComm(station),
    通讯方式来源: registered ? '设备登记' : '站点默认',
    电池余量: String(row['电池余量'] ?? ''),
    最近维护日: String(row['最近维护日'] ?? ''),
  }
}

// 从设备列表的筛选结果建当天准备队列：先按条件取数，再按最近维护记录剔除。
export function buildPrepQueue(filters: Record<string, string> = {}): PrepQueueBuild {
  const matched = filterRows(listRows('telemetry'), filters)
  const today = parseDay(dayLabel(new Date())) ?? Date.now()
  const windowMs = RECENT_MAINTENANCE_DAYS * 24 * 60 * 60 * 1000
  const candidates: PrepQueueItem[] = []
  const excluded: { item: PrepQueueItem; 原因: string }[] = []
  for (const row of matched) {
    const item = toQueueItem(row)
    const maintainedAt = parseDay(item.最近维护日)
    if (maintainedAt !== null && today - maintainedAt >= 0 && today - maintainedAt < windowMs) {
      excluded.push({
        item,
        原因: `近${RECENT_MAINTENANCE_DAYS}天内已维护（${item.最近维护日}），按最近维护记录不入队`,
      })
    } else {
      candidates.push(item)
    }
  }
  return { candidates, excluded }
}

function nextCommCode(rows: EntryRow[]): string {
  const max = rows.reduce((acc, row) => {
    const match = /^COMM-(\d+)$/.exec(String(row['设备编号'] ?? ''))
    return match ? Math.max(acc, Number(match[1])) : acc
  }, 0)
  return `COMM-${String(max + 1).padStart(4, '0')}`
}

// 通讯更换工单的唯一生成点：准备队列保存、通讯系统页「申请更换」都走这条链路，
// 同一台关联设备已有「待更换」工单时不再重单。
function syncReplacementOrders(items: PrepQueueItem[], operator: string): number {
  const rows = listRows('communication')
  const openOrders = new Set(
    rows
      .filter((row) => row.status === '待更换')
      .map((row) => String(row['关联设备'] ?? '')),
  )
  const additions: EntryRow[] = []
  let nextId = rows.reduce((acc, row) => Math.max(acc, Number(row.id) || 0), 0)
  for (const item of items) {
    if (!item.设备编号 || openOrders.has(item.设备编号)) {
      continue
    }
    nextId += 1
    additions.push({
      id: nextId,
      status: '待更换',
      pending: true,
      abnormal: false,
      设备编号: nextCommCode([...rows, ...additions]),
      设备类型: '通讯终端',
      所属站点: item.所属站点,
      通讯协议: item.通讯方式,
      信号强度: '—',
      最近通讯时刻: nowLabel(),
      维护人员: operator,
      工单来源: '遥测准备队列',
      关联设备: item.设备编号,
      设备状态: '待更换',
    })
    openOrders.add(item.设备编号)
  }
  if (additions.length > 0) {
    saveRows('communication', [...rows, ...additions])
  }
  return additions.length
}

// 把通讯设备行补成一张完整更换工单：来源、时刻、维护人员一次戳齐（其它入口同步创建）。
function stampReplacementOrder(row: EntryRow, operator: string): void {
  const source = String(row['工单来源'] ?? '').trim()
  if (!source || source === '例行登记') {
    row['工单来源'] = '通讯系统页申请'
  }
  row['最近通讯时刻'] = nowLabel()
  row['维护人员'] = operator
  row['设备状态'] = '待更换'
}

// 保存当天准备队列：按 日期+管理单位 归集，同一天重复保存覆盖旧队列；
// 保存的同时把通讯系统的更换工单同步生成出来。
export function savePrepQueue(
  items: PrepQueueItem[],
  context: OperatorContext,
): ActionResult & { queue?: PrepQueue } {
  if (items.length === 0) {
    return { ok: false, message: '准备队列是空的，先按筛选条件建队' }
  }
  const date = dayLabel(new Date())
  const queues = listQueues()
  const existing = queues.find(
    (queue) => queue.日期 === date && queue.管理单位 === context.unit,
  )
  const synced = syncReplacementOrders(items, context.operator)
  const queue: PrepQueue = {
    id: existing?.id ?? `QUE-${date.replace(/-/g, '')}-${context.unit}`,
    日期: date,
    管理单位: context.unit,
    创建人: context.operator,
    items: items.map((item) => ({ ...item })),
    同步工单数: synced,
    savedAt: nowLabel(),
  }
  const next = existing
    ? queues.map((item) => (item.id === queue.id ? queue : item))
    : [...queues, queue]
  saveQueues(next)
  return {
    ok: true,
    message: `准备队列已保存（${items.length} 台设备），同步生成 ${synced} 张通讯更换工单`,
    queue,
  }
}

export function listPrepQueues(): PrepQueue[] {
  return [...listQueues()].sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1))
}

// 维护员不能改外单位队列：改动前先看队列归属的管理单位。
export function removePrepQueueItem(
  queueId: string,
  deviceCode: string,
  context: OperatorContext,
): ActionResult {
  const queues = listQueues()
  const queue = queues.find((item) => item.id === queueId)
  if (!queue) {
    return { ok: false, message: '没有找到这条准备队列' }
  }
  if (queue.管理单位 !== context.unit) {
    return { ok: false, message: `该队列归${queue.管理单位}所有，维护员不能改外单位队列` }
  }
  const next = queues.map((item) =>
    item.id === queueId
      ? { ...item, items: item.items.filter((entry) => entry.设备编号 !== deviceCode) }
      : item,
  )
  saveQueues(next)
  return { ok: true, message: `已把 ${deviceCode} 从准备队列移除` }
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}

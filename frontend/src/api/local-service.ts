import { MODULE_BY_KEY } from '@/data/modules'
import {
  allRows,
  listRows,
  loadDocument,
  persistDocument,
  resetRows,
  saveRows,
} from '@/data/local-store'
import { NETWORK_DEFAULT_COMM, STATION_DEFAULT_COMM } from '@/data/station-comm'
import { SEED_QUEUES, SEED_REPLACEMENT_ORDERS } from '@/data/queue-seed'
import type {
  ActionResult,
  EntryRow,
  MaintenanceQueue,
  MaintenanceQueueItem,
  ModuleMeta,
  OverviewResult,
  PageResult,
  ReplacementOrder,
} from '@/data/types'

// 维护准备队列、通讯更换工单的本地存储键
const QUEUE_STORAGE_KEY = 'hydrology-monitor-station:maintenance-queues'
const ORDER_STORAGE_KEY = 'hydrology-monitor-station:replacement-orders'
// 遥测设备页上次筛选条件，返回页面时恢复
const TELEMETRY_FILTER_KEY = 'hydrology-monitor-station:telemetry-filters'
// 与最近维护记录的冲突窗口：近 7 天维护过的设备被选入队列时给出提示
const RECENT_MAINTENANCE_DAYS = 7
// 仅该状态的设备入列时需要同步通讯系统更换工单
const REPLACEMENT_DEVICE_STATUS = '信号异常'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

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

export function runAction(key: string, id: number, action: string): ActionResult {
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
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
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

// ---------------------------------------------------------------------------
// 遥测设备：筛选条件 → 设备列表 → 站点默认通讯方式 → 最近维护记录 → 当天准备队列
// ---------------------------------------------------------------------------

export type TelemetryFilters = {
  station: string
  deviceType: string
  commMethod: string
  /** 电池余量上限（百分比），只筛余量不高于该值的设备 */
  batteryMax: string
}

export type TelemetryDeviceView = {
  id: number
  deviceCode: string
  deviceType: string
  stationCode: string
  stationName: string
  /** 生效通讯方式：设备自身值优先，缺省沿用站点默认值 */
  commMethod: string
  commInherited: boolean
  installDate: string
  /** 设备登记维护日与站房维护记录取较新者 */
  lastMaintenance: string
  maintenanceNote: string
  batteryText: string
  battery: number | null
  status: string
  /** 近 7 天内有维护记录，与当天准备队列冲突（以筛选为准，仅提示） */
  recentlyMaintained: boolean
  /** 信号异常设备入列即需同步通讯系统更换工单 */
  needsReplacement: boolean
}

export type Operator = { name: string; unit: string }

const EMPTY_TELEMETRY_FILTERS: TelemetryFilters = {
  station: '',
  deviceType: '',
  commMethod: '',
  batteryMax: '',
}

function parsePercent(value: unknown): number | null {
  const match = /(\d+(?:\.\d+)?)/.exec(String(value ?? ''))
  return match ? Number(match[1]) : null
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

function todayText(): string {
  const now = new Date()
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`
}

function nowText(): string {
  const now = new Date()
  return `${todayText()} ${pad2(now.getHours())}:${pad2(now.getMinutes())}`
}

function daysBetween(from: string, to: string): number | null {
  const a = new Date(`${from}T00:00:00`)
  const b = new Date(`${to}T00:00:00`)
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) {
    return null
  }
  return Math.round((b.getTime() - a.getTime()) / 86_400_000)
}

/** 所属站点允许填站点编号或站点名称，两种写法都能定位到站点 */
function resolveStation(ref: string): { code: string; name: string } {
  let code = ref
  let name = ref
  for (const row of listRows('station')) {
    if (String(row['站点编号']) === ref) {
      code = ref
      name = String(row['站点名称'])
      break
    }
    if (String(row['站点名称']) === ref) {
      code = String(row['站点编号'])
      name = ref
      break
    }
  }
  return { code, name }
}

/** 顺着设备 → 站点 → 站房维护记录的现有取数链路解析最近维护记录 */
function resolveMaintenance(device: EntryRow, stationCode: string): { date: string; note: string } {
  const ownDate = String(device['最近维护日'] ?? '').trim()
  const records = listRows('stationhouse')
    .filter((row) => String(row['站点编号'] ?? '') === stationCode)
    .sort((a, b) => String(b['维护日期'] ?? '').localeCompare(String(a['维护日期'] ?? '')))
  const record = records[0]
  const recordDate = record ? String(record['维护日期'] ?? '') : ''
  let date = ownDate
  if (recordDate && (!date || recordDate > date)) {
    date = recordDate
  }
  const note = record
    ? `站房维护记录 ${recordDate}《${record['维护内容'] ?? ''}》（${record['维护单位'] ?? ''}）`
    : '无站房维护记录，沿用设备登记维护日'
  return { date, note }
}

function toDeviceView(row: EntryRow): TelemetryDeviceView {
  const { code, name } = resolveStation(String(row['所属站点'] ?? ''))
  const rawComm = String(row['通讯方式'] ?? '').trim()
  const commInherited = rawComm === ''
  // 旧设备缺少通讯方式时沿用站点默认值，站点也没配时走全网默认值
  const commMethod = rawComm !== '' ? rawComm : STATION_DEFAULT_COMM[code] ?? NETWORK_DEFAULT_COMM
  const maintenance = resolveMaintenance(row, code)
  const battery = parsePercent(row['电池余量'])
  const status = String(row.status ?? '')
  const since = daysBetween(maintenance.date, todayText())
  const recentlyMaintained = since !== null && since >= 0 && since <= RECENT_MAINTENANCE_DAYS
  return {
    id: Number(row.id),
    deviceCode: String(row['设备编号'] ?? ''),
    deviceType: String(row['设备类型'] ?? ''),
    stationCode: code,
    stationName: name,
    commMethod,
    commInherited,
    installDate: String(row['安装日期'] ?? ''),
    lastMaintenance: maintenance.date,
    maintenanceNote: maintenance.note,
    batteryText: String(row['电池余量'] ?? ''),
    battery,
    status,
    recentlyMaintained,
    needsReplacement: status === REPLACEMENT_DEVICE_STATUS,
  }
}

export function listTelemetry(filters: TelemetryFilters): TelemetryDeviceView[] {
  const station = filters.station.trim()
  const deviceType = filters.deviceType.trim()
  const commMethod = filters.commMethod.trim()
  const batteryMax = parsePercent(filters.batteryMax)
  return listRows('telemetry')
    .map(toDeviceView)
    .filter((view) => {
      if (station && !`${view.stationName}${view.stationCode}`.includes(station)) {
        return false
      }
      if (deviceType && !view.deviceType.includes(deviceType)) {
        return false
      }
      // 按生效通讯方式筛选：旧设备继承站点默认值后也能被命中
      if (commMethod && !view.commMethod.includes(commMethod)) {
        return false
      }
      if (batteryMax !== null && (view.battery === null || view.battery > batteryMax)) {
        return false
      }
      return true
    })
}

export function loadTelemetryFilters(): TelemetryFilters {
  return loadDocument(TELEMETRY_FILTER_KEY, { ...EMPTY_TELEMETRY_FILTERS })
}

export function saveTelemetryFilters(filters: TelemetryFilters): void {
  persistDocument(TELEMETRY_FILTER_KEY, filters)
}

export function clearTelemetryFilters(): TelemetryFilters {
  persistDocument(TELEMETRY_FILTER_KEY, { ...EMPTY_TELEMETRY_FILTERS })
  return { ...EMPTY_TELEMETRY_FILTERS }
}

// ---------------------------------------------------------------------------
// 当天维护准备队列：按归属单位隔离，外单位队列只读；保存即同步通讯更换工单
// ---------------------------------------------------------------------------

function loadQueues(): MaintenanceQueue[] {
  return loadDocument<MaintenanceQueue[]>(QUEUE_STORAGE_KEY, SEED_QUEUES)
}

function saveQueues(queues: MaintenanceQueue[]): void {
  persistDocument(QUEUE_STORAGE_KEY, queues)
}

function loadOrders(): ReplacementOrder[] {
  return loadDocument<ReplacementOrder[]>(ORDER_STORAGE_KEY, SEED_REPLACEMENT_ORDERS)
}

function saveOrders(orders: ReplacementOrder[]): void {
  persistDocument(ORDER_STORAGE_KEY, orders)
}

function nextId(rows: { id: number }[]): number {
  return rows.reduce((max, row) => Math.max(max, row.id), 0) + 1
}

const ACTIVE_ORDER_STATUS = ['待派单', '已派单', '处理中']

function ensureReplacementOrder(
  orders: ReplacementOrder[],
  draft: Omit<ReplacementOrder, 'id' | 'orderNo' | 'status' | 'createdAt'>,
): boolean {
  // 同一设备已有在途更换工单则不重复生成（任意入口都共用这条幂等规则）
  const exists = orders.some(
    (order) => order.deviceCode === draft.deviceCode && ACTIVE_ORDER_STATUS.includes(order.status),
  )
  if (exists) {
    return false
  }
  const dayKey = todayText().replace(/-/g, '')
  const seq = orders.filter((order) => order.orderNo.includes(dayKey)).length + 1
  orders.push({
    ...draft,
    id: nextId(orders),
    orderNo: `CMRO-${dayKey}-${pad2(seq)}`,
    status: '待派单',
    createdAt: nowText(),
  })
  return true
}

export function listMaintenanceQueues(): MaintenanceQueue[] {
  return loadQueues().sort((a, b) => b.queueDate.localeCompare(a.queueDate))
}

export function getMaintenanceQueue(queueDate: string): MaintenanceQueue | undefined {
  return loadQueues().find((queue) => queue.queueDate === queueDate)
}

/** 把筛选结果设备转成队列条目：信号异常默认勾选更换工单，近 7 天维护默认带冲突提示 */
export function toQueueItem(view: TelemetryDeviceView): MaintenanceQueueItem {
  return {
    deviceId: view.id,
    deviceCode: view.deviceCode,
    deviceType: view.deviceType,
    station: view.stationName,
    commMethod: view.commMethod,
    battery: view.batteryText,
    status: view.status,
    recentlyMaintained: view.recentlyMaintained,
    maintenanceNote: view.lastMaintenance
      ? `最近维护 ${view.lastMaintenance}；${view.maintenanceNote}`
      : view.maintenanceNote,
    createReplacement: view.needsReplacement,
  }
}

export type QueueSaveResult = {
  ok: boolean
  message: string
  orderCreated: number
  orderSkipped: number
}

export function saveMaintenanceQueue(
  queueDate: string,
  items: MaintenanceQueueItem[],
  operator: Operator,
): QueueSaveResult {
  if (items.length === 0) {
    return { ok: false, message: '准备队列为空，请先从筛选结果勾选设备', orderCreated: 0, orderSkipped: 0 }
  }
  const queues = loadQueues()
  const existing = queues.find((queue) => queue.queueDate === queueDate)
  // 维护员不能改外单位队列：外单位已建的当天队列直接拒绝保存
  if (existing && existing.ownerUnit !== operator.unit) {
    return {
      ok: false,
      message: `${queueDate} 的准备队列归属「${existing.ownerUnit}」，本单位维护员不能修改外单位队列`,
      orderCreated: 0,
      orderSkipped: 0,
    }
  }

  const queue: MaintenanceQueue = existing
    ? { ...existing, items, createdBy: operator.name, createdAt: nowText() }
    : {
        id: nextId(queues),
        queueDate,
        ownerUnit: operator.unit,
        createdBy: operator.name,
        createdAt: nowText(),
        items,
      }
  if (existing) {
    const index = queues.findIndex((item) => item.id === existing.id)
    queues[index] = queue
  } else {
    queues.push(queue)
  }
  saveQueues(queues)

  // 队列保存后，勾选更换的设备同步生成通讯系统更换工单
  const orders = loadOrders()
  let orderCreated = 0
  let orderSkipped = 0
  for (const item of items.filter((entry) => entry.createReplacement)) {
    const created = ensureReplacementOrder(orders, {
      station: item.station,
      deviceCode: item.deviceCode,
      deviceType: item.deviceType,
      reason: `维护准备队列同步：设备状态「${item.status}」，通讯模块需更换`,
      source: 'telemetry-queue',
      sourceRef: `${queueDate} 维护准备队列`,
      ownerUnit: operator.unit,
    })
    if (created) {
      orderCreated += 1
    } else {
      orderSkipped += 1
    }
  }
  saveOrders(orders)

  return {
    ok: true,
    message: `当天准备队列已保存（${items.length} 台），同步生成更换工单 ${orderCreated} 张`
      + (orderSkipped > 0 ? `，${orderSkipped} 台已有在途工单未重复生成` : ''),
    orderCreated,
    orderSkipped,
  }
}

export function listReplacementOrders(): ReplacementOrder[] {
  return loadOrders().sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/**
 * 通讯系统页动作入口：动作落库后，「申请更换」同步创建更换工单。
 * 维护准备队列保存走同一个 ensureReplacementOrder 幂等规则，保证所有入口同步一致。
 */
export function applyCommunicationAction(
  id: number,
  action: string,
  operator: Operator,
): ActionResult & { orderCreated?: number } {
  const result = runAction('communication', id, action)
  if (!result.ok) {
    return result
  }
  if (action !== '申请更换') {
    return result
  }
  const row = listRows('communication').find((entry) => Number(entry.id) === id)
  if (!row) {
    return result
  }
  const orders = loadOrders()
  const created = ensureReplacementOrder(orders, {
    station: String(row['所属站点'] ?? ''),
    deviceCode: String(row['设备编号'] ?? ''),
    deviceType: String(row['设备类型'] ?? ''),
    reason: '通讯系统申请更换：设备状态已置为「待更换」',
    source: 'communication',
    sourceRef: `通讯设备 ${String(row['设备编号'] ?? '')}`,
    ownerUnit: operator.unit,
  })
  saveOrders(orders)
  return {
    ok: true,
    orderCreated: created ? 1 : 0,
    message: created
      ? `${result.message}，通讯更换工单已同步生成`
      : `${result.message}，该设备已有在途更换工单，未重复生成`,
  }
}

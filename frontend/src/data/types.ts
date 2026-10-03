/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}

/** 当天维护准备队列中的单台设备快照 */
export type MaintenanceQueueItem = {
  deviceId: number
  deviceCode: string
  deviceType: string
  station: string
  commMethod: string
  battery: string
  status: string
  /** 与最近维护记录冲突：近 7 天内维护过仍被筛选入列（以筛选为准，仅提示） */
  recentlyMaintained: boolean
  maintenanceNote: string
  /** 保存队列时是否同步生成通讯系统更换工单 */
  createReplacement: boolean
}

/** 遥测设备维护准备队列，按归属单位隔离，外单位队列只读 */
export type MaintenanceQueue = {
  id: number
  queueDate: string
  ownerUnit: string
  createdBy: string
  createdAt: string
  items: MaintenanceQueueItem[]
}

/** 通讯系统更换工单：准备队列保存、通讯系统申请更换都会同步生成 */
export type ReplacementOrder = {
  id: number
  orderNo: string
  station: string
  deviceCode: string
  deviceType: string
  reason: string
  /** 来源入口：telemetry-queue（维护准备队列）/ communication（通讯系统页） */
  source: string
  sourceRef: string
  ownerUnit: string
  status: string
  createdAt: string
}

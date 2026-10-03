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

/** 准备队列条目：从遥测设备筛选结果生成，通讯方式缺失时已按站点默认值补齐。 */
export type PrepQueueItem = {
  设备编号: string
  设备类型: string
  所属站点: string
  通讯方式: string
  通讯方式来源: string
  电池余量: string
  最近维护日: string
}

/** 当天准备队列：按 日期+管理单位 唯一，保存时同步生成通讯系统更换工单。 */
export type PrepQueue = {
  id: string
  日期: string
  管理单位: string
  创建人: string
  items: PrepQueueItem[]
  同步工单数: number
  savedAt: string
}

/** 建队结果：候选设备 + 因最近维护记录被剔除的设备（维护记录优先，附原因）。 */
export type PrepQueueBuild = {
  candidates: PrepQueueItem[]
  excluded: { item: PrepQueueItem; 原因: string }[]
}

/** 操作上下文：页面传入当前值班员与所属单位，用于队列归属校验与工单落款。 */
export type OperatorContext = {
  operator: string
  unit: string
}

import type { MaintenanceQueue, ReplacementOrder } from './types'

// 文档类种子：只在本地没有对应存储时播种，之后以浏览器里的改动为准。
export const SEED_QUEUES: MaintenanceQueue[] = [
  {
    id: 1,
    queueDate: '2026-10-02',
    ownerUnit: '邻市水文勘测队',
    createdBy: '外协维护员',
    createdAt: '2026-10-02 08:40',
    items: [
      {
        deviceId: 4,
        deviceCode: 'TELE-0004',
        deviceType: '一体化闸控终端',
        station: '东港闸坝站',
        commMethod: '4G',
        battery: '91%',
        status: '正常运行',
        recentlyMaintained: true,
        maintenanceNote: '站房维护记录 2026-09-29《闸控终端年度保养》',
        createReplacement: false,
      },
    ],
  },
]

export const SEED_REPLACEMENT_ORDERS: ReplacementOrder[] = [
  {
    id: 1,
    orderNo: 'CMRO-20261002-001',
    station: '东港闸坝站',
    deviceCode: 'TELE-0004',
    deviceType: '一体化闸控终端',
    reason: '维护准备队列同步：设备通讯状态异常需更换通讯模块',
    source: 'telemetry-queue',
    sourceRef: '2026-10-02 维护准备队列',
    ownerUnit: '邻市水文勘测队',
    status: '待派单',
    createdAt: '2026-10-02 08:40',
  },
]

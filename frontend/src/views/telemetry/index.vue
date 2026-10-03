<template>
  <section class="page" data-module="telemetry">
    <header class="page-head">
      <div>
        <h2>遥测设备管理</h2>
        <p class="page-desc">值班员先按所属站点、设备类型、通讯方式、电池余量筛选设备，再从筛选结果建立当天维护准备队列。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记遥测设备</button>
        <button class="btn" type="button" @click="exportRows">导出遥测设备清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label class="filter-item">
        <span>所属站点</span>
        <input v-model="filters.station" placeholder="站点名称或编号" list="station-options" />
        <datalist id="station-options">
          <option v-for="station in stationOptions" :key="station" :value="station" />
        </datalist>
      </label>
      <label class="filter-item">
        <span>设备类型</span>
        <input v-model="filters.deviceType" placeholder="按设备类型检索" list="type-options" />
        <datalist id="type-options">
          <option v-for="type in typeOptions" :key="type" :value="type" />
        </datalist>
      </label>
      <label class="filter-item">
        <span>通讯方式</span>
        <input v-model="filters.commMethod" placeholder="按通讯方式检索" list="comm-options" />
        <datalist id="comm-options">
          <option v-for="comm in commOptions" :key="comm" :value="comm" />
        </datalist>
      </label>
      <label class="filter-item">
        <span>电池余量 ≤</span>
        <input v-model="filters.batteryMax" placeholder="如 30 表示余量不高于30%" inputmode="numeric" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <div class="queue-toolbar">
      <button class="btn primary" type="button" :disabled="!rows.length" @click="startBuild">
        从筛选结果建立当天准备队列
      </button>
      <span v-if="todayQueue && !queueEditing" class="queue-hint">
        当天准备队列已存在（{{ todayQueue.ownerUnit }} · {{ todayQueue.items.length }} 台）
        <button v-if="canEditToday" class="link" type="button" @click="editExisting">查看/调整</button>
      </span>
      <span v-else-if="todayQueue && !canEditToday" class="queue-hint warn">
        当天队列归属外单位「{{ todayQueue.ownerUnit }}」，本单位维护员只能查看
      </span>
      <span class="rule-note">规则：筛选条件与最近维护记录冲突时以筛选条件为准，冲突仅提示不剔除</span>
    </div>

    <div v-if="queueEditing" class="queue-panel">
      <header class="queue-panel-head">
        <div>
          <h3>当天维护准备队列（{{ today }}）</h3>
          <p class="page-desc">
            归属单位：{{ store.unit }}；勾选「更换工单」的设备保存后同步生成通讯系统更换工单
          </p>
        </div>
        <div class="queue-panel-actions">
          <button class="btn" type="button" @click="selectAllRows">全选筛选结果</button>
          <button class="btn ghost" type="button" @click="cancelBuild">取消</button>
          <button class="btn primary" type="button" @click="saveQueue">保存队列并同步工单</button>
        </div>
      </header>

      <p v-if="conflictCount" class="conflict-banner">
        有 {{ conflictCount }} 台设备近 7 天有维护记录，与当天准备冲突；按既定口径以筛选条件为准，仍保留在队列中并提示维护员复核。
      </p>

      <table class="data-table queue-table">
        <thead>
          <tr>
            <th>入列</th>
            <th>设备编号</th>
            <th>设备类型</th>
            <th>所属站点</th>
            <th>生效通讯方式</th>
            <th>电池余量</th>
            <th>设备状态</th>
            <th>最近维护记录</th>
            <th>更换工单</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="candidate in queueCandidates" :key="candidate.deviceId">
            <td><input type="checkbox" v-model="selectedIds" :value="candidate.deviceId" /></td>
            <td>{{ candidate.deviceCode }}</td>
            <td>{{ candidate.deviceType }}</td>
            <td>{{ candidate.station }}</td>
            <td>
              {{ candidate.commMethod }}
              <span v-if="candidateCommInherited(candidate)" class="tag">站点默认</span>
            </td>
            <td>{{ candidate.battery }}</td>
            <td>{{ candidate.status }}</td>
            <td>
              <div>{{ candidateMaintenanceDate(candidate) }}</div>
              <div v-if="candidate.recentlyMaintained" class="warn-text">近7天维护过，与当天准备冲突</div>
              <div v-else class="muted-text">{{ candidate.maintenanceNote }}</div>
            </td>
            <td>
              <input
                type="checkbox"
                v-model="replacementIds"
                :value="candidate.deviceId"
                :disabled="!selectedIds.includes(candidate.deviceId)"
              />
            </td>
          </tr>
        </tbody>
      </table>
      <footer class="queue-panel-foot">
        <span>已选 {{ selectedIds.length }} 台 · 需同步更换工单 {{ replacementCount }} 张</span>
        <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
        <span v-else-if="successMessage" class="success-text">{{ successMessage }}</span>
      </footer>
    </div>

    <div v-else-if="todayQueue && !canEditToday" class="queue-panel readonly">
      <header class="queue-panel-head">
        <div>
          <h3>当天维护准备队列（外单位 · 只读）</h3>
          <p class="page-desc">归属单位：{{ todayQueue.ownerUnit }}；建单人：{{ todayQueue.createdBy }}</p>
        </div>
      </header>
      <table class="data-table queue-table">
        <thead>
          <tr>
            <th>设备编号</th><th>设备类型</th><th>所属站点</th><th>通讯方式</th>
            <th>电池余量</th><th>设备状态</th><th>最近维护记录</th><th>更换工单</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in todayQueue.items" :key="item.deviceId">
            <td>{{ item.deviceCode }}</td>
            <td>{{ item.deviceType }}</td>
            <td>{{ item.station }}</td>
            <td>{{ item.commMethod }}</td>
            <td>{{ item.battery }}</td>
            <td>{{ item.status }}</td>
            <td>
              <div>{{ maintenanceDateOf(item.maintenanceNote) }}</div>
              <div v-if="item.recentlyMaintained" class="warn-text">近7天维护过</div>
            </td>
            <td>{{ item.createReplacement ? '已同步' : '—' }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <table class="data-table">
      <thead>
        <tr>
          <th>设备编号</th>
          <th>设备类型</th>
          <th>所属站点</th>
          <th>通讯方式</th>
          <th>安装日期</th>
          <th>最近维护日</th>
          <th>电池余量</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row.id">
          <td>{{ row.deviceCode }}</td>
          <td>{{ row.deviceType }}</td>
          <td>{{ row.stationName }}</td>
          <td>
            {{ row.commMethod }}
            <span v-if="row.commInherited" class="tag">站点默认</span>
          </td>
          <td>{{ row.installDate }}</td>
          <td>
            <div>{{ row.lastMaintenance || '—' }}</div>
            <div v-if="row.recentlyMaintained" class="warn-text">近7天维护过</div>
          </td>
          <td>{{ row.batteryText }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="9" class="empty-state">没有符合筛选条件的遥测设备，调整条件后再查询</td>
        </tr>
      </tbody>
    </table>

    <section v-if="historyQueues.length" class="queue-history">
      <h3>维护准备队列记录</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>队列日期</th><th>归属单位</th><th>建单人</th><th>设备数</th>
            <th>更换工单</th><th>保存时间</th><th>权限</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="queue in historyQueues" :key="queue.id">
            <td>{{ queue.queueDate }}</td>
            <td>{{ queue.ownerUnit }}</td>
            <td>{{ queue.createdBy }}</td>
            <td>{{ queue.items.length }}</td>
            <td>{{ queue.items.filter((item) => item.createReplacement).length }}</td>
            <td>{{ queue.createdAt }}</td>
            <td>{{ queue.ownerUnit === store.unit ? '本单位' : '外单位（只读）' }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <footer class="page-foot">
      <span>共 {{ rows.length }} 台符合筛选条件的遥测设备（筛选条件已记住，返回页面自动恢复）</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  clearTelemetryFilters,
  downloadEntries,
  listMaintenanceQueues,
  listTelemetry,
  loadTelemetryFilters,
  moduleMeta,
  runAction as applyAction,
  saveMaintenanceQueue,
  saveTelemetryFilters,
  toQueueItem,
} from '@/api/local-service'
import type {
  MaintenanceQueue,
  MaintenanceQueueItem,
} from '@/data/types'
import type { TelemetryDeviceView, TelemetryFilters } from '@/api/local-service'
import { useSessionStore } from '@/stores/session'

const store = useSessionStore()
const meta = moduleMeta('telemetry')
const actions = ['报修设备', '确认修复', '停用设备']
const statuses = ['正常运行', '信号异常', '低电量', '待维修', '已停用']

function dateText(): string {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

const rows = ref<TelemetryDeviceView[]>([])
const errorMessage = ref('')
const successMessage = ref('')
// 返回页面时恢复上次筛选
const filters = ref<TelemetryFilters>({ ...loadTelemetryFilters() })

const queueEditing = ref(false)
const queueCandidates = ref<MaintenanceQueueItem[]>([])
const selectedIds = ref<number[]>([])
const replacementIds = ref<number[]>([])
const todayQueue = ref<MaintenanceQueue | undefined>()
const historyQueues = ref<MaintenanceQueue[]>([])

const today = dateText()
const canEditToday = computed(() => todayQueue.value?.ownerUnit === store.unit)

const stats = computed(() => {
  const all = listTelemetry({ station: '', deviceType: '', commMethod: '', batteryMax: '' })
  return [
    { label: '设备总数', value: all.length },
    { label: '正常运行数', value: all.filter((row) => row.status === '正常运行').length },
    { label: '待维修数', value: all.filter((row) => row.status === '待维修').length },
  ]
})

const statusSummary = computed(() =>
  statuses.map((status) => ({
    status,
    count: rows.value.filter((row) => row.status === status).length,
  })),
)

const stationOptions = computed(() => [...new Set(rows.value.map((row) => row.stationName))])
const typeOptions = computed(() => [
  ...new Set(listTelemetry({ station: '', deviceType: '', commMethod: '', batteryMax: '' })
    .map((row) => row.deviceType)),
])
const commOptions = computed(() => [...new Set(rows.value.map((row) => row.commMethod))])

const conflictCount = computed(
  () => queueCandidates.value.filter(
    (item) => item.recentlyMaintained && selectedIds.value.includes(item.deviceId),
  ).length,
)
const replacementCount = computed(
  () => replacementIds.value.filter((id) => selectedIds.value.includes(id)).length,
)

function resetFilters() {
  filters.value = clearTelemetryFilters()
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '遥测设备登记入口尚未接入审批流'
}

function runAction(action: string, row: TelemetryDeviceView) {
  errorMessage.value = ''
  successMessage.value = ''
  const result = applyAction(meta.key, row.id, action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  successMessage.value = ''
  saveTelemetryFilters(filters.value)
  rows.value = listTelemetry(filters.value)
  todayQueue.value = listMaintenanceQueues().find((queue) => queue.queueDate === today)
  historyQueues.value = listMaintenanceQueues()
}

function startBuild() {
  // 外单位已建当天队列时，只能查看不能再建
  if (todayQueue.value && !canEditToday.value) {
    errorMessage.value = `当天准备队列归属外单位「${todayQueue.value.ownerUnit}」，不能修改`
    queueEditing.value = false
    return
  }
  queueCandidates.value = rows.value.map(toQueueItem)
  selectedIds.value = queueCandidates.value.map((item) => item.deviceId)
  replacementIds.value = queueCandidates.value
    .filter((item) => item.createReplacement)
    .map((item) => item.deviceId)
  queueEditing.value = true
  errorMessage.value = ''
  successMessage.value = ''
}

function editExisting() {
  if (!todayQueue.value) {
    return
  }
  // 以当前筛选结果重新构建候选，已保存条目里的勾选与工单标记回填
  const saved = new Map(todayQueue.value.items.map((item) => [item.deviceId, item]))
  queueCandidates.value = rows.value.map((view) => {
    const previous = saved.get(view.id)
    return previous ? { ...previous } : toQueueItem(view)
  })
  selectedIds.value = [...saved.keys()]
  replacementIds.value = todayQueue.value.items
    .filter((item) => item.createReplacement)
    .map((item) => item.deviceId)
  queueEditing.value = true
  errorMessage.value = ''
  successMessage.value = ''
}

function selectAllRows() {
  selectedIds.value = queueCandidates.value.map((item) => item.deviceId)
}

function cancelBuild() {
  queueEditing.value = false
  errorMessage.value = ''
  successMessage.value = ''
}

function saveQueue() {
  errorMessage.value = ''
  successMessage.value = ''
  const items = queueCandidates.value
    .filter((candidate) => selectedIds.value.includes(candidate.deviceId))
    .map((candidate) => ({
      ...candidate,
      createReplacement: replacementIds.value.includes(candidate.deviceId),
    }))
  const result = saveMaintenanceQueue(today, items, { name: store.operator, unit: store.unit })
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  successMessage.value = result.message
  queueEditing.value = false
  reload()
}

function candidateCommInherited(candidate: MaintenanceQueueItem): boolean {
  return rows.value.find((row) => row.id === candidate.deviceId)?.commInherited ?? false
}

function candidateMaintenanceDate(candidate: MaintenanceQueueItem): string {
  return maintenanceDateOf(candidate.maintenanceNote)
}

function maintenanceDateOf(note: string): string {
  const match = /(\d{4}-\d{2}-\d{2})/.exec(note)
  return match ? match[1] : '—'
}

onMounted(reload)
</script>

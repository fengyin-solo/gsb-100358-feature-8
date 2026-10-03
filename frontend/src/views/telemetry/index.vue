<template>
  <section class="page" data-module="telemetry">
    <header class="page-head">
      <div>
        <h2>遥测设备管理</h2>
        <p class="page-desc">维护遥测设备，围绕设备编号、设备类型、所属站点、通讯方式做登记、筛选与状态流转。</p>
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
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
      <button class="btn" type="button" @click="buildQueue">生成当天准备队列</button>
    </form>

    <section v-if="draft" class="queue-panel">
      <h3>当天准备队列（{{ todayText }}）<span class="tag">草稿</span></h3>
      <p class="queue-hint">
        筛选命中 {{ draft.candidates.length + draft.excluded.length }} 台，入队
        {{ draft.candidates.length }} 台；与最近维护记录冲突的设备按维护记录剔除，见下方清单。
      </p>
      <table class="data-table">
        <thead>
          <tr>
            <th>设备编号</th>
            <th>设备类型</th>
            <th>所属站点</th>
            <th>通讯方式</th>
            <th>电池余量</th>
            <th>最近维护日</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in draft.candidates" :key="item.设备编号">
            <td>{{ item.设备编号 }}</td>
            <td>{{ item.设备类型 }}</td>
            <td>{{ item.所属站点 }}</td>
            <td>
              {{ item.通讯方式 }}
              <span v-if="item.通讯方式来源 === '站点默认'" class="tag">站点默认</span>
            </td>
            <td>{{ item.电池余量 }}</td>
            <td>{{ item.最近维护日 }}</td>
            <td class="row-actions">
              <button class="link" type="button" @click="dropDraftItem(item.设备编号)">移出队列</button>
            </td>
          </tr>
          <tr v-if="!draft.candidates.length">
            <td colspan="7" class="empty-state">筛选结果均被最近维护记录剔除，队列暂空</td>
          </tr>
        </tbody>
      </table>
      <ul v-if="draft.excluded.length" class="excluded-list">
        <li v-for="entry in draft.excluded" :key="entry.item.设备编号">
          {{ entry.item.设备编号 }}（{{ entry.item.所属站点 }}）：{{ entry.原因 }}
        </li>
      </ul>
      <div class="queue-actions">
        <button class="btn primary" type="button" @click="saveQueue">保存准备队列并同步更换工单</button>
        <button class="btn ghost" type="button" @click="draft = null">放弃草稿</button>
      </div>
    </section>

    <section v-if="queues.length" class="queue-panel">
      <h3>已保存的准备队列</h3>
      <article v-for="queue in queues" :key="queue.id" class="queue-card">
        <header>
          <strong>{{ queue.日期 }} · {{ queue.管理单位 }}</strong>
          <span v-if="!canModify(queue)" class="tag">外单位队列，只读</span>
          <span class="queue-meta">
            创建人 {{ queue.创建人 }} · 保存于 {{ queue.savedAt }} · 已同步更换工单 {{ queue.同步工单数 }} 张
          </span>
        </header>
        <table class="data-table">
          <thead>
            <tr>
              <th>设备编号</th>
              <th>设备类型</th>
              <th>所属站点</th>
              <th>通讯方式</th>
              <th>电池余量</th>
              <th>最近维护日</th>
              <th v-if="canModify(queue)">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in queue.items" :key="item.设备编号">
              <td>{{ item.设备编号 }}</td>
              <td>{{ item.设备类型 }}</td>
              <td>{{ item.所属站点 }}</td>
              <td>
                {{ item.通讯方式 }}
                <span v-if="item.通讯方式来源 === '站点默认'" class="tag">站点默认</span>
              </td>
              <td>{{ item.电池余量 }}</td>
              <td>{{ item.最近维护日 }}</td>
              <td v-if="canModify(queue)" class="row-actions">
                <button class="link" type="button" @click="removeSavedItem(queue, item.设备编号)">
                  移出队列
                </button>
              </td>
            </tr>
            <tr v-if="!queue.items.length">
              <td :colspan="canModify(queue) ? 7 : 6" class="empty-state">队列已清空</td>
            </tr>
          </tbody>
        </table>
      </article>
    </section>

    <p v-if="noticeMessage" class="notice-text">{{ noticeMessage }}</p>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] || '—' }}</td>
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
          <td :colspan="columns.length + 2" class="empty-state">暂无遥测设备数据，可先登记遥测设备</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条遥测设备记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

import {
  buildPrepQueue,
  downloadEntries,
  listEntries,
  listPrepQueues,
  moduleMeta,
  removePrepQueueItem,
  runAction as applyAction,
  savePrepQueue,
} from '@/api/local-service'
import type { EntryRow, PrepQueue, PrepQueueBuild } from '@/data/types'
import { useFilterStore } from '@/stores/filters'
import { useSessionStore } from '@/stores/session'

const meta = moduleMeta('telemetry')
const columns = ["设备编号", "设备类型", "所属站点", "通讯方式", "安装日期", "最近维护日", "电池余量", "设备状态"]
const actions = ["报修设备", "确认修复", "停用设备"]
const statuses = ["正常运行", "信号异常", "低电量", "待维修", "已停用"]
const stats = [{"label": "设备总数", "value": 0}, {"label": "正常运行数", "value": 0}, {"label": "待维修数", "value": 0}]

const session = useSessionStore()
const filterStore = useFilterStore()

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const noticeMessage = ref('')
// 值班员筛设备只看这四项；上次的筛选条件存起来，返回页面时恢复。
const filterFields = ["所属站点", "设备类型", "通讯方式", "电池余量"]
const filters = ref<Record<string, string>>({ ...filterStore.filtersOf(meta.key) })
const draft = ref<PrepQueueBuild | null>(null)
const queues = ref<PrepQueue[]>([])
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)
const todayText = new Date().toLocaleDateString('sv-SE')

watch(filters, (value) => filterStore.setFilters(meta.key, value), { deep: true })

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '遥测设备登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function buildQueue() {
  noticeMessage.value = ''
  draft.value = buildPrepQueue(filters.value)
}

function dropDraftItem(deviceCode: string) {
  if (!draft.value) {
    return
  }
  draft.value = {
    ...draft.value,
    candidates: draft.value.candidates.filter((item) => item.设备编号 !== deviceCode),
  }
}

function saveQueue() {
  if (!draft.value) {
    return
  }
  const result = savePrepQueue(draft.value.candidates, {
    operator: session.operator,
    unit: session.unit,
  })
  noticeMessage.value = result.message
  if (result.ok) {
    draft.value = null
    refreshQueues()
  }
}

function removeSavedItem(queue: PrepQueue, deviceCode: string) {
  const result = removePrepQueueItem(queue.id, deviceCode, {
    operator: session.operator,
    unit: session.unit,
  })
  noticeMessage.value = result.message
  if (result.ok) {
    refreshQueues()
  }
}

function canModify(queue: PrepQueue): boolean {
  return queue.管理单位 === session.unit
}

function refreshQueues() {
  queues.value = listPrepQueues()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '遥测设备列表读取失败'
  }
}

onMounted(() => {
  reload()
  refreshQueues()
})
</script>

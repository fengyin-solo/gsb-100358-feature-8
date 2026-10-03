<template>
  <section class="page" data-module="communication">
    <header class="page-head">
      <div>
        <h2>通讯系统管理</h2>
        <p class="page-desc">维护通讯设备，围绕设备编号、设备类型、所属站点、通讯协议做登记、筛选与状态流转；「申请更换」同步生成更换工单。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记通讯设备</button>
        <button class="btn" type="button" @click="exportRows">导出通讯系统清单</button>
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
    </form>

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
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
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
          <td :colspan="columns.length + 2" class="empty-state">暂无通讯系统数据，可先登记通讯设备</td>
        </tr>
      </tbody>
    </table>

    <section class="order-section">
      <header class="order-section-head">
        <h3>通讯设备更换工单</h3>
        <span class="rule-note">维护准备队列保存与本页「申请更换」共用同一同步入口，同设备在途工单不重复生成</span>
      </header>
      <table class="data-table">
        <thead>
          <tr>
            <th>工单编号</th><th>所属站点</th><th>设备编号</th><th>设备类型</th>
            <th>更换原因</th><th>来源</th><th>归属单位</th><th>状态</th><th>生成时间</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="order in orders" :key="order.id">
            <td>{{ order.orderNo }}</td>
            <td>{{ order.station }}</td>
            <td>{{ order.deviceCode }}</td>
            <td>{{ order.deviceType }}</td>
            <td>{{ order.reason }}</td>
            <td>
              {{ order.source === 'communication' ? '通讯系统入口' : '维护准备队列' }}
              <div class="muted-text">{{ order.sourceRef }}</div>
            </td>
            <td>{{ order.ownerUnit }}</td>
            <td><span class="tag">{{ order.status }}</span></td>
            <td>{{ order.createdAt }}</td>
          </tr>
          <tr v-if="!orders.length">
            <td :colspan="9" class="empty-state">暂无更换工单</td>
          </tr>
        </tbody>
      </table>
    </section>

    <footer class="page-foot">
      <span>共 {{ total }} 条通讯系统记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  applyCommunicationAction,
  downloadEntries,
  listEntries,
  listReplacementOrders,
  moduleMeta,
} from '@/api/local-service'
import type { EntryRow, ReplacementOrder } from '@/data/types'
import { useSessionStore } from '@/stores/session'

const store = useSessionStore()
const meta = moduleMeta('communication')
const columns = ['设备编号', '设备类型', '所属站点', '通讯协议', '信号强度', '最近通讯时刻', '维护人员', '设备状态']
const actions = ['登记故障', '确认恢复', '申请更换']
const statuses = ['通讯正常', '信号弱', '通讯中断', '待更换']
const stats = [{ label: '设备总数', value: 0 }, { label: '通讯正常数', value: 0 }, { label: '中断设备数', value: 0 }]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const orders = ref<ReplacementOrder[]>([])
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '通讯设备登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  // 其它入口（遥测维护准备队列保存）也走同一个工单同步函数
  const result = applyCommunicationAction(Number(row.id), action, {
    name: store.operator,
    unit: store.unit,
  })
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    orders.value = listReplacementOrders()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '通讯系统列表读取失败'
  }
}

onMounted(reload)
</script>

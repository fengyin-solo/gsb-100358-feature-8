import { defineStore } from 'pinia'

// 各模块页面最近的筛选条件：返回页面时恢复。持久化到 localStorage，刷新也不丢。
const STORAGE_KEY = 'hydrology-monitor-station:filters'

function readStored(): Record<string, Record<string, string>> {
  if (typeof window === 'undefined' || !window.localStorage) {
    return {}
  }
  try {
    return JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<
      string,
      Record<string, string>
    >
  } catch {
    return {}
  }
}

export const useFilterStore = defineStore('filters', {
  state: () => ({
    byModule: readStored(),
  }),
  getters: {
    filtersOf: (state) => (moduleKey: string) => state.byModule[moduleKey] ?? {},
  },
  actions: {
    setFilters(moduleKey: string, filters: Record<string, string>) {
      this.byModule[moduleKey] = { ...filters }
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.byModule))
      }
    },
  },
})

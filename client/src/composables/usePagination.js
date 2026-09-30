import { ref, computed } from 'vue'
import api from '../api'

/**
 * Server-paginated list: GET `path` with page/pageSize, rows under `data[key]`.
 * The server may clamp page/pageSize; its values are adopted.
 */
export function usePagination(path, key) {
  const items = ref([])
  const page = ref(1)
  const pageSize = ref(25)
  const total = ref(0)

  const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)))

  async function load() {
    const { data } = await api.get(path, {
      params: { page: page.value, pageSize: pageSize.value },
    })
    items.value = data[key] || []
    total.value = data.total ?? 0
    if (data.page) page.value = data.page
    if (data.pageSize) pageSize.value = data.pageSize
  }

  function goPage(p) {
    page.value = p
    load()
  }

  return { items, page, pageSize, total, totalPages, load, goPage }
}

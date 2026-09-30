import { ref, watch, onBeforeUnmount } from 'vue'

/**
 * Sortable table headers + debounced search box for server-sorted admin lists.
 * `onChange` runs after a sort click or once the search input settles (250 ms).
 */
export function useSortSearch(defaultField, onChange) {
  const sortField = ref(defaultField)
  const sortOrder = ref('asc')
  const search = ref('')
  const searchQ = ref('')
  let searchTimer = null

  function sortIndicator(field) {
    if (sortField.value !== field) return '↕'
    return sortOrder.value === 'asc' ? '↑' : '↓'
  }

  function setSort(field) {
    if (sortField.value === field) {
      sortOrder.value = sortOrder.value === 'asc' ? 'desc' : 'asc'
    } else {
      sortField.value = field
      sortOrder.value = 'asc'
    }
    onChange()
  }

  watch(search, (v) => {
    clearTimeout(searchTimer)
    searchTimer = setTimeout(() => {
      searchQ.value = v.trim()
      onChange()
    }, 250)
  })

  onBeforeUnmount(() => clearTimeout(searchTimer))

  return { sortField, sortOrder, search, searchQ, sortIndicator, setSort }
}

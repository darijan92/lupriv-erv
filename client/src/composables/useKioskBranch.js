const STORAGE_KEY = 'lupriv_branch_id'

export function getStoredBranchId() {
  const v = localStorage.getItem(STORAGE_KEY)
  if (!v) return ''
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? String(n) : ''
}

export function setStoredBranchId(id) {
  if (id === null || id === undefined || id === '') {
    localStorage.removeItem(STORAGE_KEY)
    return
  }
  localStorage.setItem(STORAGE_KEY, String(id))
}

export function clearStoredBranchId() {
  localStorage.removeItem(STORAGE_KEY)
}

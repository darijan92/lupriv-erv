/** "YYYY-MM-DD HH:mm" from a DATETIME/ISO string; '' when empty. */
export function formatDate(d) {
  if (!d) return ''
  return String(d).replace('T', ' ').slice(0, 16)
}

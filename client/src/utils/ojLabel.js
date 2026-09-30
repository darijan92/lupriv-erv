export function shortOj(name) {
  const value = String(name ?? '').trim()
  if (!value) return value
  const parts = value.split(/\s+/)
  return parts[parts.length - 1]
}

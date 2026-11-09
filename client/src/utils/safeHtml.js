import DOMPurify from 'dompurify'

/** Sanitise HTML (posts, log entries) before rendering it with v-html. */
export function safeHtml(html) {
  return DOMPurify.sanitize(String(html ?? ''), { USE_PROFILES: { html: true } })
}

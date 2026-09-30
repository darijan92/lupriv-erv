import api from '../api'

/**
 * Download authenticated blob via Authorization header (no token in query).
 */
export function useDownload() {
  function saveBlob(data, filename) {
    const url = URL.createObjectURL(data)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  async function download(path, filename, params = {}) {
    const { data } = await api.get(path, { params, responseType: 'blob' })
    saveBlob(data, filename)
  }

  return { saveBlob, download }
}

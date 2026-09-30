import { ref } from 'vue'

export function useFlash() {
  const error = ref('')
  const success = ref('')

  function clear() {
    error.value = ''
    success.value = ''
  }

  function setError(e) {
    error.value = e?.message || String(e) || 'Greška'
    success.value = ''
  }

  function setSuccess(msg) {
    success.value = msg
    error.value = ''
  }

  return { error, success, clear, setError, setSuccess }
}

import axios from 'axios'

// Relative /api: Vite proxy in host `npm run dev`, nginx → api:3001 in Docker web
const api = axios.create({
  baseURL: '/api',
})

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

/** Requests that answer 401 for a wrong password rather than an expired session. */
const CREDENTIAL_ENDPOINTS = ['/auth/login', '/kiosk/check-in', '/kiosk/check-out']

api.interceptors.response.use(
  (r) => r,
  (err) => {
    const status = err.response?.status
    const url = err.config?.url || ''
    const hadToken = !!localStorage.getItem('token')
    if (status === 401 && hadToken && !CREDENTIAL_ENDPOINTS.some((p) => url.startsWith(p))) {
      // Expired or revoked session: drop it and go to login (full reload resets the store).
      localStorage.removeItem('token')
      localStorage.removeItem('user')
      if (!window.location.pathname.startsWith('/login')) {
        window.location.assign('/login?expired=1')
      }
    }
    if (status === 403 && err.response?.data?.code === 'PASSWORD_CHANGE_REQUIRED') {
      if (!window.location.pathname.startsWith('/change-password')) {
        window.location.assign('/change-password')
      }
    }
    const msg = err.response?.data?.error || err.message || 'Greška'
    return Promise.reject(new Error(msg))
  }
)

export default api

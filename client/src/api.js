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

api.interceptors.response.use(
  (r) => r,
  (err) => {
    const msg = err.response?.data?.error || err.message || 'Greška'
    return Promise.reject(new Error(msg))
  }
)

export default api

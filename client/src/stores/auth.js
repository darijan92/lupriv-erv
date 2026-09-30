import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import api from '../api'

export const useAuthStore = defineStore('auth', () => {
  const token = ref(localStorage.getItem('token') || '')
  const user = ref(JSON.parse(localStorage.getItem('user') || 'null'))

  const isLoggedIn = computed(() => !!token.value)
  const isAdmin = computed(() => user.value && user.value.role_id >= 3)
  const isModerator = computed(() => user.value && user.value.role_id === 2)

  function setSession(t, u) {
    token.value = t
    user.value = u
    localStorage.setItem('token', t)
    localStorage.setItem('user', JSON.stringify(u))
  }

  function logout() {
    token.value = ''
    user.value = null
    localStorage.removeItem('token')
    localStorage.removeItem('user')
  }

  async function login(payload) {
    const { data } = await api.post('/auth/login', payload)
    setSession(data.token, data.user)
    return data
  }

  return { token, user, isLoggedIn, isAdmin, isModerator, setSession, logout, login }
})

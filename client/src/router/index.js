import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const routes = [
  { path: '/', name: 'kiosk', component: () => import('../views/KioskView.vue') },
  { path: '/login', name: 'login', component: () => import('../views/LoginView.vue') },
  { path: '/employee/:id', name: 'employee', component: () => import('../views/EmployeeHoursView.vue'), meta: { auth: true } },
  { path: '/moderator', name: 'moderator', component: () => import('../views/ModeratorView.vue'), meta: { auth: true, mod: true } },
  { path: '/moderator/hours/:id', name: 'mod-hours', component: () => import('../views/EmployeeHoursView.vue'), meta: { auth: true, mod: true } },
  {
    path: '/admin',
    component: () => import('../views/admin/AdminLayout.vue'),
    meta: { auth: true, admin: true },
    children: [
      { path: '', name: 'admin', component: () => import('../views/admin/AdminUsers.vue') },
      { path: 'branches', name: 'admin-branches', component: () => import('../views/admin/AdminBranches.vue') },
      { path: 'posts', name: 'admin-posts', component: () => import('../views/admin/AdminPosts.vue') },
      { path: 'active', name: 'admin-active', component: () => import('../views/admin/AdminActive.vue') },
      { path: 'hours/:id?', name: 'admin-hours', component: () => import('../views/EmployeeHoursView.vue') },
      { path: 'logs', name: 'admin-logs', component: () => import('../views/admin/AdminLogs.vue') },
      { path: 'auto-logout', name: 'admin-auto', component: () => import('../views/admin/AdminAutoLogout.vue') },
    ],
  },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

router.beforeEach((to) => {
  const auth = useAuthStore()
  if (to.meta.auth && !auth.isLoggedIn) return { name: 'login', query: { redirect: to.fullPath } }
  if (to.meta.admin && !auth.isAdmin) return { name: 'login' }
  if (to.meta.mod && !(auth.isModerator || auth.isAdmin)) return { name: 'login' }
  // Ordinary employees may only view their own monthly hours (no IDOR via URL)
  if (to.name === 'employee' && auth.isLoggedIn && !auth.isAdmin && !auth.isModerator) {
    const targetId = Number(to.params.id)
    const ownId = Number(auth.user?.id)
    if (ownId && targetId && targetId !== ownId) {
      return { name: 'employee', params: { id: String(ownId) } }
    }
  }
  return true
})

export default router

<template>
  <div class="card" style="max-width:480px;margin:2rem auto">
    <h1>Prijava</h1>
    <p class="muted">Admin ide u panel. Ostali mogu pokrenuti RV. Odabrana poslovnica pamti se na uređaju.</p>
    <div v-if="error" class="alert error">{{ error }}</div>
    <div v-if="info" class="alert success">{{ info }}</div>
    <form class="stack" @submit.prevent="submit">
      <div>
        <label>Korisničko ime</label>
        <input v-model="form.username" required />
      </div>
      <div>
        <label>Lozinka</label>
        <input v-model="form.password" type="password" required />
      </div>
      <div>
        <label>Poslovnica (za radno vrijeme na početnoj stranici)</label>
        <select v-model="form.branch_id">
          <option value="">— samo panel —</option>
          <option v-for="b in branches" :key="b.id" :value="b.id">{{ b.naziv_oj }}</option>
        </select>
      </div>
      <label style="display:flex;gap:0.5rem;align-items:center">
        <input v-model="form.start_work" type="checkbox" style="width:auto" />
        Započni radno vrijeme
      </label>
      <button type="submit" :disabled="busy">Prijavi se</button>
    </form>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import api from '../api'
import { useAuthStore } from '../stores/auth'
import { getStoredBranchId, setStoredBranchId } from '../composables/useKioskBranch'

const auth = useAuthStore()
const router = useRouter()
const branches = ref([])
const error = ref('')
const info = ref('')
const busy = ref(false)
if (new URLSearchParams(window.location.search).get('expired')) {
  error.value = 'Sesija je istekla. Prijavite se ponovno.'
}
const form = ref({
  username: '',
  password: '',
  branch_id: getStoredBranchId(),
  start_work: true,
})

onMounted(async () => {
  const { data } = await api.get('/auth/branches-public')
  branches.value = data.branches
  if (!form.value.branch_id && getStoredBranchId()) {
    form.value.branch_id = getStoredBranchId()
  }
})

async function submit() {
  busy.value = true
  error.value = ''
  info.value = ''
  try {
    if (form.value.branch_id) {
      setStoredBranchId(form.value.branch_id)
    }
    const payload = {
      username: form.value.username,
      password: form.value.password,
      start_work: form.value.start_work,
      branch_id: form.value.branch_id ? Number(form.value.branch_id) : undefined,
    }
    const data = await auth.login(payload)
    if (data.success) info.value = data.success
    if (data.warning) info.value = data.warning
    if (data.mustChangePassword) {
      router.push('/change-password')
      return
    }
    router.push(auth.isAdmin ? '/admin' : '/')
  } catch (e) {
    error.value = e.message
  } finally {
    busy.value = false
  }
}
</script>

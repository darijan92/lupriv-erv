<template>
  <div>
    <div v-if="needsBranchSelect" class="card" style="max-width:520px;margin:1rem auto">
      <h1>Odabir poslovnice</h1>
      <p class="muted">
        Poslovnica se pamti na ovom uređaju (localStorage). Jednom odabrana, koristi se pri sljedećim posjetima.
      </p>
      <div v-if="error" class="alert warn">{{ error }}</div>
      <form class="stack" @submit.prevent="confirmBranch">
        <div class="field">
          <label>Poslovnica</label>
          <select v-model="selectedBranchId" required>
            <option value="">— odaberi —</option>
            <option v-for="b in branches" :key="b.id" :value="String(b.id)">{{ b.naziv_oj }} ({{ b.sifra }})</option>
          </select>
        </div>
        <button type="submit">Spremi i otvori početnu stranicu</button>
      </form>
    </div>

    <template v-else>
      <div v-if="error" class="alert error">{{ error }}</div>
      <div v-if="msg" class="alert" :class="msgType">{{ msg }}</div>

      <template v-if="branch">
        <div class="card">
          <div class="row" style="justify-content:space-between;align-items:flex-start">
            <div>
              <h1>{{ branch.naziv_oj }}</h1>
              <p class="muted">Početna — evidencija radnog vremena</p>
            </div>
            <button type="button" class="secondary" @click="changeBranch">Promijeni poslovnicu</button>
          </div>
        </div>

        <div class="grid2">
          <div class="card">
            <h2>Prijava na rad</h2>
            <form class="stack" @submit.prevent="checkIn">
              <div>
                <label>Korisničko ime</label>
                <input v-model="form.username" required autocomplete="username" />
              </div>
              <div>
                <label>Lozinka</label>
                <input v-model="form.password" type="password" required autocomplete="current-password" />
              </div>
              <button type="submit" :disabled="busy">Započni radno vrijeme</button>
            </form>
          </div>

          <div class="card">
            <h2>Trenutno na poslu</h2>
            <p v-if="!activeHours.length" class="muted">Nema aktivnih prijava.</p>
            <table v-else>
              <thead><tr><th>Ime</th><th>Od</th><th></th></tr></thead>
              <tbody>
                <tr v-for="h in activeHours" :key="h.id">
                  <td>{{ h.imePrezime }}</td>
                  <td><span class="pill">{{ h.temp }}</span></td>
                  <td><button class="secondary" @click="prepareOut(h)">Odjava</button></td>
                </tr>
              </tbody>
            </table>

            <form v-if="outUser" class="stack" style="margin-top:1rem" @submit.prevent="checkOut">
              <h3>Odjava: {{ outUser.imePrezime }}</h3>
              <div>
                <label>Lozinka</label>
                <input v-model="outPassword" type="password" required />
              </div>
              <div class="actions">
                <button type="submit" :disabled="busy">Potvrdi odjavu</button>
                <button type="button" class="secondary" @click="outUser=null">Odustani</button>
              </div>
            </form>
          </div>
        </div>

        <div v-if="activeHours.length" class="card">
          <h2>Obavijesti</h2>
          <div v-for="p in posts" :key="p.id" style="margin-bottom:1rem">
            <strong>{{ p.naslov }}</strong>
            <div class="muted" style="font-size:0.85rem">{{ formatDate(p.created_at) }}</div>
            <div class="post-body" v-html="safeHtml(p.sadrzaj)"></div>
          </div>
        </div>
      </template>
    </template>
  </div>
</template>

<script setup>
import { safeHtml } from '../utils/safeHtml'
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import api from '../api'
import { getStoredBranchId, setStoredBranchId, clearStoredBranchId } from '../composables/useKioskBranch'
import { formatDate } from '../utils/formatDate'

const router = useRouter()

const branch = ref(null)
const posts = ref([])
const activeHours = ref([])
const error = ref('')
const msg = ref('')
const msgType = ref('success')
const busy = ref(false)
const form = ref({ username: '', password: '' })
const outUser = ref(null)
const outPassword = ref('')
const branches = ref([])
const selectedBranchId = ref(getStoredBranchId())
const needsBranchSelect = ref(false)

async function loadBranchOptions() {
  const { data } = await api.get('/auth/branches-public')
  branches.value = data.branches
}

async function load() {
  error.value = ''
  const stored = getStoredBranchId()
  selectedBranchId.value = stored

  if (!stored) {
    needsBranchSelect.value = true
    branch.value = null
    await loadBranchOptions()
    return
  }

  try {
    const { data } = await api.get('/kiosk', { params: { branchId: stored } })
    needsBranchSelect.value = false
    branch.value = data.branch
    posts.value = data.posts
    activeHours.value = data.activeHours
  } catch (e) {
    error.value = e.message
    needsBranchSelect.value = true
    branch.value = null
    clearStoredBranchId()
    await loadBranchOptions()
  }
}

function confirmBranch() {
  if (!selectedBranchId.value) {
    error.value = 'Odaberite poslovnicu'
    return
  }
  setStoredBranchId(selectedBranchId.value)
  load()
}

function changeBranch() {
  clearStoredBranchId()
  branch.value = null
  needsBranchSelect.value = true
  loadBranchOptions()
}

async function checkIn() {
  busy.value = true
  msg.value = ''
  try {
    const branchId = branch.value?.id || Number(getStoredBranchId()) || undefined
    const { data } = await api.post('/kiosk/check-in', {
      ...form.value,
      branch_id: branchId,
    })
    if (data.isAdmin) {
      msg.value = data.message
      msgType.value = 'warn'
      router.push('/login')
      return
    }
    msg.value = data.success
    msgType.value = data.autoClosed ? 'warn' : 'success'
    form.value = { username: '', password: '' }
    await load()
  } catch (e) {
    msg.value = e.message
    msgType.value = 'error'
  } finally {
    busy.value = false
  }
}

function prepareOut(h) {
  outUser.value = h
  outPassword.value = ''
}

async function checkOut() {
  busy.value = true
  msg.value = ''
  try {
    const { data } = await api.post('/kiosk/check-out', {
      username: outUser.value.username,
      password: outPassword.value,
    })
    msg.value = data.success
    // A forgotten check-out was closed by rule, not "until now": make it stand out.
    msgType.value = data.autoClosed ? 'warn' : 'success'
    outUser.value = null
    await load()
  } catch (e) {
    msg.value = e.message
    msgType.value = 'error'
  } finally {
    busy.value = false
  }
}

onMounted(load)
</script>

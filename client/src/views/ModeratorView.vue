<template>
  <div>
    <div class="card">
      <div class="row" style="justify-content:space-between;align-items:center">
        <div>
          <h1>Voditelj — pregled zaposlenika</h1>
          <p v-if="branch" class="muted">{{ branch.naziv_oj }} ({{ branch.grad }})</p>
        </div>
        <div v-if="branch" class="row">
          <div class="field" style="min-width:100px">
            <label>Mjesec</label>
            <select v-model.number="month">
              <option v-for="m in 12" :key="m" :value="m">{{ m }}</option>
            </select>
          </div>
          <div class="field" style="min-width:100px">
            <label>Godina</label>
            <input v-model.number="year" type="number" />
          </div>
          <button @click="exportBranch">Izvoz Excel (poslovnica)</button>
        </div>
      </div>
    </div>
    <div v-if="error" class="alert error">{{ error }}</div>
    <div v-if="msg" class="alert success">{{ msg }}</div>
    <div class="card">
      <table>
        <thead><tr><th>Šifra</th><th>Ime</th><th>Username</th><th>Uloga</th><th></th></tr></thead>
        <tbody>
          <tr v-for="u in users" :key="u.id">
            <td>{{ u.sifra }}</td>
            <td>{{ u.ime }} {{ u.prezime }}</td>
            <td>{{ u.username }}</td>
            <td>{{ u.role_id }}</td>
            <td class="actions">
              <router-link class="btn secondary" :to="`/moderator/hours/${u.id}`">Sati</router-link>
              <button class="secondary" @click="exportUser(u)">Excel</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import api from '../api'
import { useDownload } from '../composables/useDownload'

const users = ref([])
const branch = ref(null)
const error = ref('')
const msg = ref('')
const month = ref(new Date().getMonth() + 1)
const year = ref(new Date().getFullYear())
const { download } = useDownload()

async function exportUser(u) {
  try {
    error.value = ''
    await download(`/hours/export/${u.id}`, `sati_${u.username}_${month.value}_${year.value}.xlsx`, {
      month: month.value, year: year.value,
    })
    msg.value = `Preuzeto: sati_${u.username}_${month.value}_${year.value}.xlsx`
  } catch (e) {
    error.value = e.message
  }
}

async function exportBranch() {
  if (!branch.value) return
  try {
    error.value = ''
    await download(`/hours/export-branch/${branch.value.id}`, `poslovnica_${branch.value.id}_${month.value}_${year.value}.xlsx`, {
      month: month.value, year: year.value,
    })
    msg.value = `Preuzeto: poslovnica_${branch.value.id}_${month.value}_${year.value}.xlsx`
  } catch (e) {
    error.value = e.message
  }
}

onMounted(async () => {
  try {
    const { data } = await api.get('/moderator/users')
    users.value = data.users
    branch.value = data.branch
  } catch (e) {
    error.value = e.message
  }
})
</script>

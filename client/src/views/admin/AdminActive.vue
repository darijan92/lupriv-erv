<template>
  <div>
    <div v-if="msg" class="alert" :class="msgType">{{ msg }}</div>
    <div class="card">
      <h2>Aktivne prijave</h2>
      <table>
        <thead><tr><th>Korisnik</th><th>Poslovnica</th><th>Datum</th><th>Od</th><th></th></tr></thead>
        <tbody>
          <tr v-for="h in hours" :key="h.id">
            <td>{{ h.ime }} {{ h.prezime }} ({{ h.username }})</td>
            <td :title="h.naziv_oj || undefined">{{ shortOj(h.naziv_oj) }}</td>
            <td>{{ h.datum }}</td>
            <td><span class="pill">{{ h.temp }}</span></td>
            <td>
              <div class="row">
                <input v-model="passwords[h.id]" type="password" placeholder="Admin lozinka" style="max-width:160px" />
                <button class="danger" @click="stop(h)">Zaustavi RV</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="!hours.length" class="muted">Nema aktivnih sesija.</p>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import api from '../../api'
import { shortOj } from '../../utils/ojLabel'
const hours = ref([])
const passwords = ref({})
const msg = ref('')
const msgType = ref('success')
async function load() { hours.value = (await api.get('/hours/active')).data.hours }
async function stop(h) {
  try {
    await api.post('/hours/admin-stop', { hour_id: h.id, password: passwords.value[h.id] })
    msg.value = 'Odjavljen'; msgType.value = 'success'
    await load()
  } catch (e) { msg.value = e.message; msgType.value = 'error' }
}
onMounted(load)
</script>

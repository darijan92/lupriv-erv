<template>
  <div>
    <div class="card">
      <div class="row" style="justify-content:space-between">
        <h2>Automatske odjave</h2>
        <div class="actions">
          <button class="secondary" @click="runNow">Pokreni sada</button>
          <button @click="exportExcel">Izvoz Excel</button>
          <button class="secondary" @click="exportCsv">CSV</button>
        </div>
      </div>
      <p class="muted">Sesije s napomenom „Automatska odjava!“ / „Automatska odjava (noćna smjena)!“ (jednom dnevno nakon 23:00). Dnevne smjene (&lt; 20:00) zatvaraju se na <code>kraj_rv</code> poslovnice u kojoj je radnik radio (fallback 23:00); noćne (≥ 20:00) se istog dana preskaču, a sljedeće večeri — ako još otvorene — zatvaraju se na jutarnji <code>pocetak_rv</code> poslovnice (fallback 08:00). Excel izvještaj: broj po zaposleniku (ukupno / tekući / prošli mjesec) — izvoz uključuje cijeli skup, ne samo trenutnu stranicu.</p>
      <div v-if="msg" class="alert success">{{ msg }}</div>
      <div v-if="error" class="alert error">{{ error }}</div>
      <p class="muted" v-if="total">{{ total }} ukupno</p>
      <table>
        <thead><tr><th>Datum</th><th>Korisnik</th><th>OJ</th><th>Sati</th><th>Napomena</th></tr></thead>
        <tbody>
          <tr v-for="h in hours" :key="h.id">
            <td>{{ h.datum }}</td>
            <td>{{ h.ime }} {{ h.prezime }}</td>
            <td :title="h.naziv_oj || undefined">{{ shortOj(h.naziv_oj) }}</td>
            <td>{{ h.radni_sati }}</td>
            <td>{{ h.napomena }}</td>
          </tr>
        </tbody>
      </table>
      <p v-if="!hours.length" class="muted">Nema automatskih odjava.</p>
      <div class="pagination" v-if="totalPages > 1">
        <button type="button" class="secondary" :disabled="page <= 1" @click="goPage(page - 1)">Prethodna</button>
        <span class="muted">Stranica {{ page }} od {{ totalPages }} ({{ total }} ukupno)</span>
        <button type="button" class="secondary" :disabled="page >= totalPages" @click="goPage(page + 1)">Sljedeća</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import api from '../../api'
import { useDownload } from '../../composables/useDownload'
import { usePagination } from '../../composables/usePagination'
import { shortOj } from '../../utils/ojLabel'

const { items: hours, page, total, totalPages, load, goPage } = usePagination('/logs/auto-logout', 'hours')
const msg = ref('')
const error = ref('')

const { download } = useDownload()

async function runNow() {
  const { data } = await api.post('/auto-logout/run')
  msg.value = `Zatvoreno: ${data.closed} (dan ${data.closedDay ?? 0}, noć ${data.closedNight ?? 0}; današnje noćne preskočene: ${data.skippedNight ?? 0})`
  page.value = 1
  await load()
}

async function exportExcel() {
  try {
    error.value = ''
    await download('/logs/auto-logout/export', 'automatske_odjave.xlsx')
    msg.value = 'Preuzeto: automatske_odjave.xlsx'
  } catch (e) {
    error.value = e.message
  }
}

async function exportCsv() {
  try {
    error.value = ''
    await download('/logs/auto-logout/export', 'automatske_odjave.csv', { format: 'csv' })
  } catch (e) {
    error.value = e.message
  }
}

onMounted(load)
</script>

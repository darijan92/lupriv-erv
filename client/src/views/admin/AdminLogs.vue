<template>
  <div class="card">
    <h2>Logovi</h2>
    <p v-if="total" class="muted">{{ total }} ukupno</p>
    <table>
      <thead><tr><th>Datum</th><th>Korisnik</th><th>OJ</th><th>Sadržaj</th></tr></thead>
      <tbody>
        <tr v-for="l in logs" :key="l.id">
          <td>{{ l.datum }}</td>
          <td>{{ l.ime }} {{ l.prezime }}</td>
          <td :title="l.naziv_oj || undefined">{{ shortOj(l.naziv_oj) }}</td>
          <td v-html="safeHtml(l.content)"></td>
        </tr>
      </tbody>
    </table>
    <p v-if="!logs.length" class="muted">Nema logova.</p>
    <div v-if="totalPages > 1" class="pagination">
      <button type="button" class="secondary" :disabled="page <= 1" @click="goPage(page - 1)">Prethodna</button>
      <span class="muted">Stranica {{ page }} od {{ totalPages }} ({{ total }} ukupno)</span>
      <button type="button" class="secondary" :disabled="page >= totalPages" @click="goPage(page + 1)">Sljedeća</button>
    </div>
  </div>
</template>

<script setup>
import { safeHtml } from '../../utils/safeHtml'
import { onMounted } from 'vue'
import { shortOj } from '../../utils/ojLabel'
import { usePagination } from '../../composables/usePagination'

const { items: logs, page, total, totalPages, load, goPage } = usePagination('/logs', 'logs')

onMounted(load)
</script>

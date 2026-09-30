<template>
  <div>
    <div class="card">
      <div class="row" style="justify-content:space-between;align-items:center">
        <div>
          <h1>{{ title }}</h1>
          <p class="muted" v-if="user">{{ user.ime }} {{ user.prezime }} · {{ user.naziv_oj || '' }}</p>
        </div>
        <div class="row">
          <div class="field" style="min-width:100px">
            <label>Mjesec</label>
            <select v-model.number="month" @change="load">
              <option v-for="m in 12" :key="m" :value="m">{{ m }}</option>
            </select>
          </div>
          <div class="field" style="min-width:100px">
            <label>Godina</label>
            <input v-model.number="year" type="number" @change="load" />
          </div>
          <label
            v-if="auth.isAdmin"
            class="checkbox-label"
            style="align-self:flex-end;margin-bottom:0.35rem"
          >
            <input type="checkbox" v-model="showPauze" />
            Prikaži pauze
          </label>
          <button @click="exportExcel">Izvoz Excel</button>
          <button class="secondary" @click="exportCsv">CSV</button>
        </div>
      </div>
    </div>

    <div v-if="error" class="alert error">{{ error }}</div>
    <div v-if="success" class="alert success">{{ success }}</div>

    <div class="card" v-if="canEdit">
      <div class="row" style="justify-content:space-between;align-items:center;margin-bottom:0">
        <h3 style="margin:0">Odsustvo i noćni rad / smjena</h3>
        <div class="row">
          <button type="button" @click="openAbsence">Dodaj odsustvo</button>
          <button type="button" class="secondary" @click="openNight">Dodaj noćni rad</button>
        </div>
      </div>
    </div>

    <div class="card">
      <table>
        <thead>
          <tr>
            <th>Dan</th><th>OJ</th><th>Sati</th>
            <th v-if="showPrekidColumn">Prekid</th>
            <th v-if="showOdsustvoColumn">Odsustvo / smjena</th>
            <th>Ukupno</th><th>Reg.</th><th>Dod.</th><th>Napomena</th><th v-if="canEdit"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(d, i) in rows" :key="i" :class="{ sunday: d.nedjelja, night: d.isNightShift }">
            <td>{{ d.dan }}</td>
            <td>
              <span
                v-if="hasOjName(d.naziv_oj)"
                class="oj-label"
                :data-tooltip="String(d.naziv_oj).trim()"
                tabindex="0"
              >{{ shortOj(d.naziv_oj) }}</span>
              <span v-else class="muted">—</span>
            </td>
            <td>
              <div v-if="d.intervals.length" class="time-pills">
                <span
                  v-for="(interval, intervalIndex) in d.intervals"
                  :key="`${interval.start}-${interval.end}-${intervalIndex}`"
                  class="pill time-pill"
                  :title="interval.overnight ? 'Noćna smjena' : undefined"
                >{{ interval.label }}</span>
              </div>
              <span v-if="d.temp" class="pill">aktivno {{ d.temp }}</span>
              <!-- Legacy parity: show absence label in Sati when there are no intervals -->
              <span
                v-if="absenceInSatiColumn(d)"
                class="pill"
                :class="d.odsustvo === 'Noćni rad' ? 'night-pill' : 'absence-pill'"
              >{{ d.odsustvo }}<template v-if="d.odsustvo_time"> · {{ d.odsustvo_time }}</template></span>
            </td>
            <td v-if="showPrekidColumn">
              <span v-if="d.prekidText" class="pill time-pill prekid-pill" title="Automatski prekid">{{ d.prekidText }}</span>
              <span v-else class="muted">—</span>
            </td>
            <td v-if="showOdsustvoColumn">
              <div class="time-pills">
                <span v-if="d.isNightShift" class="pill night-pill">Noćni</span>
                <span
                  v-if="d.odsustvo && d.odsustvo !== 'Noćni rad'"
                  class="pill absence-pill"
                >{{ d.odsustvo }}</span>
                <span v-else-if="d.odsustvo === 'Noćni rad' && !d.isNightShift" class="pill night-pill">Noćni rad</span>
                <span v-if="d.odsustvo_time" class="pill time-pill">{{ d.odsustvo_time }}</span>
              </div>
            </td>
            <td>{{ d.ukupno }}</td>
            <td>{{ d.total }}</td>
            <td>{{ d.dodatno }}</td>
            <td>{{ d.napomena }}</td>
            <td v-if="canEdit && d.id">
              <button class="secondary" @click="editRow(d)">Uredi</button>
            </td>
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <td :colspan="zbrojLabelColspan"><strong>Zbroj</strong></td>
            <td><strong>{{ zbroj.ukupno }}</strong></td>
            <td><strong>{{ zbroj.total }}</strong></td>
            <td><strong>{{ zbroj.dodatno }}</strong></td>
            <td :colspan="canEdit ? 2 : 1"></td>
          </tr>
        </tfoot>
      </table>
    </div>

    <AppModal :open="absenceOpen" title="Dodaj odsustvo" @close="closeAbsence">
      <form class="stack" @submit.prevent="addAbsence">
        <div class="row">
          <div class="field"><label>Od</label><input type="date" v-model="abs.pocetak" required /></div>
          <div class="field"><label>Do</label><input type="date" v-model="abs.kraj" required /></div>
          <div class="field">
            <label>Vrsta</label>
            <select v-model="abs.odsustvo">
              <option v-for="o in odsustva" :key="o" :value="o">{{ o }}</option>
            </select>
          </div>
          <div class="field"><label>Vrijeme (opcionalno)</label><input v-model="abs.odsustvo_time" placeholder="08:00" /></div>
        </div>
        <div class="row">
          <div class="field"><label>Napomena</label><input v-model="abs.napomena" /></div>
          <div class="field">
            <label>Poslovnica</label>
            <select v-model="abs.branch_id">
              <option :value="null">—</option>
              <option v-for="b in branches" :key="b.id" :value="b.id">{{ b.naziv_oj }}</option>
            </select>
          </div>
        </div>
        <label style="display:flex;gap:.5rem;align-items:center"><input type="checkbox" v-model="abs.skip_saturday" style="width:auto" /> Preskoči subote</label>
        <label style="display:flex;gap:.5rem;align-items:center"><input type="checkbox" v-model="abs.skip_sunday" style="width:auto" /> Preskoči nedjelje</label>
        <div class="actions">
          <button type="submit" :disabled="saving">{{ saving ? 'Spremanje…' : 'Spremi odsustvo' }}</button>
          <button type="button" class="secondary" @click="closeAbsence" :disabled="saving">Odustani</button>
        </div>
      </form>
    </AppModal>

    <AppModal :open="nightOpen" title="Dodaj noćni rad / smjenu" @close="closeNight">
      <form class="stack" @submit.prevent="addNightShift">
        <p class="muted">Noćna smjena se upisuje naknadno (ne preko početne stranice). Kraj smije biti manji od početka (npr. 22:00–06:00).</p>
        <div class="row">
          <div class="field"><label>Datum</label><input type="date" v-model="night.datum" required /></div>
          <div class="field"><label>Početak</label><input v-model="night.start" placeholder="22:00" pattern="[0-2][0-9]:[0-5][0-9]" /></div>
          <div class="field"><label>Završetak</label><input v-model="night.end" placeholder="06:00" pattern="[0-2][0-9]:[0-5][0-9]" /></div>
          <div class="field">
            <label>Poslovnica</label>
            <select v-model="night.branch_id">
              <option :value="null">—</option>
              <option v-for="b in branches" :key="b.id" :value="b.id">{{ b.naziv_oj }}</option>
            </select>
          </div>
        </div>
        <div class="field"><label>Napomena</label><input v-model="night.napomena" placeholder="npr. noćna smjena" /></div>
        <label style="display:flex;gap:.5rem;align-items:center">
          <input type="checkbox" v-model="night.flatEight" style="width:auto" /> Bez sati — evidentiraj kao 08:00 (stari način)
        </label>
        <div class="actions">
          <button type="submit" :disabled="saving">{{ saving ? 'Spremanje…' : 'Spremi noćnu smjenu' }}</button>
          <button type="button" class="secondary" @click="closeNight" :disabled="saving">Odustani</button>
        </div>
      </form>
    </AppModal>

    <AppModal :open="!!editing" :title="editing ? `Uredi zapis #${editing.id}` : 'Uredi zapis'" @close="closeEdit">
      <form class="stack" @submit.prevent="saveEdit">
        <div class="field period-field">
          <label>Radni sati</label>
          <div class="period-list">
            <div
              v-for="(p, idx) in editForm.periods"
              :key="idx"
              class="period-pill"
              :class="{ open: idx === editForm.periods.length - 1 && p.start && !p.end }"
            >
              <span class="period-idx" title="Period">{{ idx + 1 }}</span>
              <div class="period-times">
                <label>Početak</label>
                <input type="time" v-model="p.start" step="60" />
              </div>
              <span class="period-sep" aria-hidden="true">–</span>
              <div class="period-times">
                <label>
                  Kraj
                  <span v-if="idx === editForm.periods.length - 1" class="muted"> (opcionalno)</span>
                </label>
                <input type="time" v-model="p.end" step="60" />
              </div>
              <button
                type="button"
                class="secondary period-remove"
                :disabled="editForm.periods.length <= 1"
                :title="editForm.periods.length <= 1 ? 'Ostaje barem jedan period' : 'Ukloni period'"
                @click="removePeriod(idx)"
              >×</button>
            </div>
          </div>
          <div class="period-actions">
            <button type="button" class="secondary" @click="addPeriod">Dodaj period</button>
          </div>
          <p v-if="editPeriodError" class="alert error" style="margin:0.5rem 0 0">{{ editPeriodError }}</p>
          <p class="muted" style="margin:0.5rem 0 0;font-size:0.85rem">
            Zadnji period smije biti bez kraja (aktivni interval). Raniji periodi moraju imati početak i kraj.
            Noćna smjena: kraj smije biti manji od početka (npr. 22:00–06:00).
          </p>
        </div>
        <div class="row">
          <div class="field"><label>Odsustvo</label><input v-model="editForm.odsustvo" /></div>
          <div class="field"><label>Odsustvo vrijeme</label><input v-model="editForm.odsustvo_time" placeholder="08:00" /></div>
          <div class="field"><label>Napomena</label><input v-model="editForm.napomena" /></div>
        </div>
        <label style="display:flex;gap:.5rem;align-items:center">
          <input type="checkbox" v-model="editForm.nocni_rad" style="width:auto" /> Označi kao Noćni rad
        </label>
        <div class="actions">
          <button type="submit" :disabled="saving">{{ saving ? 'Spremanje…' : 'Spremi' }}</button>
          <button type="button" class="secondary" @click="closeEdit" :disabled="saving">Odustani</button>
          <button v-if="auth.isAdmin" type="button" class="danger" @click="removeEdit" :disabled="saving">Obriši</button>
        </div>
      </form>
    </AppModal>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import api from '../api'
import AppModal from '../components/AppModal.vue'
import { useAuthStore } from '../stores/auth'
import { useDownload } from '../composables/useDownload'
import { useFlash } from '../composables/useFlash'
import { shortOj } from '../utils/ojLabel'

const route = useRoute()
const auth = useAuthStore()
const { download } = useDownload()
const { error, success, setError, setSuccess } = useFlash()

const userId = computed(() => Number(route.params.id || auth.user?.id))
const canEdit = computed(() => auth.isAdmin || auth.isModerator)
const title = computed(() => (canEdit.value ? 'Pregled sati' : 'Moji sati'))
/** Admin-only toggle; employees/voditelj never see Prekid in UI. */
const showPauze = ref(false)
const showPrekidColumn = computed(() => auth.isAdmin && showPauze.value)

const month = ref(new Date().getMonth() + 1)
const year = ref(new Date().getFullYear())
const user = ref(null)
const days = ref([])
/** Days with display intervals / prekid derived once per load instead of on every render. */
const rows = computed(() =>
  days.value.map((d) => ({ ...d, intervals: formatSati(d), prekidText: prekidLabel(d) }))
)
const zbroj = ref({ ukupno: '00:00', total: '00:00', dodatno: '00:00' })
const branches = ref([])
const editing = ref(null)
const editForm = ref(emptyEditForm())
const editPeriodError = ref('')
const absenceOpen = ref(false)
const nightOpen = ref(false)
const saving = ref(false)
const odsustva = [
  'Godišnji odmor',
  'Praznici',
  'Bolovanje',
  'Porodiljni dopust',
  'Plaćeno odsustvo',
  'Neplaćeno odsustvo',
  'Odsustvo na zahtjev radnika',
  'Službeni put',
]
const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/

function emptyAbs() {
  return {
    pocetak: '',
    kraj: '',
    odsustvo: 'Godišnji odmor',
    odsustvo_time: '',
    napomena: '',
    branch_id: user.value?.branch_id || null,
    skip_saturday: false,
    skip_sunday: true,
  }
}
function emptyNight() {
  return {
    datum: '',
    start: '22:00',
    end: '06:00',
    branch_id: user.value?.branch_id || null,
    napomena: '',
    flatEight: false,
  }
}
function emptyEditForm() {
  return {
    periods: [{ start: '', end: '' }],
    odsustvo: '',
    odsustvo_time: '',
    napomena: '',
    branch_id: null,
    nocni_rad: false,
  }
}
const abs = ref(emptyAbs())
const night = ref(emptyNight())

function normalizeHm(value) {
  if (value == null || value === '') return ''
  const s = String(value).trim()
  if (/^\d{2}:\d{2}:\d{2}$/.test(s)) return s.slice(0, 5)
  return s
}

/** Parse API radni_sati pairs + optional temp (open/active interval) into edit pills. */
function parsePeriodsFromRecord(d) {
  const raw = d?.radni_sati || []
  const parts = Array.isArray(raw)
    ? raw.filter(Boolean).map(normalizeHm)
    : String(raw).trim().split(/\s+/).filter(Boolean).map(normalizeHm)
  const periods = []
  for (let i = 0; i + 1 < parts.length; i += 2) {
    periods.push({ start: parts[i], end: parts[i + 1] })
  }
  // Odd leftover token in radni_sati → treat as open start (rare/legacy)
  if (parts.length % 2 === 1) {
    periods.push({ start: parts[parts.length - 1], end: '' })
  }
  if (d?.temp) {
    periods.push({ start: normalizeHm(d.temp), end: '' })
  }
  if (!periods.length) periods.push({ start: '', end: '' })
  return periods
}

/**
 * Validate period pills and serialize for PUT /hours/:id.
 * Closed pairs → radni_sati "HH:mm HH:mm …"; open last start → temp.
 * Overnight (end < start) is allowed.
 */
function serializePeriods(periods) {
  const cleaned = (periods || []).map((p) => ({
    start: normalizeHm(p.start),
    end: normalizeHm(p.end),
  }))
  while (cleaned.length > 1 && !cleaned[cleaned.length - 1].start && !cleaned[cleaned.length - 1].end) {
    cleaned.pop()
  }
  if (cleaned.length === 1 && !cleaned[0].start && !cleaned[0].end) {
    return { ok: true, radni_sati: null, temp: null }
  }
  for (let i = 0; i < cleaned.length; i++) {
    const p = cleaned[i]
    const isLast = i === cleaned.length - 1
    const n = i + 1
    if (!p.start && !p.end) {
      return { ok: false, error: `Period ${n}: prazan period nije dopušten između ostalih. Uklonite ga ili unesite vrijeme.` }
    }
    if (!p.start && p.end) {
      return { ok: false, error: `Period ${n}: unesite početak (kraj bez početka nije valjan).` }
    }
    if (p.start && !HHMM_RE.test(p.start)) {
      return { ok: false, error: `Period ${n}: početak mora biti u formatu HH:mm.` }
    }
    if (p.end && !HHMM_RE.test(p.end)) {
      return { ok: false, error: `Period ${n}: kraj mora biti u formatu HH:mm.` }
    }
    if (!isLast) {
      if (!p.start || !p.end) {
        return { ok: false, error: `Period ${n}: svi periodi osim zadnjeg moraju imati početak i kraj.` }
      }
    } else if (!p.start) {
      return { ok: false, error: 'Zadnji period mora imati barem početak.' }
    }
  }
  const parts = []
  let temp = null
  cleaned.forEach((p, i) => {
    const isLast = i === cleaned.length - 1
    if (isLast && p.start && !p.end) {
      temp = p.start
    } else {
      parts.push(p.start, p.end)
    }
  })
  return {
    ok: true,
    radni_sati: parts.length ? parts.join(' ') : null,
    temp,
  }
}

function addPeriod() {
  if (!editForm.value.periods) editForm.value.periods = []
  editForm.value.periods.push({ start: '', end: '' })
  editPeriodError.value = ''
}

function removePeriod(idx) {
  if (!editForm.value.periods || editForm.value.periods.length <= 1) return
  editForm.value.periods.splice(idx, 1)
  editPeriodError.value = ''
}

/** Show absence / flat night label in Sati column when there are no work intervals. */
function absenceInSatiColumn(d) {
  if (!d?.odsustvo) return false
  if (d.temp) return false
  if (d.intervals.length) return false
  return true
}

/** True when the Odsustvo column would render any pill for this day. */
function odsustvoColumnHasContent(d) {
  if (!d) return false
  return Boolean(d.isNightShift || d.odsustvo || d.odsustvo_time)
}

/**
 * Non-duplicative Odsustvo: column has content that is NOT already shown in Sati.
 * Duplicate: absence-only days (absenceInSatiColumn) — same label/time already in Sati.
 * Non-duplicate examples: intervals + absence; night intervals + "Noćni"; odsustvo_time-only with empty Sati.
 */
function odsustvoIsNonDuplicative(d) {
  if (!odsustvoColumnHasContent(d)) return false
  // Absence-only: Sati already shows the same absence pill/label (+ time).
  if (absenceInSatiColumn(d)) return false
  return true
}

/**
 * Show Odsustvo column only when at least one day this month has Odsustvo
 * content that does not merely duplicate what Sati already shows.
 */
const showOdsustvoColumn = computed(() => rows.value.some((d) => odsustvoIsNonDuplicative(d)))

/** Colspan for "Zbroj" label: Dan + OJ + Sati + optional Prekid + optional Odsustvo. */
const zbrojLabelColspan = computed(() => {
  let n = 3
  if (showPrekidColumn.value) n += 1
  if (showOdsustvoColumn.value) n += 1
  return n
})

function hasOjName(value) {
  if (value == null) return false
  const name = String(value).trim()
  return name !== '' && name !== '-'
}

function formatSati(d) {
  const raw = d.radni_sati || []
  const parts = Array.isArray(raw) ? raw.filter(Boolean) : String(raw).trim().split(/\s+/).filter(Boolean)
  const intervals = []
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const start = parts[i]
    const end = parts[i + 1]
    const overnight = end < start
    intervals.push({
      start,
      end,
      overnight,
      label: overnight ? `${start}–${end} (noć)` : `${start}–${end}`,
    })
  }
  return intervals
}

/** Excel-style Prekid range from API, or empty when absent / '-'. */
function prekidLabel(d) {
  const p = d?.prekid
  if (p == null || p === '' || p === '-') return ''
  return String(p)
}

async function load() {
  try {
    const { data } = await api.get(`/hours/month/${userId.value}`, {
      params: { month: month.value, year: year.value },
    })
    user.value = data.user
    days.value = data.days
    zbroj.value = data.zbroj
  } catch (e) {
    setError(e)
  }
}

function openAbsence() {
  abs.value = emptyAbs()
  absenceOpen.value = true
}
function closeAbsence() {
  if (saving.value) return
  absenceOpen.value = false
  abs.value = emptyAbs()
}

function openNight() {
  night.value = emptyNight()
  nightOpen.value = true
}
function closeNight() {
  if (saving.value) return
  nightOpen.value = false
  night.value = emptyNight()
}

function closeEdit() {
  if (saving.value) return
  editing.value = null
  editForm.value = emptyEditForm()
  editPeriodError.value = ''
}

async function addAbsence() {
  if (saving.value) return
  saving.value = true
  try {
    await api.post('/hours', { mode: 'odsustvo', user_id: userId.value, ...abs.value })
    setSuccess('Odsustvo spremljeno')
    absenceOpen.value = false
    abs.value = emptyAbs()
    await load()
  } catch (e) {
    setError(e)
  } finally {
    saving.value = false
  }
}

async function addNightShift() {
  if (saving.value) return
  saving.value = true
  try {
    const payload = {
      mode: 'nocni_rad',
      user_id: userId.value,
      datum: night.value.datum,
      branch_id: night.value.branch_id,
      napomena: night.value.napomena,
    }
    if (!night.value.flatEight) {
      payload.start = night.value.start
      payload.end = night.value.end
    }
    await api.post('/hours', payload)
    setSuccess('Noćna smjena spremljena')
    nightOpen.value = false
    night.value = emptyNight()
    await load()
  } catch (e) {
    setError(e)
  } finally {
    saving.value = false
  }
}

function editRow(d) {
  editing.value = d
  editPeriodError.value = ''
  editForm.value = {
    periods: parsePeriodsFromRecord(d),
    odsustvo: d.odsustvo || '',
    odsustvo_time: d.odsustvo_time || '',
    napomena: d.napomena || '',
    branch_id: d.branch_id,
    nocni_rad: !!d.isNightShift || d.odsustvo === 'Noćni rad',
  }
}

async function saveEdit() {
  if (saving.value) return
  const serialized = serializePeriods(editForm.value.periods)
  if (!serialized.ok) {
    editPeriodError.value = serialized.error
    return
  }
  editPeriodError.value = ''
  saving.value = true
  try {
    // PUT expects radni_sati string (space-separated pairs) + temp for open last interval.
    await api.put(`/hours/${editing.value.id}`, {
      radni_sati: serialized.radni_sati,
      temp: serialized.temp,
      odsustvo: editForm.value.odsustvo,
      odsustvo_time: editForm.value.odsustvo_time,
      napomena: editForm.value.napomena,
      branch_id: editForm.value.branch_id,
      nocni_rad: editForm.value.nocni_rad,
    })
    editing.value = null
    editForm.value = emptyEditForm()
    setSuccess('Spremljeno')
    await load()
  } catch (e) {
    setError(e)
  } finally {
    saving.value = false
  }
}

async function removeEdit() {
  if (!confirm('Obrisati zapis?')) return
  if (saving.value) return
  saving.value = true
  try {
    await api.delete(`/hours/${editing.value.id}`)
    editing.value = null
    await load()
  } catch (e) {
    setError(e)
  } finally {
    saving.value = false
  }
}

async function exportExcel() {
  try {
    const uname = user.value?.username || userId.value
    await download(
      `/hours/export/${userId.value}`,
      `sati_${uname}_${month.value}_${year.value}.xlsx`,
      { month: month.value, year: year.value }
    )
    setSuccess('Excel preuzet')
  } catch (e) {
    setError(e)
  }
}

async function exportCsv() {
  try {
    const uname = user.value?.username || userId.value
    await download(
      `/hours/export/${userId.value}`,
      `sati_${uname}_${month.value}_${year.value}.csv`,
      { month: month.value, year: year.value, format: 'csv' }
    )
  } catch (e) {
    setError(e)
  }
}

onMounted(async () => {
  if (canEdit.value) {
    const { data } = await api.get('/branches')
    branches.value = data.branches
  }
  await load()
})
watch(() => route.params.id, load)
</script>

<style scoped>
.time-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
  align-items: center;
}
.time-pill {
  white-space: nowrap;
}
.oj-label {
  position: relative;
  cursor: help;
  border-bottom: 1px dotted currentColor;
}
.oj-label::before,
.oj-label::after {
  position: absolute;
  z-index: 1000;
  visibility: hidden;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.12s ease, visibility 0.12s ease;
}
.oj-label::before {
  content: '';
  left: 50%;
  bottom: calc(100% + 0.15rem);
  transform: translateX(-50%);
  border: 0.3rem solid transparent;
  border-top-color: #1f2937;
}
.oj-label::after {
  content: attr(data-tooltip);
  left: 50%;
  bottom: calc(100% + 0.45rem);
  transform: translateX(-50%);
  width: max-content;
  max-width: min(24rem, 80vw);
  padding: 0.35rem 0.55rem;
  border-radius: 0.35rem;
  background: #1f2937;
  color: #fff;
  font-size: 0.78rem;
  font-weight: 400;
  line-height: 1.25;
  white-space: normal;
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.22);
}
.oj-label:hover::before,
.oj-label:hover::after,
.oj-label:focus-visible::before,
.oj-label:focus-visible::after {
  visibility: visible;
  opacity: 1;
}
.prekid-pill {
  background: #fef3c7;
  color: #92400e;
}
tr.night td { background: #eef5ff; }
.night-pill { background: #1d4ed8; color: #fff; }
.absence-pill {
  background: #f3e8ff;
  color: #6b21a8;
  white-space: nowrap;
}
.period-field { flex: 1 1 100%; min-width: 100%; }
.period-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.period-pill {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 0.5rem;
  padding: 0.55rem 0.7rem;
  border-radius: 999px;
  background: #e8f7f0;
  border: 1px solid #c6e9d8;
}
.period-pill.open {
  background: #eef5ff;
  border-color: #bfdbfe;
}
.period-idx {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.6rem;
  height: 1.6rem;
  border-radius: 999px;
  background: var(--primary-dark, #085540);
  color: #fff;
  font-size: 0.75rem;
  font-weight: 700;
  margin-bottom: 0.15rem;
}
.period-times {
  flex: 1 1 110px;
  min-width: 110px;
}
.period-times label {
  margin-bottom: 0.15rem;
  font-size: 0.75rem;
}
.period-times input[type="time"] {
  min-width: 7.5rem;
}
.period-sep {
  font-weight: 700;
  color: var(--muted, #5b6b7c);
  margin-bottom: 0.45rem;
}
.period-remove {
  padding: 0.35rem 0.65rem;
  border-radius: 999px;
  margin-bottom: 0.1rem;
}
.period-actions {
  margin-top: 0.55rem;
}
</style>

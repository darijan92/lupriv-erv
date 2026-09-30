<template>
  <div>
    <div v-if="msg" class="alert" :class="msgType">{{ msg }}</div>

    <div class="card">
      <div class="row" style="justify-content:space-between;align-items:center;margin-bottom:0.75rem">
        <h2 style="margin:0">Korisnici</h2>
        <div class="row" style="align-items:center">
          <label class="checkbox-label">
            <input type="checkbox" v-model="includeInactive" @change="load" />
            Prikaži neaktivne
          </label>
          <button type="button" @click="openCreate">Dodaj zaposlenika</button>
        </div>
      </div>
      <div class="row" style="margin-bottom:0.75rem;align-items:center">
        <div class="field search-field">
          <label>Pretraga</label>
          <input
            v-model="search"
            type="search"
            placeholder="Pretraži po šifri ili nazivu…"
            autocomplete="off"
          />
        </div>
      </div>
      <p class="muted" style="margin-top:0">{{ users.length }} prikazano</p>
      <table>
        <thead>
          <tr>
            <th>
              <button type="button" class="th-sort" @click="setSort('sifra')">
                Šifra <span class="sort-ind">{{ sortIndicator('sifra') }}</span>
              </button>
            </th>
            <th>
              <button type="button" class="th-sort" @click="setSort('ime')">
                Ime <span class="sort-ind">{{ sortIndicator('ime') }}</span>
              </button>
            </th>
            <th>
              <button type="button" class="th-sort" @click="setSort('oj')">
                OJ <span class="sort-ind">{{ sortIndicator('oj') }}</span>
              </button>
            </th>
            <th>Uloga</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="u in users" :key="u.id" :class="{ neaktivni: !!u.datum_odlaska }">
            <td>{{ u.sifra }}</td>
            <td>{{ u.ime }} {{ u.prezime }}</td>
            <td :title="u.naziv_oj || undefined">{{ u.naziv_oj ? shortOj(u.naziv_oj) : '—' }}</td>
            <td>{{ u.role_name }}</td>
            <td class="actions">
              <button class="secondary" @click="openEdit(u)">Uredi</button>
              <router-link class="btn secondary" :to="`/admin/hours/${u.id}`">Sati</router-link>
              <button class="danger" @click="remove(u)">Obriši</button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="!users.length" class="muted">Nema korisnika za prikaz.</p>
    </div>

    <AppModal :open="modalOpen" :title="editing ? 'Uredi zaposlenika' : 'Dodaj zaposlenika'" @close="closeModal">
      <form class="stack" @submit.prevent="save">
        <div class="row">
          <div class="field"><label>Šifra</label><input v-model="form.sifra" required /></div>
          <div class="field"><label>Username</label><input v-model="form.username" required /></div>
          <div class="field"><label>Lozinka {{ editing ? '(prazno = bez promjene)' : '' }}</label><input v-model="form.password" type="password" :required="!editing" /></div>
        </div>
        <div class="row">
          <div class="field"><label>Ime</label><input v-model="form.ime" required /></div>
          <div class="field"><label>Prezime</label><input v-model="form.prezime" required /></div>
          <div class="field">
            <label>Uloga</label>
            <select v-model.number="form.role_id">
              <option v-for="r in roles" :key="r.id" :value="r.id">{{ r.naziv }} ({{ r.id }})</option>
            </select>
          </div>
          <div class="field">
            <label>Poslovnica</label>
            <select v-model="form.branch_id">
              <option :value="null">—</option>
              <option v-for="b in branches" :key="b.id" :value="b.id">{{ b.naziv_oj }}</option>
            </select>
          </div>
        </div>
        <div class="row">
          <div class="field"><label>Datum rođenja</label><input type="date" v-model="form.datum_rodjenja" /></div>
          <div class="field"><label>Datum zaposlenja</label><input type="date" v-model="form.datum_zaposlenja" /></div>
          <div class="field"><label>Datum odlaska</label><input type="date" v-model="form.datum_odlaska" /></div>
        </div>
        <div class="actions">
          <button type="submit">Spremi</button>
          <button type="button" class="secondary" @click="closeModal">Odustani</button>
        </div>
      </form>
    </AppModal>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import api from '../../api'
import AppModal from '../../components/AppModal.vue'
import { shortOj } from '../../utils/ojLabel'
import { useSortSearch } from '../../composables/useSortSearch'

const users = ref([])
const branches = ref([])
const roles = ref([])
const editing = ref(null)
const modalOpen = ref(false)
const msg = ref('')
const msgType = ref('success')
const includeInactive = ref(false)
const { sortField, sortOrder, search, searchQ, sortIndicator, setSort } = useSortSearch('oj', () => load())

const empty = () => ({
  sifra: '', username: '', password: '', ime: '', prezime: '',
  role_id: 1, branch_id: null, datum_rodjenja: '', datum_zaposlenja: '', datum_odlaska: '',
})
const form = ref(empty())

async function load() {
  const params = { sort: sortField.value, order: sortOrder.value }
  if (includeInactive.value) params.includeInactive = 1
  if (searchQ.value) params.q = searchQ.value
  users.value = (await api.get('/users', { params })).data.users
}

/** Branch + role dropdown options don't change on sort/search/save — fetch once. */
async function loadLookups() {
  const [b, r] = await Promise.all([api.get('/branches'), api.get('/users/roles')])
  branches.value = b.data.branches
  roles.value = r.data.roles
}

function openCreate() {
  editing.value = null
  form.value = empty()
  modalOpen.value = true
}

function openEdit(u) {
  editing.value = u.id
  form.value = {
    sifra: u.sifra, username: u.username, password: '', ime: u.ime, prezime: u.prezime,
    role_id: u.role_id, branch_id: u.branch_id,
    datum_rodjenja: u.datum_rodjenja || '', datum_zaposlenja: u.datum_zaposlenja || '',
    datum_odlaska: u.datum_odlaska || '',
  }
  modalOpen.value = true
}

function closeModal() {
  modalOpen.value = false
  editing.value = null
  form.value = empty()
}

async function save() {
  try {
    if (editing.value) {
      const payload = { ...form.value }
      if (!payload.password) delete payload.password
      await api.put(`/users/${editing.value}`, payload)
      msg.value = 'Korisnik ažuriran'
    } else {
      await api.post('/users', form.value)
      msg.value = 'Korisnik kreiran'
    }
    msgType.value = 'success'
    closeModal()
    await load()
  } catch (e) {
    msg.value = e.message
    msgType.value = 'error'
  }
}

async function remove(u) {
  if (!confirm(`Obrisati ${u.username}?`)) return
  await api.delete(`/users/${u.id}`)
  await load()
}

onMounted(() => Promise.all([load(), loadLookups()]))
</script>

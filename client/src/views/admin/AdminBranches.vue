<template>
  <div>
    <div v-if="msg" class="alert" :class="msgType">{{ msg }}</div>

    <div class="card">
      <div
        class="row"
        style="justify-content: space-between; align-items: center; margin-bottom: 0.75rem"
      >
        <h2 style="margin: 0">Poslovnice</h2>
        <button type="button" @click="openCreate">Dodaj poslovnicu</button>
      </div>
      <div class="row" style="margin-bottom: 0.75rem; align-items: center">
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
      <p class="muted" style="margin-top: 0">{{ branches.length }} prikazano</p>
      <table>
        <thead>
          <tr>
            <th>
              <button type="button" class="th-sort" @click="setSort('sifra')">
                Šifra <span class="sort-ind">{{ sortIndicator('sifra') }}</span>
              </button>
            </th>
            <th>
              <button type="button" class="th-sort" @click="setSort('oj')">
                Naziv / OJ <span class="sort-ind">{{ sortIndicator('oj') }}</span>
              </button>
            </th>
            <th>
              <button type="button" class="th-sort" @click="setSort('grad')">
                Grad <span class="sort-ind">{{ sortIndicator('grad') }}</span>
              </button>
            </th>
            <th>RV</th>
            <th>Voditelj</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="b in branches" :key="b.id">
            <td>{{ b.sifra }}</td>
            <td :title="b.naziv_oj || undefined">{{ b.naziv_oj }}</td>
            <td>{{ b.grad }}</td>
            <td>{{ b.pocetak_rv }}–{{ b.kraj_rv }}</td>
            <td>{{ b.voditelj_ime ? `${b.voditelj_ime} ${b.voditelj_prezime}` : '—' }}</td>
            <td class="actions">
              <button class="secondary" @click="openEdit(b)">Uredi</button>
              <button class="danger" @click="remove(b)">Obriši</button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="!branches.length" class="muted">Nema poslovnica za prikaz.</p>
    </div>

    <AppModal
      :open="modalOpen"
      :title="editing ? 'Uredi poslovnicu' : 'Dodaj poslovnicu'"
      @close="closeModal"
    >
      <form class="stack" @submit.prevent="save">
        <div class="row">
          <div class="field"><label>Šifra</label><input v-model="form.sifra" required /></div>
          <div class="field"><label>Naziv OJ</label><input v-model="form.naziv_oj" required /></div>
          <div class="field"><label>Adresa</label><input v-model="form.adresa" /></div>
        </div>
        <div class="row">
          <div class="field"><label>Grad</label><input v-model="form.grad" required /></div>
          <div class="field"><label>Županija</label><input v-model="form.zupanija" required /></div>
          <div class="field">
            <label>Početak RV</label
            ><input v-model="form.pocetak_rv" placeholder="07:00" required />
          </div>
          <div class="field">
            <label>Kraj RV</label><input v-model="form.kraj_rv" placeholder="20:00" required />
          </div>
        </div>
        <div class="row">
          <div class="field">
            <label>IP (opcionalno, legacy)</label
            ><input v-model="form.ip" placeholder="127.0.0.1" />
          </div>
          <div class="field">
            <label>Voditelj</label>
            <select v-model="form.voditelj_oj">
              <option :value="null">—</option>
              <option v-for="u in users" :key="u.id" :value="u.id">
                {{ u.ime }} {{ u.prezime }}
              </option>
            </select>
          </div>
          <label style="display: flex; gap: 0.5rem; align-items: center"
            ><input v-model="form.rad_nedjeljom" type="checkbox" style="width: auto" /> Rad
            nedjeljom</label
          >
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
import { ref, onMounted } from 'vue';
import api from '../../api';
import AppModal from '../../components/AppModal.vue';
import { useSortSearch } from '../../composables/useSortSearch';

const branches = ref([]);
const users = ref([]);
const editing = ref(null);
const modalOpen = ref(false);
const msg = ref('');
const msgType = ref('success');
const { sortField, sortOrder, search, searchQ, sortIndicator, setSort } = useSortSearch('sifra', () =>
  load()
);

const empty = () => ({
  sifra: '',
  naziv_oj: '',
  adresa: '',
  grad: '',
  zupanija: '',
  pocetak_rv: '07:00',
  kraj_rv: '20:00',
  rad_nedjeljom: false,
  voditelj_oj: null,
  ip: '',
});
const form = ref(empty());

async function load() {
  const params = { sort: sortField.value, order: sortOrder.value };
  if (searchQ.value) params.q = searchQ.value;
  branches.value = (await api.get('/branches', { params })).data.branches;
}

/** Voditelj dropdown options don't change on sort/search/save — fetch once. */
async function loadUsers() {
  users.value = (await api.get('/users', { params: { includeInactive: 1 } })).data.users;
}

function openCreate() {
  editing.value = null;
  form.value = empty();
  modalOpen.value = true;
}

function openEdit(b) {
  editing.value = b.id;
  form.value = {
    sifra: b.sifra,
    naziv_oj: b.naziv_oj,
    adresa: b.adresa || '',
    grad: b.grad,
    zupanija: b.zupanija,
    pocetak_rv: b.pocetak_rv,
    kraj_rv: b.kraj_rv,
    rad_nedjeljom: !!b.rad_nedjeljom,
    voditelj_oj: b.voditelj_oj,
    ip: b.ip || '',
  };
  modalOpen.value = true;
}

function closeModal() {
  modalOpen.value = false;
  editing.value = null;
  form.value = empty();
}

async function save() {
  try {
    if (editing.value) await api.put(`/branches/${editing.value}`, form.value);
    else await api.post('/branches', form.value);
    msg.value = 'Spremljeno';
    msgType.value = 'success';
    closeModal();
    await load();
  } catch (e) {
    msg.value = e.message;
    msgType.value = 'error';
  }
}

async function remove(b) {
  if (!confirm('Obrisati poslovnicu?')) return;
  try {
    await api.delete(`/branches/${b.id}`);
    msg.value = 'Poslovnica obrisana';
    msgType.value = 'success';
    await load();
  } catch (e) {
    // e.g. 409: the branch has employees or recorded hours and cannot be deleted
    msg.value = e.message;
    msgType.value = 'error';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

onMounted(() => Promise.all([load(), loadUsers()]));
</script>

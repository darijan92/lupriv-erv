<template>
  <div>
    <div v-if="msg" class="alert" :class="msgType">{{ msg }}</div>

    <div class="card">
      <div class="row" style="justify-content:space-between;align-items:center;margin-bottom:0.75rem">
        <h2 style="margin:0">Objave</h2>
        <button type="button" @click="openCreate">Dodaj objavu</button>
      </div>
      <div v-for="p in posts" :key="p.id" style="margin-bottom:1rem;border-bottom:1px solid #eee;padding-bottom:0.75rem">
        <strong>{{ p.naslov }}</strong>
        <div class="muted">{{ p.ime }} {{ p.prezime }} · {{ formatDate(p.created_at) }}</div>
        <div class="post-body" v-html="safeHtml(p.sadrzaj)"></div>
        <div class="actions">
          <button class="secondary" @click="openEdit(p)">Uredi</button>
          <button class="danger" @click="remove(p)">Obriši</button>
        </div>
      </div>
      <p v-if="!posts.length" class="muted">Nema objava.</p>
    </div>

    <AppModal :open="modalOpen" :title="editing ? 'Uredi objavu' : 'Dodaj objavu'" @close="closeModal">
      <form class="stack" @submit.prevent="save">
        <div>
          <label>Naslov</label>
          <input v-model="form.naslov" required />
        </div>
        <div>
          <label>Sadržaj</label>
          <RichTextEditor v-model="form.sadrzaj" />
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
import { safeHtml } from '../../utils/safeHtml'
import { ref, onMounted } from 'vue'
import api from '../../api'
import AppModal from '../../components/AppModal.vue'
import RichTextEditor from '../../components/RichTextEditor.vue'
import { formatDate } from '../../utils/formatDate'

const posts = ref([])
const editing = ref(null)
const modalOpen = ref(false)
const msg = ref('')
const msgType = ref('success')
const form = ref({ naslov: '', sadrzaj: '' })

function isEmptyHtml(html) {
  const text = String(html || '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim()
  return !text
}

async function load() {
  posts.value = (await api.get('/posts')).data.posts
}

function openCreate() {
  editing.value = null
  form.value = { naslov: '', sadrzaj: '' }
  modalOpen.value = true
}

function openEdit(p) {
  editing.value = p.id
  form.value = { naslov: p.naslov, sadrzaj: p.sadrzaj || '' }
  modalOpen.value = true
}

function closeModal() {
  modalOpen.value = false
  editing.value = null
  form.value = { naslov: '', sadrzaj: '' }
}

async function save() {
  try {
    if (!form.value.naslov.trim() || isEmptyHtml(form.value.sadrzaj)) {
      msg.value = 'Naslov i sadržaj su obavezni'
      msgType.value = 'error'
      return
    }
    if (editing.value) await api.put(`/posts/${editing.value}`, form.value)
    else await api.post('/posts', form.value)
    msg.value = 'Spremljeno'
    msgType.value = 'success'
    closeModal()
    await load()
  } catch (e) {
    msg.value = e.message
    msgType.value = 'error'
  }
}

async function remove(p) {
  if (!confirm('Obrisati?')) return
  await api.delete(`/posts/${p.id}`)
  await load()
}

onMounted(load)
</script>

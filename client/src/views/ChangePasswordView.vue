<template>
  <div class="card" style="max-width:480px;margin:2rem auto">
    <h1>Promjena lozinke</h1>
    <p v-if="auth.mustChangePassword" class="alert warn">
      Prije nastavka morate postaviti novu lozinku.
    </p>
    <div v-if="error" class="alert error">{{ error }}</div>
    <div v-if="info" class="alert success">{{ info }}</div>
    <form class="stack" @submit.prevent="submit">
      <div>
        <label>Trenutna lozinka</label>
        <input v-model="current" type="password" autocomplete="current-password" required />
      </div>
      <div>
        <label>Nova lozinka (barem 8 znakova)</label>
        <input v-model="next" type="password" autocomplete="new-password" minlength="8" required />
      </div>
      <div>
        <label>Ponovite novu lozinku</label>
        <input v-model="repeat" type="password" autocomplete="new-password" minlength="8" required />
      </div>
      <button type="submit" :disabled="busy">Spremi lozinku</button>
    </form>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const auth = useAuthStore()
const router = useRouter()
const current = ref('')
const next = ref('')
const repeat = ref('')
const error = ref('')
const info = ref('')
const busy = ref(false)

async function submit() {
  error.value = ''
  info.value = ''
  if (next.value !== repeat.value) {
    error.value = 'Nove lozinke se ne podudaraju'
    return
  }
  busy.value = true
  try {
    await auth.changePassword(current.value, next.value)
    info.value = 'Lozinka promijenjena'
    current.value = next.value = repeat.value = ''
    const u = auth.user
    if (auth.isAdmin) router.push('/admin')
    else if (auth.isModerator) router.push('/moderator')
    else if (u?.id) router.push(`/employee/${u.id}`)
  } catch (e) {
    error.value = e.message
  } finally {
    busy.value = false
  }
}
</script>

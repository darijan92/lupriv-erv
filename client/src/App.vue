<template>
  <div class="app">
    <header class="topbar">
      <div class="brand" @click="$router.push('/')">Lupriv — Evidencija sati</div>
      <nav>
        <router-link to="/">Početna</router-link>
        <router-link to="/login">Prijava</router-link>
        <router-link v-if="auth.isAdmin" to="/admin">Admin</router-link>
        <router-link v-if="auth.isModerator" to="/moderator">Voditelj</router-link>
        <router-link v-if="auth.isLoggedIn && auth.user?.id" :to="`/employee/${auth.user.id}`">Moji sati</router-link>
        <button v-if="auth.isLoggedIn" class="linkish" @click="doLogout">Odjava</button>
      </nav>
    </header>
    <main class="main">
      <router-view />
    </main>
  </div>
</template>

<script setup>
import { useRouter } from 'vue-router'
import { useAuthStore } from './stores/auth'

const auth = useAuthStore()
const router = useRouter()

function doLogout() {
  auth.logout()
  router.push('/login')
}
</script>

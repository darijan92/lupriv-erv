<template>
  <div>
    <div class="card">
      <h1>Administracija</h1>
      <nav class="actions">
        <router-link class="btn secondary" to="/admin">Korisnici</router-link>
        <router-link class="btn secondary" to="/admin/branches">Poslovnice</router-link>
        <router-link class="btn secondary" to="/admin/posts">Objave</router-link>
        <router-link class="btn secondary" to="/admin/active">Aktivne prijave</router-link>
        <router-link class="btn secondary" to="/admin/logs">Logovi</router-link>
        <router-link class="btn secondary" to="/admin/auto-logout">Automatske odjave</router-link>
      </nav>
    </div>
    <router-view />
  </div>
</template>

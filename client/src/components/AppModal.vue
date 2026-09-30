<template>
  <Teleport to="body">
    <div v-if="open" class="modal-backdrop" @click.self="emitClose">
      <div class="modal-dialog" role="dialog" aria-modal="true" :aria-label="title">
        <div class="modal-header">
          <h2>{{ title }}</h2>
          <button type="button" class="modal-close secondary" aria-label="Zatvori" @click="emitClose">×</button>
        </div>
        <div class="modal-body">
          <slot />
        </div>
        <div v-if="$slots.footer" class="modal-footer">
          <slot name="footer" />
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
defineProps({
  open: { type: Boolean, default: false },
  title: { type: String, default: '' },
})
const emit = defineEmits(['close'])
function emitClose() { emit('close') }
</script>

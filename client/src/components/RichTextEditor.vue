<template>
  <div class="rte">
    <div v-if="editor" class="rte-toolbar">
      <button type="button" class="secondary" :class="{ active: editor.isActive('bold') }" @click="editor.chain().focus().toggleBold().run()">B</button>
      <button type="button" class="secondary" :class="{ active: editor.isActive('italic') }" @click="editor.chain().focus().toggleItalic().run()"><em>I</em></button>
      <button type="button" class="secondary" :class="{ active: editor.isActive('strike') }" @click="editor.chain().focus().toggleStrike().run()"><s>S</s></button>
      <button type="button" class="secondary" :class="{ active: editor.isActive('bulletList') }" @click="editor.chain().focus().toggleBulletList().run()">• Lista</button>
      <button type="button" class="secondary" :class="{ active: editor.isActive('orderedList') }" @click="editor.chain().focus().toggleOrderedList().run()">1. Lista</button>
      <button type="button" class="secondary" :class="{ active: editor.isActive('heading', { level: 2 }) }" @click="editor.chain().focus().toggleHeading({ level: 2 }).run()">H2</button>
      <button type="button" class="secondary" :class="{ active: editor.isActive('heading', { level: 3 }) }" @click="editor.chain().focus().toggleHeading({ level: 3 }).run()">H3</button>
      <button type="button" class="secondary" @click="editor.chain().focus().unsetAllMarks().clearNodes().run()">Očisti</button>
    </div>
    <editor-content :editor="editor" class="rte-content" />
  </div>
</template>

<script setup>
import { watch, onBeforeUnmount } from 'vue'
import { useEditor, EditorContent } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'

const props = defineProps({
  modelValue: { type: String, default: '' },
})
const emit = defineEmits(['update:modelValue'])

const editor = useEditor({
  content: props.modelValue || '',
  extensions: [StarterKit],
  onUpdate: ({ editor: ed }) => {
    emit('update:modelValue', ed.getHTML())
  },
})

watch(() => props.modelValue, (val) => {
  if (!editor.value) return
  const current = editor.value.getHTML()
  if (val !== current) editor.value.commands.setContent(val || '', false)
})

onBeforeUnmount(() => {
  editor.value?.destroy()
})
</script>

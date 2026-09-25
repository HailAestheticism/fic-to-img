<script setup lang="ts">
defineProps<{ name: 'mobile' | 'web' | 'book' | 'paper' | 'menu' | 'folder'; size?: number }>()
</script>

<template>
  <svg
    :width="size ?? 16"
    :height="size ?? 16"
    viewBox="0 0 24 24"
    fill="currentColor"
    aria-hidden="true"
  >
    <template v-if="name === 'mobile'">
      <path fill-rule="evenodd" d="M7 2.5h10A1.5 1.5 0 0 1 18.5 4v16a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 20V4A1.5 1.5 0 0 1 7 2.5Zm1.5 3.4v12.2h7V5.9h-7Zm2 14.1h3v1.3h-3v-1.3Z" />
    </template>
    <template v-else-if="name === 'web'">
      <path fill-rule="evenodd" d="M3.5 3.5h17A1.5 1.5 0 0 1 22 5v11a1.5 1.5 0 0 1-1.5 1.5h-6.6l.7 2.1H17v1.7H7v-1.7h2.4l.7-2.1H3.5A1.5 1.5 0 0 1 2 16V5a1.5 1.5 0 0 1 1.5-1.5ZM5 6.3v8h14v-8H5Z" />
    </template>
    <template v-else-if="name === 'book'">
      <path d="M11.2 6.4C9.7 5.2 7.3 4.5 4.4 4.5c-.5 0-.9.4-.9.9v11.7c0 .5.4.9.9.9 2.9 0 5.3.7 6.8 1.9.5.4 1.2 0 1.2-.6V7c0-.2-.1-.4-.2-.6Z" />
      <path d="M12.8 6.4C14.3 5.2 16.7 4.5 19.6 4.5c.5 0 .9.4.9.9v11.7c0 .5-.4.9-.9.9-2.9 0-5.3.7-6.8 1.9-.5.4-1.2 0-1.2-.6V7c0-.2.1-.4.2-.6Z" />
    </template>
    <template v-else-if="name === 'paper'">
      <path fill-rule="evenodd" d="M5.5 2.5h9.2L20 7.8V21.5H5.5V2.5Zm2 2v15h10.5V9.5h-4.7v-5H7.5Z" />
      <path d="M15.3 3.6v4.4h4.2l-4.2-4.4Z" />
    </template>
    <template v-else-if="name === 'menu'">
      <circle cx="5.5" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="18.5" cy="12" r="2" />
    </template>
    <template v-else>
      <path fill-rule="evenodd" d="M2.5 4.5c0-.8.7-1.5 1.5-1.5h4.6c.6 0 1.1.3 1.4.8l.9 1.4h9.1c.8 0 1.4.7 1.4 1.5v3H2.5v-5.2Zm0 6.7h19v8.3c0 .8-.6 1.5-1.4 1.5H4c-.8 0-1.5-.7-1.5-1.5v-8.3Zm3.2 1.8v4.8h12.6v-4.8H5.7Z" />
    </template>
  </svg>
</template>

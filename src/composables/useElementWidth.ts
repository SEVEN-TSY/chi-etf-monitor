import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue'

export function useElementWidth(element: Ref<HTMLElement | null>) {
  const width = ref(736)
  let observer: ResizeObserver | undefined
  onMounted(() => {
    observer = new ResizeObserver(([entry]) => {
      if (entry && entry.contentRect.width > 0) width.value = entry.contentRect.width
    })
    if (element.value) observer.observe(element.value)
  })
  onBeforeUnmount(() => observer?.disconnect())
  return width
}

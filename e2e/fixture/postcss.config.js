// Tailwind must actually COMPILE in the fixture. Without it the utility classes
// are inert, and while a single edit still asserts fine (the suite reads source
// bytes), the round trip does not close: the properties panel seeds its fields
// from COMPUTED style, so after writing `text-[length:20px]` the element would
// still measure the browser default and a second edit would start from 16px
// again. Any spec that edits the same element twice depends on this file.
export default {
  plugins: { tailwindcss: {}, autoprefixer: {} },
}

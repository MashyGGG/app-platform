import type { Config } from 'tailwindcss'

export default {
  content: ['./src/**/*.{ts,tsx}'],
  // Ant Design ships its own CSS reset. Tailwind's preflight would fight it
  // (buttons, headings, borders), so we keep Tailwind for layout/spacing only.
  corePlugins: { preflight: false },
  theme: { extend: {} },
  plugins: [],
} satisfies Config

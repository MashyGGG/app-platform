import typography from '@tailwindcss/typography'
import type { Config } from 'tailwindcss'

export default {
  content: ['./src/**/*.{ts,tsx}'],
  // Follows the OS. There is no theme toggle on purpose: a toggle needs client
  // JS and localStorage on a site whose entire payload is otherwise static HTML.
  darkMode: 'media',
  // Unlike app-web / admin-web this app ships NO Ant Design, so there is no
  // competing CSS reset and Tailwind's preflight stays ON — a content site
  // wants the typography plugin's defaults, not antd's form-oriented ones.
  theme: {
    extend: {
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [typography],
} satisfies Config

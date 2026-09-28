import type { Config } from 'tailwindcss'
import { heroui } from '@heroui/react'

// Shared design tokens from docs/design_handoff_admin_dashboard/README.md.
// Tenant-specific colors are NOT here — those vary per tenant and are emitted
// as CSS custom properties at request time by TenantThemeStyle.
const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
    './node_modules/@heroui/theme/dist/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        // Headings. Body/UI text keeps the system stack (Tailwind's default
        // `font-sans`), which the handoff specifies separately.
        display: ['var(--font-manrope)', 'system-ui', 'sans-serif'],
      },
      colors: {
        // Per-tenant colors, resolved from the CSS variables TenantThemeStyle
        // emits. They exist as Tailwind colors so utilities like
        // `hover:bg-tenant-primary-hover` work; the actual value still varies
        // per tenant at runtime.
        tenant: {
          primary: 'hsl(var(--tenant-primary))',
          'primary-hover': 'hsl(var(--tenant-primary-hover))',
          'primary-tint': 'hsl(var(--tenant-primary-tint))',
          'primary-tint-text': 'hsl(var(--tenant-primary-tint-text))',
          secondary: 'hsl(var(--tenant-secondary))',
          'accent-tint': 'hsl(var(--tenant-accent-tint))',
          'accent-tint-text': 'hsl(var(--tenant-accent-tint-text))',
        },
        ink: {
          DEFAULT: '#111827', // body text
          soft: '#374151', // secondary text
          muted: '#4B5563', // secondary text, lighter
          label: '#5B6472', // labels
          faint: '#8A93A1', // uppercase section labels, help text
        },
        edge: {
          field: '#8C94A1', // field borders — 3:1 vs white
          DEFAULT: '#E3E6EB', // dividers, card borders
          soft: '#EEF0F3', // lighter dividers
        },
        danger: {
          text: '#B91C1C', // destructive list actions
          solid: '#BE123C', // destructive modal button
          hover: '#9F1239',
        },
      },
      borderRadius: {
        card: '16px',
        'card-sm': '14px',
        control: '9px',
      },
      boxShadow: {
        card: '0 1px 2px rgba(17,24,39,0.03)',
        modal: '0 24px 48px -12px rgba(17,24,39,0.25)',
      },
      letterSpacing: {
        tight: '-0.02em', // headings
        label: '0.1em', // uppercase section labels
        'label-wide': '0.12em',
      },
    },
  },
  plugins: [heroui()],
}
export default config

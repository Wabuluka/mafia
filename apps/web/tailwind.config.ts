import type { Config } from 'tailwindcss';

// ---------------------------------------------------------------------------
// Design system foundation. Two layers:
//
// 1. A custom daisyUI theme ("mafia", defined below in `daisyui.themes`)
//    supplying the base palette daisyUI's own components read
//    (primary/secondary/accent/base-100.../success/warning/error). This is
//    a genuinely dark theme, not "dark mode as an afterthought":
//    desaturated, low-luminance surfaces suited to a game actually played
//    in a dim room at night, where a bright white card would be startling
//    and would blow out night vision at a table.
//
// 2. Semantic tokens layered on top via `theme.extend.colors`, each backed
//    by a CSS custom property (defined inline on the same "mafia" theme
//    object, so every component uses `bg-surface` / `text-mafia-accent` /
//    etc. instead of a raw Tailwind color name scattered through the tree).
//    The naming is deliberately about ROLE, not hue: `mafia-accent`
//    documents intent ("this is the mafia-coded color") in a way
//    `bg-rose-900` never would, and lets the actual color shift later
//    without touching a single component.
//
//      surface         — the base app background (darkest layer)
//      elevated         — a card/tile/panel sitting above `surface`
//      elevated-2         — a modal/sheet sitting above `elevated` (two
//                            steps of elevation is enough for this app's
//                            depth — lobby card, then a modal over it)
//      danger            — destructive/lethal actions and dead-state UI
//      mafia-accent        — anything coded as "mafia team" (their private
//                              chat, their role reveal, their kill target UI)
//      village-accent         — anything coded as "town team" (day-phase
//                                 chrome, votes, the detective's clue color)
// ---------------------------------------------------------------------------

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        surface: 'hsl(var(--color-surface) / <alpha-value>)',
        elevated: 'hsl(var(--color-elevated) / <alpha-value>)',
        'elevated-2': 'hsl(var(--color-elevated-2) / <alpha-value>)',
        danger: 'hsl(var(--color-danger) / <alpha-value>)',
        'mafia-accent': 'hsl(var(--color-mafia-accent) / <alpha-value>)',
        'village-accent': 'hsl(var(--color-village-accent) / <alpha-value>)',
      },
      // A type scale tuned for "read at arm's length, in the dark, on a
      // phone passed around a table" — not a desktop article scale. Every
      // step stays well clear of the 16px iOS zoom-on-focus threshold (see
      // globals.css's form-control rule, which is the actual enforcement
      // point for inputs specifically); this scale is about legibility at
      // distance and thumb-driven scanning, not just avoiding that bug.
      fontSize: {
        xs: ['0.8125rem', { lineHeight: '1.25rem' }], // 13px — timestamps, meta only, never primary content
        sm: ['0.9375rem', { lineHeight: '1.375rem' }], // 15px — secondary text
        base: ['1rem', { lineHeight: '1.5rem' }], // 16px — body floor, also the iOS zoom-on-focus threshold
        lg: ['1.125rem', { lineHeight: '1.625rem' }], // 18px — emphasized body / player names
        xl: ['1.375rem', { lineHeight: '1.75rem', letterSpacing: '-0.01em' }], // 22px — section headers
        '2xl': ['1.75rem', { lineHeight: '2.125rem', letterSpacing: '-0.015em' }], // 28px — phase banner
        '3xl': ['2.25rem', { lineHeight: '2.5rem', letterSpacing: '-0.02em' }], // 36px — countdown numeral
      },
      spacing: {
        // iOS/Android safe-area insets, exposed as spacing utilities
        // (`pt-safe-top`, `pb-safe-bottom`, ...) so the app shell can pad
        // around the notch/home-indicator without hardcoding `env()` calls
        // in every component that touches a screen edge.
        'safe-top': 'env(safe-area-inset-top, 0px)',
        'safe-bottom': 'env(safe-area-inset-bottom, 0px)',
        'safe-left': 'env(safe-area-inset-left, 0px)',
        'safe-right': 'env(safe-area-inset-right, 0px)',
      },
      // dvh = "dynamic viewport height": resolves the mobile browser
      // URL-bar resize problem (`100vh` is the LARGEST possible viewport on
      // iOS Safari/Chrome, so a `100vh` element gets cut off behind the
      // address bar until the page scrolls). `100dvh` tracks the CURRENT
      // visible viewport as chrome shows/hides. Exposed as both height and
      // min-height utilities since the shell needs the exact height (to
      // prevent double-scrolling) while some full-bleed screens only need
      // a floor.
      height: {
        dvh: '100dvh',
      },
      minHeight: {
        dvh: '100dvh',
      },
      // Every animation in this app is transform/opacity only (see the
      // component files) — these keyframes exist once, centrally, so no
      // component hand-rolls a slightly-different bespoke transition.
      keyframes: {
        'sheet-in': {
          from: { transform: 'translateY(100%)' },
          to: { transform: 'translateY(0)' },
        },
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'scale-in': {
          from: { opacity: '0', transform: 'scale(0.96)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        'toast-in': {
          from: { opacity: '0', transform: 'translateY(-0.5rem) scale(0.98)' },
          to: { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        'ring-pulse': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.55' },
        },
      },
      animation: {
        'sheet-in': 'sheet-in 0.24s cubic-bezier(0.32, 0.72, 0, 1)',
        'fade-in': 'fade-in 0.18s ease-out',
        'scale-in': 'scale-in 0.18s ease-out',
        'toast-in': 'toast-in 0.22s cubic-bezier(0.32, 0.72, 0, 1)',
        'ring-pulse': 'ring-pulse 1.6s ease-in-out infinite',
      },
    },
  },
  // daisyUI on top of Tailwind, per spec: gives us accessible, pre-styled
  // components (buttons, modals, alerts) so we spend the JS budget on game
  // logic, not a component library. Only the custom "mafia" theme is
  // registered — no default light theme, since this app never runs one;
  // "dark theme suited to a game played in dim rooms" is the only mode.
  plugins: [require('daisyui')],
  daisyui: {
    themes: [
      {
        mafia: {
          'color-scheme': 'dark',
          // A cold, desaturated near-black — not a warm neutral gray —
          // reads as "night" rather than "just a dark UI skin".
          'base-100': '#0b0d12',
          'base-200': '#12151c',
          'base-300': '#1a1e27',
          'base-content': '#d7dae2',
          // Primary: a muted lantern amber — the one warm note against an
          // otherwise cold palette, reserved for primary actions (the
          // thing you're meant to actually tap), so it reads as
          // "the warm light in a dark room" rather than blending into chrome.
          primary: '#e0a94d',
          'primary-content': '#1a1206',
          secondary: '#8b93a7',
          'secondary-content': '#0b0d12',
          accent: '#7c9cff',
          'accent-content': '#0b0d12',
          neutral: '#1a1e27',
          'neutral-content': '#a8adba',
          info: '#6fb3d8',
          success: '#5fae72',
          warning: '#d7a13a',
          error: '#d3574f',
          // The custom semantic tokens (see tailwind.config.ts's `colors`
          // extension above, which reads these as HSL components — kept as
          // bare "H S% L%" triples, no hsl()/alpha, so Tailwind's
          // <alpha-value> opacity modifiers (`bg-surface/50`) work).
          '--color-surface': '222 22% 6%',
          '--color-elevated': '222 18% 11%',
          '--color-elevated-2': '222 16% 15%',
          '--color-danger': '4 62% 55%',
          '--color-mafia-accent': '355 65% 52%',
          '--color-village-accent': '203 55% 58%',
        },
      },
    ],
    darkTheme: 'mafia',
  },
};

export default config;

import type { Config } from 'tailwindcss';

/**
 * Same token names and brand palette as the web application, so a colour means
 * the same thing in both. What differs is sizing: this app is designed for a
 * thumb on a 390px screen, so touch targets and safe-area insets are part of
 * the theme rather than one-off classes.
 */
const config: Config = {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        success: {
          DEFAULT: 'hsl(var(--success))',
          foreground: 'hsl(var(--success-foreground))',
        },
        warning: {
          DEFAULT: 'hsl(var(--warning))',
          foreground: 'hsl(var(--warning-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        // The condensed face, for headings and large figures. Its fallback is
        // a condensed system face rather than the sans stack, so a heading
        // keeps roughly its width if the webfont never arrives.
        display: [
          'var(--font-display)',
          'ui-sans-serif',
          'Helvetica Neue',
          'Arial Narrow',
          'sans-serif',
        ],
      },
      spacing: {
        // The iOS home indicator and Android gesture bar overlap the bottom of
        // the viewport; the tab bar and any fixed footer pad past them.
        'safe-bottom': 'env(safe-area-inset-bottom, 0px)',
        'safe-top': 'env(safe-area-inset-top, 0px)',
        tabbar: '4.25rem',
      },
      minHeight: {
        // The floor for anything tappable. Below this, thumbs miss.
        touch: '2.75rem',
      },
      minWidth: {
        touch: '2.75rem',
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'none' },
        },
        'slide-up': {
          from: { transform: 'translateY(100%)' },
          to: { transform: 'none' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
        'flash-price': {
          '0%': { backgroundColor: 'hsl(var(--warning) / 0.25)' },
          '100%': { backgroundColor: 'transparent' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.2s ease-out',
        'slide-up': 'slide-up 0.22s cubic-bezier(0.32, 0.72, 0, 1)',
        shimmer: 'shimmer 1.6s infinite',
        'flash-price': 'flash-price 1s ease-out',
      },
    },
  },
  plugins: [],
};

export default config;

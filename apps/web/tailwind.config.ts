import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        pitch: {
          900: '#0a1f14',
          800: '#0f2e1d',
          700: '#164a2e',
          500: '#22c55e',
          400: '#4ade80',
        },
        usdc: '#2775CA',
      },
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      animation: {
        'fade-in': 'fadeIn 0.4s ease-out forwards',
        'slide-in': 'slideIn 0.3s ease-out forwards',
        'pulse-dot': 'pulseDot 2s ease-in-out infinite',
        'pulse-glow': 'pulseGlow 2s ease-in-out infinite',
        'shimmer': 'shimmer 2s linear infinite',
        'breathe': 'breathe 4s ease-in-out infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideIn: {
          '0%': { opacity: '0', transform: 'translateX(-12px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        pulseDot: {
          '0%, 100%': { opacity: '1', transform: 'scale(1)' },
          '50%': { opacity: '0.5', transform: 'scale(0.8)' },
        },
        pulseGlow: {
          '0%, 100%': { boxShadow: '0 0 8px rgba(34, 197, 94, 0.3)' },
          '50%': { boxShadow: '0 0 20px rgba(34, 197, 94, 0.6)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        breathe: {
          '0%, 100%': { opacity: '0.6' },
          '50%': { opacity: '1' },
        },
      },
    },
  },
  plugins: [],
};

export default config;

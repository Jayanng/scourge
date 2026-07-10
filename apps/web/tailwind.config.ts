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
    },
  },
  plugins: [],
};

export default config;

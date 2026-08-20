import type { Metadata } from 'next';
import './globals.css';
import { Providers } from '@/components/Providers';

export const metadata: Metadata = {
  title: 'Kickoff Protocol',
  description:
    'Autonomous agent swarm for World Cup micro-markets — native to Injective',
  verification: {
    other: {
      'ory-verify': 'orynth-6802326fe0614252ae0e3845a8dfaed2',
    },
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased font-sans">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

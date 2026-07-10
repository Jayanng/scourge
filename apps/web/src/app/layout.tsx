import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Kickoff Protocol',
  description:
    'Autonomous agent swarm for World Cup micro-markets — native to Injective',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased font-sans">{children}</body>
    </html>
  );
}

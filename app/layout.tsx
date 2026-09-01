import type { Metadata } from 'next';
import './globals.css';

const publicOrigin = process.env.OPENWOOD_PUBLIC_ORIGIN ?? 'http://localhost:3000';

export const metadata: Metadata = {
  metadataBase: new URL(publicOrigin),
  title: 'OpenWood — Micro-Drama Studio',
  description:
    'An open-source production house for developing, producing, and screening cinematic micro-dramas.',
  applicationName: 'OpenWood',
  openGraph: {
    title: 'OpenWood — The Micro-Drama Studio',
    description: 'From premise to premiere: a cinematic, open-source production house powered by a resident company of specialist agents.',
    type: 'website',
    images: [{ url: '/og.png', width: 1673, height: 941, alt: 'OpenWood micro-drama studio on a stormy coast' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'OpenWood — The Micro-Drama Studio',
    description: 'From premise to premiere.',
    images: ['/og.png'],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

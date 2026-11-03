import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Project Context AI · Local Chat',
  description: 'Authenticated local model chat with a replaceable inference provider',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

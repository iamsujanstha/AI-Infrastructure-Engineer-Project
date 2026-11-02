import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Local AI Platform · System Health',
  description: 'Private AI infrastructure control plane',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

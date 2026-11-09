import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'People · Employee workspace',
  description: 'Local employee workspace for policy documents, leave, and payroll records',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

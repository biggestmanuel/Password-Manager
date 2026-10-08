import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Vault',
  description: 'Zero-knowledge password manager',
  // A password manager should never be indexed, cached by a proxy, or
  // embedded in a third-party frame.
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
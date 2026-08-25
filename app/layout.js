import './globals.css';

export const metadata = {
  title: 'Vault',
  description: 'A minimal password manager to learn hashing vs encryption.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}

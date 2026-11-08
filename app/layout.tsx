import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Blast Movement Viewer',
  description:
    'Concept prototype: a synthetic gold bench, a heuristic blast movement model, and ore loss / dilution against original and adjusted dig lines.',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex h-full flex-col">{children}</body>
    </html>
  );
}

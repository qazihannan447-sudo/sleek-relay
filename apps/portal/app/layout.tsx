import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import './globals.css';

export const metadata: Metadata = {
  title: 'Sleek Relay Portal',
  description: 'Portal for the Sleek Relay browser validation demo.',
};

type RootLayoutProps = {
  children: ReactNode;
};

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="en">
      <body className="app-shell">{children}</body>
    </html>
  );
}

import type {Metadata} from 'next';
import {Providers} from './providers';
import './globals.css';

export const metadata: Metadata = {
  title: 'App',
  description: 'Scaffolded by the react-native (stack) skill',
};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

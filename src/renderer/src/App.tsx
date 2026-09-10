import React from 'react';
import { AppShell } from './app/AppShell';
import { Providers } from './app/Providers';

export function App(): React.JSX.Element {
  return (
    <Providers>
      <AppShell />
    </Providers>
  );
}

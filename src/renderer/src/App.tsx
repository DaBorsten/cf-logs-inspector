import React, { useEffect, useState } from 'react';

export function App(): React.JSX.Element {
  const [version, setVersion] = useState<string>('…');
  useEffect(() => {
    void window.api.invoke('app:version', undefined).then((r) => {
      if (r.ok) setVersion(r.value);
    });
  }, []);
  return (
    <main style={{ fontFamily: 'system-ui', padding: 16 }}>
      <h1>cf-log-inspector</h1>
      <p>Scaffold running. Version {version}</p>
    </main>
  );
}

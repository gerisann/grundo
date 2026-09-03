import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import { watchChunkLoadErrors } from './lib/chunkReload';
import './styles/global.css';
import './components/ui/ui.css';

// Az index.html indítási őrének jelezzük, hogy a JavaScript modul betöltődött.
document.documentElement.dataset.grundoBooted = 'true';

/**
 * Telepítés közben nyitva hagyott app: a lustán töltött képernyők a RÉGI
 * chunk-nevet kérnék, ami már nincs kiszolgálva. Egyetlen újratöltés megoldja
 * — a részletek és a huroktörés a `chunkReload.ts`-ben.
 */
watchChunkLoadErrors();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

const root = document.getElementById('root');
if (!root) throw new Error('#root nem található');

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <AppErrorBoundary>
        <App />
      </AppErrorBoundary>
    </QueryClientProvider>
  </React.StrictMode>,
);

import { createContext, useContext, type ReactNode } from 'react';
import type { TilesResult } from '@/lib/api';

export interface TrackingView {
  south: number;
  west: number;
  north: number;
  east: number;
  zoom: number;
}

export interface TrackingEnvironment {
  mode: 'production' | 'lab';
  /** LAB-nál látványos fejléc; productionben nincs. */
  label?: string;
  detail?: string;
  /** Tétlen térkép indulási pontja. */
  initialPosition?: { lat: number; lng: number } | null;
  /** Productionben API tiles; LAB-ban sandbox world adapter. */
  loadTiles?: (layer: 'foot' | 'bike', view: TrackingView) => Promise<TilesResult>;
  /** LAB-ban a telefon/browser valós pozícióját és cloud pozícióját sem kérjük. */
  sharedPositionEnabled?: boolean;
}

const TrackingEnvironmentContext = createContext<TrackingEnvironment | null>(null);

export function TrackingEnvironmentProvider({
  value,
  children,
}: {
  value: TrackingEnvironment;
  children: ReactNode;
}) {
  return (
    <TrackingEnvironmentContext.Provider value={value}>
      {children}
    </TrackingEnvironmentContext.Provider>
  );
}

export function useTrackingEnvironment(): TrackingEnvironment {
  return useContext(TrackingEnvironmentContext) ?? {
    mode: 'production',
    sharedPositionEnabled: true,
  };
}

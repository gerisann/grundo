import { createContext, useContext, type ReactNode } from 'react';
import type { ActivityPhoto, TilesResult } from '@/lib/api';

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
  /**
   * A LEÍRÓ MEZŐK MENTÉSE — a mentőlap „Mentés" gombja mögött.
   *
   * ⚠️ A LAB-nak KÖTELEZŐ megadnia. A sandbox aktivitás csak a böngészőben
   * létezik, ezért a production `PATCH /api/activities/:id` hívás „Nincs
   * ilyen aktivitás." hibával szállt el — a mentés volt az egyetlen lépés,
   * amit a LAB nem tudott végigjátszani (Geri jelezte, 2026-09-03).
   */
  saveActivity?: (
    activityId: string,
    patch: { title: string; description: string; photos: ActivityPhoto[] },
  ) => Promise<void>;
  /**
   * Feltölthet-e a felhasználó képet.
   *
   * LAB-ban `false`: a fotók VALÓDI Storage-ba mennének, tehát egy sandbox
   * teszt éles tárhelyet szemetelne tele. A mentés minden más lépése
   * ugyanaz marad.
   */
  photosEnabled?: boolean;
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

/** Eszközhöz kötött térkép- és renderelési beállítások. */

export type GraphicsQuality = 'low' | 'medium' | 'high' | 'ultra';

export interface GraphicsSettings {
  quality: GraphicsQuality;
  /** A rögzítés alatt kirajzolható tartalom legnagyobb sugara a pozíciótól. */
  renderRadiusM: number;
  /** A bedöntött kamera hozzávetőleges fizikai látótávolsága. */
  viewingDistanceM: number;
}

export interface GraphicsProfile {
  viewportBufferRatio: number;
  routePointStride: number;
  trackSyncIntervalMs: number;
  cellDetailMinZoom: number;
  areaDetailMinZoom: number;
  defenseLabelMinZoom: number;
  sourceTolerance: number;
  sourceMaxZoom: number;
  maxTileCacheSize: number;
  motionScale: number;
  showFreeGrid: boolean;
  showDefenseLabels: boolean;
  showExtrusions: boolean;
  showMinorSymbols: boolean;
  antialias: boolean;
  routeWidth: number;
}

export const MIN_RENDER_RADIUS_M = 250;
export const MAX_RENDER_RADIUS_M = 2_000;
export const RENDER_RADIUS_STEP_M = 50;
export const MIN_VIEWING_DISTANCE_M = 250;
export const MAX_VIEWING_DISTANCE_M = 5_000;
export const VIEWING_DISTANCE_STEP_M = 50;

export const DEFAULT_GRAPHICS_SETTINGS: GraphicsSettings = {
  quality: 'high',
  renderRadiusM: 750,
  viewingDistanceM: 1_000,
};

export const GRAPHICS_PROFILES: Record<GraphicsQuality, GraphicsProfile> = {
  low: {
    viewportBufferRatio: 0.08,
    routePointStride: 4,
    trackSyncIntervalMs: 5_000,
    cellDetailMinZoom: 16,
    areaDetailMinZoom: 15,
    defenseLabelMinZoom: 18,
    sourceTolerance: 1,
    sourceMaxZoom: 18,
    maxTileCacheSize: 24,
    motionScale: 0,
    showFreeGrid: false,
    showDefenseLabels: false,
    showExtrusions: false,
    showMinorSymbols: false,
    antialias: false,
    routeWidth: 3,
  },
  medium: {
    viewportBufferRatio: 0.12,
    routePointStride: 2,
    trackSyncIntervalMs: 4_000,
    cellDetailMinZoom: 15.5,
    areaDetailMinZoom: 14.5,
    defenseLabelMinZoom: 17,
    sourceTolerance: 0.5,
    sourceMaxZoom: 20,
    maxTileCacheSize: 40,
    motionScale: 0.65,
    showFreeGrid: true,
    showDefenseLabels: true,
    showExtrusions: false,
    showMinorSymbols: true,
    antialias: false,
    routeWidth: 3.5,
  },
  high: {
    viewportBufferRatio: 0.2,
    routePointStride: 1,
    trackSyncIntervalMs: 3_000,
    cellDetailMinZoom: 15,
    areaDetailMinZoom: 14,
    defenseLabelMinZoom: 15,
    sourceTolerance: 0,
    sourceMaxZoom: 22,
    maxTileCacheSize: 64,
    motionScale: 1,
    showFreeGrid: true,
    showDefenseLabels: true,
    showExtrusions: true,
    showMinorSymbols: true,
    antialias: false,
    routeWidth: 4,
  },
  ultra: {
    viewportBufferRatio: 0.3,
    routePointStride: 1,
    trackSyncIntervalMs: 1_500,
    cellDetailMinZoom: 14.5,
    areaDetailMinZoom: 13.5,
    defenseLabelMinZoom: 14.5,
    sourceTolerance: 0,
    sourceMaxZoom: 22,
    maxTileCacheSize: 128,
    motionScale: 1,
    showFreeGrid: true,
    showDefenseLabels: true,
    showExtrusions: true,
    showMinorSymbols: true,
    antialias: true,
    routeWidth: 4.5,
  },
};

const STORAGE_KEY = 'grundo.graphicsSettings.v1';
const QUALITIES = new Set<GraphicsQuality>(['low', 'medium', 'high', 'ultra']);

function clampRadius(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_GRAPHICS_SETTINGS.renderRadiusM;
  }
  const clamped = Math.min(MAX_RENDER_RADIUS_M, Math.max(MIN_RENDER_RADIUS_M, value));
  return Math.round(clamped / RENDER_RADIUS_STEP_M) * RENDER_RADIUS_STEP_M;
}

export function normalizeGraphicsSettings(raw: unknown): GraphicsSettings {
  if (raw === null || typeof raw !== 'object') return DEFAULT_GRAPHICS_SETTINGS;
  const value = raw as Partial<GraphicsSettings>;
  return {
    quality: typeof value.quality === 'string' && QUALITIES.has(value.quality as GraphicsQuality)
      ? value.quality as GraphicsQuality
      : DEFAULT_GRAPHICS_SETTINGS.quality,
    renderRadiusM: clampRadius(value.renderRadiusM),
    viewingDistanceM: clampViewingDistance(value.viewingDistanceM),
  };
}

function clampViewingDistance(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_GRAPHICS_SETTINGS.viewingDistanceM;
  }
  const clamped = Math.min(MAX_VIEWING_DISTANCE_M, Math.max(MIN_VIEWING_DISTANCE_M, value));
  return Math.round(clamped / VIEWING_DISTANCE_STEP_M) * VIEWING_DISTANCE_STEP_M;
}

function read(): GraphicsSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw === null ? DEFAULT_GRAPHICS_SETTINGS : normalizeGraphicsSettings(JSON.parse(raw));
  } catch {
    return DEFAULT_GRAPHICS_SETTINGS;
  }
}

let current: GraphicsSettings | null = null;
const listeners = new Set<() => void>();

export function graphicsSettings(): GraphicsSettings {
  current ??= read();
  return current;
}

export function subscribeToGraphicsSettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function updateGraphicsSettings(patch: Partial<GraphicsSettings>): GraphicsSettings {
  const next = normalizeGraphicsSettings({ ...graphicsSettings(), ...patch });
  current = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* A beállítás az aktuális munkamenetben ettől még él. */
  }
  for (const listener of listeners) listener();
  return next;
}

/** Csak tesztekhez: a következő olvasás ismét a tárolóból induljon. */
export function resetGraphicsSettingsCache(): void {
  current = null;
}

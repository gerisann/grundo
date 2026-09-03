import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GRAPHICS_SETTINGS,
  MAX_RENDER_RADIUS_M,
  MAX_VIEWING_DISTANCE_M,
  MIN_RENDER_RADIUS_M,
  MIN_VIEWING_DISTANCE_M,
  normalizeGraphicsSettings,
} from './graphicsSettings';

describe('normalizeGraphicsSettings', () => {
  it('sérült vagy ismeretlen beállításból biztonságos alapértéket ad', () => {
    expect(normalizeGraphicsSettings(null)).toEqual(DEFAULT_GRAPHICS_SETTINGS);
    expect(normalizeGraphicsSettings({ quality: 'cinematic', renderRadiusM: 'messze' }))
      .toEqual(DEFAULT_GRAPHICS_SETTINGS);
  });

  it('a sugarat a támogatott tartományra és lépésközre igazítja', () => {
    expect(normalizeGraphicsSettings({ renderRadiusM: 20 }).renderRadiusM)
      .toBe(MIN_RENDER_RADIUS_M);
    expect(normalizeGraphicsSettings({ renderRadiusM: 20_000 }).renderRadiusM)
      .toBe(MAX_RENDER_RADIUS_M);
    expect(normalizeGraphicsSettings({ renderRadiusM: 777 }).renderRadiusM).toBe(800);
  });

  it('a 3D látótávolságot külön, méterben normalizálja', () => {
    expect(normalizeGraphicsSettings({ viewingDistanceM: 1 }).viewingDistanceM)
      .toBe(MIN_VIEWING_DISTANCE_M);
    expect(normalizeGraphicsSettings({ viewingDistanceM: 99_000 }).viewingDistanceM)
      .toBe(MAX_VIEWING_DISTANCE_M);
    expect(normalizeGraphicsSettings({ viewingDistanceM: 1_274 }).viewingDistanceM).toBe(1_250);
  });

  it('mind a négy minőségi profilt elfogadja', () => {
    for (const quality of ['low', 'medium', 'high', 'ultra'] as const) {
      expect(normalizeGraphicsSettings({ quality }).quality).toBe(quality);
    }
  });
});

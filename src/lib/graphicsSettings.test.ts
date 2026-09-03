import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GRAPHICS_SETTINGS,
  MAX_RENDER_RADIUS_M,
  MIN_RENDER_RADIUS_M,
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

  it('mind a négy minőségi profilt elfogadja', () => {
    for (const quality of ['low', 'medium', 'high', 'ultra'] as const) {
      expect(normalizeGraphicsSettings({ quality }).quality).toBe(quality);
    }
  });
});

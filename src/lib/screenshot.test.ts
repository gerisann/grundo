/**
 * A képernyőkép-belépési pont: weben elutasít, natívban a natív pluginra
 * megy, és a válasz base64-jét PNG blobbá alakítja.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const platform = { native: false };

vi.mock('./platform', () => ({
  isNativeApp: () => platform.native,
  isNativeIos: () => platform.native,
  isNativeAndroid: () => false,
}));

const captureScreenshotMock = vi.fn();
vi.mock('@capacitor/core', () => ({
  registerPlugin: () => ({ captureScreenshot: () => captureScreenshotMock() }),
}));

beforeEach(() => {
  platform.native = false;
  captureScreenshotMock.mockReset();
});

afterEach(() => {
  vi.resetModules();
});

async function load() {
  return import('./screenshot');
}

describe('captureScreenshot', () => {
  it('weben elutasít — nincs natív pillanatkép a böngészőben', async () => {
    const { captureScreenshot, ScreenshotError } = await load();
    await expect(captureScreenshot()).rejects.toBeInstanceOf(ScreenshotError);
    expect(captureScreenshotMock).not.toHaveBeenCalled();
  });

  it('natívban a plugint hívja, és PNG blobot ad vissza', async () => {
    platform.native = true;
    // "AB" base64-je.
    captureScreenshotMock.mockResolvedValue({ base64: 'QUI=' });
    const { captureScreenshot } = await load();

    const blob = await captureScreenshot();

    expect(captureScreenshotMock).toHaveBeenCalledTimes(1);
    expect(blob.type).toBe('image/png');
    expect(blob.size).toBe(2);
  });

  it('üres base64-nél hibát dob', async () => {
    platform.native = true;
    captureScreenshotMock.mockResolvedValue({ base64: '' });
    const { captureScreenshot, ScreenshotError } = await load();

    await expect(captureScreenshot()).rejects.toBeInstanceOf(ScreenshotError);
  });
});

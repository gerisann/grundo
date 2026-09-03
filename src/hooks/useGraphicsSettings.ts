import { useSyncExternalStore } from 'react';
import {
  graphicsSettings,
  subscribeToGraphicsSettings,
  type GraphicsSettings,
} from '@/lib/graphicsSettings';

export function useGraphicsSettings(): GraphicsSettings {
  return useSyncExternalStore(subscribeToGraphicsSettings, graphicsSettings, graphicsSettings);
}

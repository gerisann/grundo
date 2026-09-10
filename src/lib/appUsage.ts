/** Az app ténylegesen előtérben töltött idejének mérése. */
import { Capacitor } from '@capacitor/core';
import { api } from './api';

const HEARTBEAT_MS = 60_000;

export class ForegroundUsageMeter {
  private totalMs = 0;
  private visibleSince: number | null;

  constructor(visible: boolean, now: number) {
    this.visibleSince = visible ? now : null;
  }

  setVisible(visible: boolean, now: number): void {
    if (this.visibleSince != null) this.totalMs += Math.max(0, now - this.visibleSince);
    this.visibleSince = visible ? now : null;
  }

  total(now: number): number {
    return Math.round(this.totalMs + (this.visibleSince == null ? 0 : Math.max(0, now - this.visibleSince)));
  }
}

function sessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

export function startAppUsageTracking(): () => void {
  const id = sessionId();
  const visible = () => document.visibilityState === 'visible';
  const meter = new ForegroundUsageMeter(visible(), Date.now());

  const flush = () => {
    const totalActiveMs = meter.total(Date.now());
    if (totalActiveMs < 1_000) return;
    void api.appUsageHeartbeat({
      sessionId: id,
      totalActiveMs,
      platform: Capacitor.getPlatform(),
    }).catch(() => undefined);
  };
  const onVisibility = () => {
    meter.setVisible(visible(), Date.now());
    flush();
  };
  const onHide = () => {
    meter.setVisible(false, Date.now());
    flush();
  };
  const onShow = () => meter.setVisible(true, Date.now());

  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', onHide);
  window.addEventListener('pageshow', onShow);
  const timer = window.setInterval(flush, HEARTBEAT_MS);
  return () => {
    meter.setVisible(false, Date.now());
    flush();
    window.clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', onHide);
    window.removeEventListener('pageshow', onShow);
  };
}

/**
 * Egy build pontosan azonosítható a felületen is. A Vite a forrás commitját
 * és a kiadási csatornát buildidőben írja be (vite.config.ts).
 */
declare const __GRUNDO_VERSION__: string;
declare const __GRUNDO_REVISION__: string;
declare const __GRUNDO_CHANNEL__: string;

export const buildInfo = {
  version: __GRUNDO_VERSION__,
  revision: __GRUNDO_REVISION__,
  channel: __GRUNDO_CHANNEL__,
  get label(): string {
    return `v${this.version} · ${this.channel} · ${this.revision}`;
  },
} as const;

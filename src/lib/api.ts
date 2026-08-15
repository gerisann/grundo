import { auth } from './firebase';

/**
 * A GRUNDO backend kliense.
 *
 * MINDEN játékadat-írás ezen megy keresztül — a kliens Firestore-ba
 * közvetlenül csak a saját, engedélyezett mezőit írhatja (firestore.rules).
 */

export const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '';
export const apiConfigured = API_BASE.length > 0;

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (!apiConfigured) {
    throw new ApiError(0, 'api_unconfigured', 'A háttérszolgáltatás még nincs beállítva.');
  }

  const user = auth?.currentUser ?? null;
  const token = user ? await user.getIdToken() : null;

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init?.headers,
      },
    });
  } catch {
    throw new ApiError(0, 'network', 'Nincs kapcsolat a szerverrel. Ellenőrizd az internetet.');
  }

  const body = (await response.json().catch(() => null)) as
    | { code?: string; message?: string }
    | null;

  if (!response.ok) {
    throw new ApiError(
      response.status,
      body?.code ?? 'unknown',
      body?.message ?? 'A művelet nem sikerült. Próbáld újra.',
    );
  }
  return body as T;
}

/* ═══════════════════════════════════════════════════════════════════
   Típusok — a szerver által visszaadott profil (docs/05)
   ═══════════════════════════════════════════════════════════════════ */

export interface Profile {
  uid: string;
  username: string;
  displayName: string;
  email: string;
  emailVerified: boolean;
  photoURL: string | null;
  level: number;
  gpTotal: number;
  gpWeek: number;
  territoryM2: { foot: number; bike: number };
  zoneCount: { foot: number; bike: number };
  streak: { current: number; longest: number; weeks: number };
  counters: {
    activities: number;
    followers: number;
    following: number;
    distanceKm: { run: number; walk: number; ride: number };
  };
  pro: { active: boolean };
}

export interface OtpSendResult {
  sent?: boolean;
  alreadyVerified?: boolean;
  waitSeconds: number;
  /** Csak fejlesztői módban, ha nincs beállítva e-mail-szolgáltató. */
  devCode?: string;
}

export const api = {
  me: () => request<{ profile: Profile }>('/api/me'),

  register: (username: string) =>
    request<{ profile: Profile }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username }),
    }),

  otpSend: () => request<OtpSendResult>('/api/auth/otp/send', { method: 'POST' }),

  otpVerify: (code: string) =>
    request<{ verified: true }>('/api/auth/otp/verify', {
      method: 'POST',
      body: JSON.stringify({ code }),
    }),
};

import { auth } from './firebase';

/**
 * A GRUNDO backend kliense.
 *
 * MINDEN játékadat-írás ezen megy keresztül — a kliens Firestore-ba
 * közvetlenül csak a saját, engedélyezett mezőit írhatja (firestore.rules).
 */

export const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '');

/**
 * A saját eredetére mutató API-cím NEM backend.
 *
 * Két okból kell ezt külön kezelni. Egyrészt könnyű elrontani: a Cloud Run
 * konzolban a frontend URL-je hasonlóan néz ki, mint a backendé. Másrészt az
 * AI Studio értéket vár minden felismert környezeti változóhoz — üresen nem
 * indul el az app —, tehát a „még nincs backend" állapotot nem lehet üres
 * stringgel kifejezni.
 *
 * Ha az API-cím a saját eredetünkre mutat, úgy tekintjük, hogy nincs backend:
 * az app működik tovább, profil nélkül, hibaüzenetek nélkül.
 */
function pointsAtSelf(base: string): boolean {
  if (typeof location === 'undefined') return false;
  try {
    return new URL(base, location.href).origin === location.origin;
  } catch {
    return false;
  }
}

const selfReferencing = API_BASE.length > 0 && pointsAtSelf(API_BASE);

if (selfReferencing) {
  // eslint-disable-next-line no-console
  console.warn(
    `[GRUNDO] A VITE_API_BASE_URL (${API_BASE}) a frontend saját címére mutat, ` +
      'nem a Cloud Run backendre. Az app backend nélküli módban fut.',
  );
}

export const apiConfigured = API_BASE.length > 0 && !selfReferencing;

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

  /**
   * A válasznak JSON-nak KELL lennie.
   *
   * Ha a VITE_API_BASE_URL véletlenül a frontendre mutat, a statikus tárhely
   * minden ismeretlen útvonalra az index.html-t adja vissza — 200-as
   * státusszal, HTML tartalommal. Enélkül az ellenőrzés nélkül ebből egy
   * érthetetlen TypeError lenne a profil betöltésénél; így viszont megmondjuk,
   * mi a baj.
   */
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    throw new ApiError(
      response.status,
      'not_json',
      'A háttérszolgáltatás nem JSON-t adott vissza. Valószínűleg a ' +
        'VITE_API_BASE_URL a frontend címére mutat a Cloud Run URL helyett.',
    );
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

  if (body === null) {
    throw new ApiError(response.status, 'empty_response', 'A szerver üres választ adott.');
  }
  return body as T;
}

/* ═══════════════════════════════════════════════════════════════════
   Típusok — a szerver által visszaadott profil (docs/05)
   ═══════════════════════════════════════════════════════════════════ */

export interface Profile {
  uid: string;
  /** A megjelenítési alak, ahogy a felhasználó beírta — „Geri". */
  username: string;
  /** Az egyediségi kulcs — „geri". Kereséshez, névfeloldáshoz, hivatkozáshoz. */
  usernameLower: string;
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

/** Amit a szerver visszaad egy feldolgozott aktivitásról. */
export interface ActivitySummary {
  distanceM: number;
  durationS: number;
  movingS: number;
  cellCount: number;
  loops: number;
  claimedCells: number;
  areaGainedM2: number;
  gp: number;
}

export interface UploadActivityInput {
  activityId: string;
  type: 'run' | 'walk' | 'ride';
  points: readonly { lat: number; lng: number; t: number; accuracy?: number }[];
  startedAt: number;
  endedAt: number;
  movingMs: number;
}

export interface FeedActivity {
  id: string;
  type: 'run' | 'walk' | 'ride';
  layer: 'foot' | 'bike';
  startedAt: number;
  endedAt: number;
  distanceM: number;
  movingS: number;
  areaGainedM2: number;
  gp: number;
}

export interface TerritoryResult {
  layer: 'foot' | 'bike';
  cells: { cell: string; defense: number }[];
  cellCount: number;
  areaM2: number;
  blockCount: number;
  truncated?: boolean;
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

  /**
   * Belépés felhasználónévvel. A szerver ellenőrzi a jelszót, és egy
   * custom tokent ad vissza, amivel a Firebase SDK bejelentkeztet.
   * E-mail-címmel belépéskor ez a kerülő nem kell — ott a kliens közvetlenül
   * a Firebase-t hívja, és a jelszó felénk el sem indul.
   */
  login: (username: string, password: string) =>
    request<{ customToken: string }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),

  register: (username: string) =>
    request<{ profile: Profile }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username }),
    }),

  /**
   * Egy befejezett aktivitás feltöltése.
   *
   * A szerver MINDENT újraszámol a nyers nyomvonalból — a kliens által
   * mutatott táv és terület csak előnézet. Eltérés esetén a szerveré az
   * igazság; a válaszban ez jön vissza.
   */
  uploadActivity: (input: UploadActivityInput) =>
    request<{ activityId: string; summary: ActivitySummary; duplicate?: boolean }>(
      '/api/activities',
      { method: 'POST', body: JSON.stringify(input) },
    ),

  /** A saját aktivitásaim, legfrissebb elöl. */
  activities: (limit = 20) =>
    request<{ activities: FeedActivity[] }>(`/api/activities?limit=${limit}`),

  /** A saját területem cellái, érvényes védelmi szinttel. */
  territory: (layer: 'foot' | 'bike' = 'foot') =>
    request<TerritoryResult>(`/api/tiles/mine?layer=${layer}`),

  otpSend: () => request<OtpSendResult>('/api/auth/otp/send', { method: 'POST' }),

  otpVerify: (code: string) =>
    request<{ verified: true }>('/api/auth/otp/verify', {
      method: 'POST',
      body: JSON.stringify({ code }),
    }),
};

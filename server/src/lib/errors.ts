/**
 * HTTP-hibák magyar üzenettel.
 *
 * A felhasználó SOHA ne lásson nyers stack trace-t vagy angol Firestore-hibát.
 * A `code` gépi feldolgozásra való (a kliens ez alapján dönt), a `message`
 * pedig közvetlenül megjeleníthető.
 */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const badRequest = (code: string, message: string) => new HttpError(400, code, message);
export const unauthorized = (message = 'Jelentkezz be a folytatáshoz.') =>
  new HttpError(401, 'unauthorized', message);
export const forbidden = (message = 'Ehhez nincs jogosultságod.') =>
  new HttpError(403, 'forbidden', message);
export const notFound = (code: string, message: string) => new HttpError(404, code, message);
export const conflict = (code: string, message: string) => new HttpError(409, code, message);
export const tooManyRequests = (message: string, retryAfterSeconds?: number) => {
  const error = new HttpError(429, 'too_many_requests', message);
  (error as HttpError & { retryAfter?: number }).retryAfter = retryAfterSeconds;
  return error;
};

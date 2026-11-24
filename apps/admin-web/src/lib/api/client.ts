import type { ApiErrorBody } from '@esamagri/shared-types';
import { env } from '../../env';

/**
 * Thrown for every non-2xx API response. Callers should switch on
 * `.code` (the stable machine-readable string from the shared
 * ApiErrorBody envelope — see @esamagri/shared-types), never on
 * `.message` text matching.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly correlationId?: string;
  readonly details?: Record<string, unknown>;

  constructor(status: number, body: Partial<ApiErrorBody>) {
    super(body.message ?? 'Request failed');
    this.name = 'ApiError';
    this.status = status;
    this.code = body.code ?? 'UNKNOWN_ERROR';
    this.correlationId = body.correlationId;
    this.details = body.details;
  }
}

/** Thrown when fetch itself fails (offline, DNS, CORS) before any HTTP response exists. */
export class NetworkError extends Error {
  constructor() {
    super('Network request failed');
    this.name = 'NetworkError';
  }
}

/**
 * Thrown for a documented-but-not-yet-implemented backend route (HTTP
 * 404 against a path this frontend knows is planned — e.g. RIK/PIF
 * catalog endpoints before those modules exist). Kept distinct from a
 * generic ApiError so screens can render the "Coming soon" empty
 * state (STEP 8 Section 23) instead of a scary error, and so this can
 * never be confused with "the resource you asked for doesn't exist"
 * once the real route ships.
 */
export class NotImplementedError extends Error {
  constructor(path: string) {
    super(`${path} is not implemented by the backend yet`);
    this.name = 'NotImplementedError';
  }
}

// --- In-memory access token -------------------------------------------
// Deliberately NOT localStorage/sessionStorage: an access token is
// short-lived (15m, per apps/api's JWT_ACCESS_TTL) and living only in
// memory means it disappears on tab close, same as the httpOnly
// refresh-token cookie already keeps the long-lived credential out of
// reach of page JS entirely (STEP 6). Losing it on refresh is
// expected — AuthProvider calls /auth/refresh once on load to recover
// a session from the cookie.
let accessToken: string | null = null;
export function setAccessToken(token: string | null): void {
  accessToken = token;
}
export function getAccessToken(): string | null {
  return accessToken;
}

let refreshInFlight: Promise<boolean> | null = null;

/** Set by AuthProvider so the client can perform the refresh dance without a circular import. */
let refreshHandler: (() => Promise<boolean>) | null = null;
export function setRefreshHandler(handler: (() => Promise<boolean>) | null): void {
  refreshHandler = handler;
}

/** Set by AuthProvider; called when a refresh attempt itself fails, to clear client auth state. */
let onSessionExpired: (() => void) | null = null;
export function setOnSessionExpired(handler: (() => void) | null): void {
  onSessionExpired = handler;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  /** Skip the automatic 401 -> refresh -> retry dance (used by the refresh call itself). */
  skipAuthRetry?: boolean;
  signal?: AbortSignal;
}

/**
 * The single fetch entry point for the whole app. Always sends
 * credentials so the httpOnly refresh cookie travels on /auth/*
 * requests; always attaches the in-memory access token when present.
 * A 401 triggers exactly one refresh-and-retry per call (never an
 * infinite loop), matching STEP 6/7's auth/authorization contracts.
 */
export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, skipAuthRetry = false, signal } = options;

  let response: Response;
  try {
    response = await fetch(`${env.VITE_API_BASE_URL}${path}`, {
      method,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        // Says which of the two apps is calling, so the API reads THIS
        // app's refresh cookie. One person may be signed in to both the
        // admin portal and the shop in one browser; without this, the
        // second sign-in used to silently end the first. It is a hint for
        // choosing a cookie and grants nothing: the token it selects is
        // still verified server-side.
        'X-Esamagri-Session': 'staff',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch {
    throw new NetworkError();
  }

  if (response.status === 401 && !skipAuthRetry && refreshHandler) {
    const refreshed = await runRefreshOnce();
    if (refreshed) {
      return apiRequest<T>(path, { ...options, skipAuthRetry: true });
    }
    onSessionExpired?.();
  }

  if (response.status === 404) {
    // Distinguish "route not implemented" from "resource not found"
    // only for routes this frontend knows are planned-but-absent;
    // everywhere else a 404 is a real ApiError like any other status.
    const body404 = await safeJson(response);
    // The API answers ROUTE_NOT_FOUND when no such ADDRESS exists, and
    // NOT_FOUND when the address exists but the thing it names does not.
    // Only the first means "this screen's backend has not shipped yet".
    // (Before the API had a global error filter, the same distinction was
    // carried by the ABSENCE of a code on the framework's default body —
    // still honoured below so an older API answers the same way.)
    if (body404 && typeof body404 === 'object' && 'code' in body404) {
      if ((body404 as { code?: unknown }).code === 'ROUTE_NOT_FOUND') {
        throw new NotImplementedError(path);
      }
      throw new ApiError(response.status, body404 as Partial<ApiErrorBody>);
    }
    throw new NotImplementedError(path);
  }

  if (!response.ok) {
    const errorBody = (await safeJson(response)) as Partial<ApiErrorBody> | null;
    throw new ApiError(response.status, errorBody ?? {});
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

/**
 * The one path that sends a file (STEP 15B Phase B, the eligibility import).
 *
 * It exists because `apiRequest` above always sets Content-Type:
 * application/json and JSON-encodes the body, and a multipart upload can do
 * neither: the browser has to write the Content-Type itself so that it
 * carries the boundary it generated. Setting that header by hand produces a
 * body the server cannot parse, which is why it is conspicuously absent here.
 *
 * Everything else is deliberately the same as `apiRequest` — the access
 * token, the single refresh-and-retry on 401, the ApiError envelope — so a
 * refused upload reports the server's own sentence and reason code exactly
 * like every other refusal in the console.
 */
export async function apiUpload<T>(
  path: string,
  form: FormData,
  options: { skipAuthRetry?: boolean; signal?: AbortSignal } = {}
): Promise<T> {
  const { skipAuthRetry = false, signal } = options;

  let response: Response;
  try {
    response = await fetch(`${env.VITE_API_BASE_URL}${path}`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'X-Esamagri-Session': 'staff',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: form,
      signal,
    });
  } catch {
    throw new NetworkError();
  }

  if (response.status === 401 && !skipAuthRetry && refreshHandler) {
    const refreshed = await runRefreshOnce();
    // A FormData body is re-sendable, so the retry carries the same file.
    if (refreshed) return apiUpload<T>(path, form, { ...options, skipAuthRetry: true });
    onSessionExpired?.();
  }

  if (!response.ok) {
    const errorBody = (await safeJson(response)) as Partial<ApiErrorBody> | null;
    throw new ApiError(response.status, errorBody ?? {});
  }

  return (await response.json()) as T;
}

/**
 * A file download that needs the session's own authorization.
 *
 * The browser's own navigation cannot carry the Authorization header, so an
 * authenticated download has to be fetched as a blob and handed to the page.
 * Used by the product-import template; it refreshes once on a 401, exactly
 * like every other call here.
 */
export async function apiDownload(
  path: string,
  options: { skipAuthRetry?: boolean; signal?: AbortSignal } = {}
): Promise<{ blob: Blob; filename: string | null }> {
  const { skipAuthRetry = false, signal } = options;

  let response: Response;
  try {
    response = await fetch(`${env.VITE_API_BASE_URL}${path}`, {
      method: 'GET',
      credentials: 'include',
      headers: {
        'X-Esamagri-Session': 'staff',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      signal,
    });
  } catch {
    throw new NetworkError();
  }

  if (response.status === 401 && !skipAuthRetry && refreshHandler) {
    const refreshed = await runRefreshOnce();
    if (refreshed) return apiDownload(path, { ...options, skipAuthRetry: true });
    onSessionExpired?.();
  }

  if (!response.ok) {
    const errorBody = (await safeJson(response)) as Partial<ApiErrorBody> | null;
    throw new ApiError(response.status, errorBody ?? {});
  }

  const disposition = response.headers.get('content-disposition') ?? '';
  const match = /filename="?([^";]+)"?/.exec(disposition);
  return { blob: await response.blob(), filename: match?.[1] ?? null };
}

function runRefreshOnce(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = (refreshHandler?.() ?? Promise.resolve(false)).finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

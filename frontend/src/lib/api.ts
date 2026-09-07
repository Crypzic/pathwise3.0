// Tiny fetch wrapper. Attaches the auth token and throws readable errors.

// In local dev, this stays empty and Vite's proxy (see vite.config.ts) sends
// /api/* to the local backend. In production (Vercel), set VITE_API_URL to
// your deployed backend's URL (e.g. https://pathwise-api.onrender.com) —
// there's no dev proxy once this is a static, deployed site.
const API_BASE = import.meta.env.VITE_API_URL ?? "";

const TOKEN_KEY = "pathwise_token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}
export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  data: unknown;
  constructor(status: number, message: string, data?: unknown) {
    super(message);
    this.status = status;
    this.data = data;
  }

  /** The free-tier course cap was hit — callers route to the upgrade screen. */
  get isCourseCap(): boolean {
    return (
      this.status === 402 &&
      typeof this.data === "object" &&
      this.data !== null &&
      (this.data as { error?: string }).error === "course_cap_reached"
    );
  }
}

/** Fired when the server rejects our token, so AuthProvider can sign out. */
export const UNAUTHORIZED_EVENT = "pathwise:unauthorized";

async function handle<T>(res: Response, fallbackVerb: string): Promise<T> {
  const isJson = res.headers.get("content-type")?.includes("application/json");
  const data = isJson ? await res.json() : null;

  if (!res.ok) {
    // An expired or invalid token should drop the session rather than leaving
    // the user staring at a screen full of errors.
    if (res.status === 401 && getToken()) {
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    }
    const message =
      (data && (data.message || data.error)) ||
      `${fallbackVerb} failed (${res.status})`;
    throw new ApiError(res.status, message, data);
  }
  return data as T;
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return handle<T>(res, "Request");
}

// Multipart upload (a single file field named "file").
async function upload<T>(path: string, file: File): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const form = new FormData();
  form.append("file", file);

  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers,
    body: form,
  });
  return handle<T>(res, "Upload");
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
  del: <T>(path: string) => request<T>("DELETE", path),
  upload,
};

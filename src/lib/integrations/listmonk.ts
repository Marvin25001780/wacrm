// ============================================================
// Adaptador de Listmonk (AGPL-3.0) por API.
//
// Listmonk expone /api/lists, /api/subscribers y /api/health con
// autenticación básica (usuario API + token). No se copia su código:
// el CRM solo habla HTTP con el servidor que configure el negocio.
// ============================================================

export interface ListmonkCredentials {
  url: string;
  user: string;
  token: string;
}

export interface ListmonkList {
  id: number;
  name: string;
  subscriber_count: number;
}

export interface ListmonkResult<T> {
  ok: boolean;
  status?: number;
  data?: T;
  error?: string;
}

const TIMEOUT_MS = 10_000;

export function basicAuthHeader(user: string, token: string): string {
  // btoa no existe en el servidor: Buffer es el camino de Node.
  return `Basic ${Buffer.from(`${user}:${token}`).toString('base64')}`;
}

/** Une la URL base con una ruta de la API sin duplicar barras. */
export function listmonkUrl(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${base}${suffix}`;
}

async function request<T>(
  config: ListmonkCredentials,
  path: string,
  init: RequestInit = {},
): Promise<ListmonkResult<T>> {
  try {
    const res = await fetch(listmonkUrl(config.url, path), {
      ...init,
      headers: {
        Authorization: basicAuthHeader(config.user, config.token),
        Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    });

    const body = (await res.json().catch(() => null)) as
      | { data?: T; message?: string; error?: string }
      | null;

    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: body?.message ?? body?.error ?? `Listmonk respondió ${res.status}`,
      };
    }

    return { ok: true, status: res.status, data: body?.data as T | undefined };
  } catch (error) {
    const message =
      error instanceof Error && error.name === 'TimeoutError'
        ? 'Listmonk tardó demasiado en responder.'
        : error instanceof Error
          ? error.message
          : 'No se pudo contactar a Listmonk.';
    return { ok: false, error: message };
  }
}

export async function testListmonk(
  config: ListmonkCredentials,
): Promise<ListmonkResult<{ db: boolean }>> {
  const health = await request<{ db?: boolean }>(config, '/api/health');
  if (!health.ok) return health as ListmonkResult<{ db: boolean }>;

  if (health.data?.db === false) {
    return { ok: false, error: 'Listmonk responde, pero su base de datos no está disponible.' };
  }

  // /api/health es público; /api/lists confirma que las credenciales
  // de API funcionan de verdad.
  const lists = await request<{ results?: unknown[] }>(config, '/api/lists?per_page=1');
  if (!lists.ok) {
    return {
      ok: false,
      status: lists.status,
      error:
        lists.status === 401
          ? 'Listmonk rechazó el usuario o el token de la API.'
          : lists.error,
    };
  }

  return { ok: true, status: lists.status, data: { db: health.data?.db ?? true } };
}

export async function fetchListmonkLists(
  config: ListmonkCredentials,
): Promise<ListmonkResult<ListmonkList[]>> {
  const res = await request<{
    results?: Array<{ id: number; name: string; subscriber_count?: number }>;
  }>(config, '/api/lists?per_page=all');

  if (!res.ok) return res as ListmonkResult<ListmonkList[]>;

  const lists = (res.data?.results ?? []).map((list) => ({
    id: Number(list.id),
    name: list.name,
    subscriber_count: Number(list.subscriber_count ?? 0),
  }));

  return { ok: true, status: res.status, data: lists };
}

function escapeQuery(value: string): string {
  return value.replace(/'/g, "''");
}

/**
 * Crea el suscriptor o, si ya existe (409), lo agrega a la lista con
 * `PUT /api/subscribers/lists`. Idempotente desde el punto de vista
 * del CRM: la misma persona puede reenviarse sin duplicarse.
 */
export async function subscribeToFirstList(
  config: ListmonkCredentials,
  contact: { email: string; name: string | null; listId: number },
): Promise<ListmonkResult<{ action: 'created' | 'added'; id?: number }>> {
  const email = contact.email.trim().toLowerCase();
  if (!email || !email.includes('@')) {
    return { ok: false, error: 'El contacto no tiene un email válido.' };
  }

  const created = await request<{ id?: number }>(config, '/api/subscribers', {
    method: 'POST',
    body: JSON.stringify({
      email,
      name: contact.name?.trim() || email,
      status: 'enabled',
      lists: [contact.listId],
      preconfirm_subscriptions: true,
    }),
  });

  if (created.ok) {
    return { ok: true, status: created.status, data: { action: 'created', id: created.data?.id } };
  }
  if (created.status !== 409) {
    return created as ListmonkResult<{ action: 'created' | 'added'; id?: number }>;
  }

  // Ya existía: buscar su id y agregarlo a la lista.
  const query = encodeURIComponent(`subscribers.email = '${escapeQuery(email)}'`);
  const found = await request<{
    results?: Array<{ id: number; email: string }>;
  }>(config, `/api/subscribers?query=${query}&per_page=1`);

  if (!found.ok) return found as ListmonkResult<{ action: 'created' | 'added'; id?: number }>;

  const subscriber = found.data?.results?.[0];
  if (!subscriber) {
    return { ok: false, error: 'Listmonk dijo que el email existe, pero no lo encontró.' };
  }

  const added = await request<unknown>(config, '/api/subscribers/lists', {
    method: 'PUT',
    body: JSON.stringify({
      ids: [subscriber.id],
      action: 'add',
      target_list_ids: [contact.listId],
      status: 'confirmed',
    }),
  });

  if (!added.ok) {
    return added as ListmonkResult<{ action: 'created' | 'added'; id?: number }>;
  }

  return {
    ok: true,
    status: added.status,
    data: { action: 'added', id: subscriber.id },
  };
}

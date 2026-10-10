'use client';

// ============================================================
// Gestor de webhooks salientes (endpoints).
//
// Lista, crea (con el secreto de firma mostrado una sola vez), activa /
// desactiva, elimina y prueba. Reutiliza la infraestructura firmada de
// `src/lib/webhooks/*` (HMAC + guarda anti-SSRF).
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { useAuth } from '@/hooks/use-auth';
import { canEditSettings } from '@/lib/auth/roles';
import { toast } from 'sonner';
import {
  Loader2,
  Plus,
  Trash2,
  Webhook,
  Copy,
  Send,
  Power,
  ShieldCheck,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { WEBHOOK_EVENTS, type WebhookEvent } from '@/lib/webhooks/events';
import type { ApiWebhookEndpoint } from '@/lib/webhooks/endpoints';

const EVENT_LABEL: Record<WebhookEvent, string> = {
  'message.received': 'Mensaje recibido',
  'message.status_updated': 'Estado de mensaje actualizado',
  'conversation.created': 'Conversación creada',
};

export function WebhookEndpointsManager() {
  const { accountRole, profileLoading } = useAuth();
  const [endpoints, setEndpoints] = useState<ApiWebhookEndpoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const [url, setUrl] = useState('');
  const [selected, setSelected] = useState<WebhookEvent[]>(['message.received']);
  const [creating, setCreating] = useState(false);
  const [newSecret, setNewSecret] = useState<string | null>(null);

  const isAdmin = accountRole ? canEditSettings(accountRole) : false;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/webhooks');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { data: ApiWebhookEndpoint[] };
      setEndpoints(json.data ?? []);
    } catch (err) {
      console.error('[webhooks] load error:', err);
      toast.error('No se pudieron cargar los webhooks');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (profileLoading) return;
    void load();
  }, [profileLoading, load]);

  const toggleEvent = (evt: WebhookEvent) => {
    setSelected((prev) =>
      prev.includes(evt) ? prev.filter((e) => e !== evt) : [...prev, evt],
    );
  };

  const create = async () => {
    if (!url.trim()) return;
    if (selected.length === 0) {
      toast.error('Selecciona al menos un evento');
      return;
    }
    setCreating(true);
    setNewSecret(null);
    try {
      const res = await fetch('/api/webhooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim(), events: selected }),
      });
      const json = (await res.json()) as {
        data?: ApiWebhookEndpoint;
        secret?: string;
        error?: string;
      };
      if (!res.ok || !json.data) throw new Error(json.error ?? 'Error al crear');
      setEndpoints((prev) => [json.data as ApiWebhookEndpoint, ...prev]);
      setNewSecret(json.secret ?? null);
      setUrl('');
      toast.success('Webhook creado');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo crear');
    } finally {
      setCreating(false);
    }
  };

  const remove = async (ep: ApiWebhookEndpoint) => {
    if (!confirm(`¿Eliminar el webhook hacia ${ep.url}?`)) return;
    setBusy(ep.id);
    try {
      const res = await fetch(`/api/webhooks/${ep.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setEndpoints((prev) => prev.filter((e) => e.id !== ep.id));
      toast.success('Webhook eliminado');
    } catch {
      toast.error('No se pudo eliminar');
    } finally {
      setBusy(null);
    }
  };

  const toggleActive = async (ep: ApiWebhookEndpoint) => {
    setBusy(ep.id);
    try {
      const res = await fetch(`/api/webhooks/${ep.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !ep.is_active }),
      });
      const json = (await res.json()) as { data?: ApiWebhookEndpoint; error?: string };
      if (!res.ok || !json.data) throw new Error(json.error ?? 'Error');
      setEndpoints((prev) => prev.map((e) => (e.id === ep.id ? (json.data as ApiWebhookEndpoint) : e)));
      toast.success(ep.is_active ? 'Webhook desactivado' : 'Webhook activado');
    } catch {
      toast.error('No se pudo actualizar');
    } finally {
      setBusy(null);
    }
  };

  const test = async (ep: ApiWebhookEndpoint) => {
    setBusy(ep.id);
    try {
      const res = await fetch(`/api/webhooks/${ep.id}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        status?: number | null;
        error?: string;
      };
      if (json.ok) toast.success(`Entrega correcta (HTTP ${json.status})`);
      else toast.error(json.error ?? 'La entrega falló');
      await load();
    } catch {
      toast.error('No se pudo probar');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium text-foreground">
          Webhooks salientes
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Envía eventos del CRM a tu propio endpoint. Cada entrega va firmada
          con HMAC-SHA256 (<code className="text-[11px]">X-Wacrm-Signature</code>).
        </p>
      </div>

      {isAdmin && (
        <div className="rounded-xl border border-border bg-card p-4">
          <Label htmlFor="wh-url">Nueva URL de destino</Label>
          <Input
            id="wh-url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://tudominio.com/webhook"
            className="mt-1.5"
          />
          <div className="mt-3 flex flex-wrap gap-3">
            {WEBHOOK_EVENTS.map((evt) => (
              <label
                key={evt}
                className="flex items-center gap-2 text-xs text-foreground"
              >
                <input
                  type="checkbox"
                  checked={selected.includes(evt)}
                  onChange={() => toggleEvent(evt)}
                  className="size-3.5 accent-primary"
                />
                {EVENT_LABEL[evt]}
              </label>
            ))}
          </div>
          <div className="mt-3">
            <Button onClick={create} disabled={creating || !url.trim()}>
              {creating ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Plus className="size-4" />
              )}
              Añadir webhook
            </Button>
          </div>

          {newSecret && (
            <div className="mt-3 rounded-lg border border-primary/30 bg-primary/5 p-3">
              <div className="flex items-center gap-2 text-xs font-medium text-foreground">
                <ShieldCheck className="size-4 text-primary" />
                Guarda este secreto ahora — no se volverá a mostrar
              </div>
              <div className="mt-2 flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 text-xs text-foreground">
                  {newSecret}
                </code>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    void navigator.clipboard.writeText(newSecret);
                    toast.success('Copiado');
                  }}
                >
                  <Copy className="size-4" />
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="size-5 animate-spin text-primary" />
        </div>
      ) : endpoints.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border py-10 text-muted-foreground">
          <Webhook className="size-6" />
          <p className="text-sm">Sin webhooks configurados.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {endpoints.map((ep) => (
            <div
              key={ep.id}
              className="rounded-xl border border-border bg-card p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">
                    {ep.url}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {ep.events.map((e) => (
                      <span
                        key={e}
                        className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground"
                      >
                        {EVENT_LABEL[e as WebhookEvent] ?? e}
                      </span>
                    ))}
                  </div>
                  <p className="mt-1.5 text-[11px] text-muted-foreground">
                    {ep.is_active ? 'Activo' : 'Inactivo'}
                    {ep.last_delivery_at
                      ? ` · última entrega ${format(
                          new Date(ep.last_delivery_at),
                          "d MMM yyyy HH:mm",
                          { locale: es },
                        )}`
                      : ' · sin entregas'}
                    {ep.failure_count > 0 ? ` · ${ep.failure_count} fallos` : ''}
                  </p>
                </div>

                {isAdmin && (
                  <div className="flex shrink-0 gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => test(ep)}
                      disabled={busy === ep.id}
                    >
                      {busy === ep.id ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Send className="size-4" />
                      )}
                      Probar
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => toggleActive(ep)}
                      disabled={busy === ep.id}
                    >
                      <Power className="size-4" />
                      {ep.is_active ? 'Desactivar' : 'Activar'}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => remove(ep)}
                      disabled={busy === ep.id}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

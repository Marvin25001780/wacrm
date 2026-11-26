'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  AudioLines,
  Check,
  FlaskConical,
  Loader2,
  Mail,
  MonitorPlay,
  Users,
} from 'lucide-react';

// ============================================================
// Integraciones externas autoalojadas (migración 132).
//
//   * OpenReplay — grabación de sesiones del CRM (tracker oficial).
//   * Listmonk   — listas de correo; suscribe los contactos con email.
//   * VoiceSummary — analítica de transcripciones de llamadas.
//
// Los tokens son write-only: el formulario los manda una sola vez y el
// servidor los cifra; la API solo devuelve `has_token`. Todo se guarda
// por sección para que una tarjeta no pise a las otras.
// ============================================================

interface ExternalView {
  configured: boolean;
  openreplay: { enabled: boolean; url: string; project_key: string };
  listmonk: {
    enabled: boolean;
    url: string;
    user: string;
    list_id: number | null;
    has_token: boolean;
  };
  voicesummary: { enabled: boolean; url: string; has_token: boolean };
}

interface ListmonkList {
  id: number;
  name: string;
  subscriber_count: number;
}

interface DryRunResult {
  dryRun: true;
  list: ListmonkList;
  total: number;
  truncated: boolean;
  sample: Array<{ email: string; name: string | null }>;
  note: string;
}

interface SubscribeResult {
  list: ListmonkList;
  total: number;
  created: number;
  added: number;
  failed: number;
  errors: Array<{ email: string | null; error: string }>;
}

type Kind = 'openreplay' | 'listmonk' | 'voicesummary';

const EMPTY: ExternalView = {
  configured: false,
  openreplay: { enabled: false, url: '', project_key: '' },
  listmonk: { enabled: false, url: '', user: '', list_id: null, has_token: false },
  voicesummary: { enabled: false, url: '', has_token: false },
};

export function ExternalIntegrations() {
  const [loading, setLoading] = useState(true);
  const [migrationMissing, setMigrationMissing] = useState(false);
  const [view, setView] = useState<ExternalView>(EMPTY);
  const [saving, setSaving] = useState<Kind | null>(null);
  const [testing, setTesting] = useState<Kind | null>(null);

  // OpenReplay
  const [openreplayUrl, setOpenreplayUrl] = useState('');
  const [openreplayKey, setOpenreplayKey] = useState('');
  const [openreplayEnabled, setOpenreplayEnabled] = useState(false);

  // Listmonk
  const [listmonkUrl, setListmonkUrl] = useState('');
  const [listmonkUser, setListmonkUser] = useState('');
  const [listmonkToken, setListmonkToken] = useState('');
  const [listmonkEnabled, setListmonkEnabled] = useState(false);
  const [listmonkListId, setListmonkListId] = useState<number | null>(null);
  const [lists, setLists] = useState<ListmonkList[] | null>(null);
  const [loadingLists, setLoadingLists] = useState(false);
  const [preview, setPreview] = useState<DryRunResult | null>(null);
  const [subscribing, setSubscribing] = useState(false);

  // VoiceSummary
  const [voicesummaryUrl, setVoicesummaryUrl] = useState('');
  const [voicesummaryToken, setVoicesummaryToken] = useState('');
  const [voicesummaryEnabled, setVoicesummaryEnabled] = useState(false);

  const applyView = useCallback((next: ExternalView) => {
    setView(next);
    setOpenreplayUrl(next.openreplay.url);
    setOpenreplayKey(next.openreplay.project_key);
    setOpenreplayEnabled(next.openreplay.enabled);
    setListmonkUrl(next.listmonk.url);
    setListmonkUser(next.listmonk.user);
    setListmonkListId(next.listmonk.list_id);
    setListmonkEnabled(next.listmonk.enabled);
    setListmonkToken('');
    setVoicesummaryUrl(next.voicesummary.url);
    setVoicesummaryEnabled(next.voicesummary.enabled);
    setVoicesummaryToken('');
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/integrations/external');
      const json = (await res.json().catch(() => ({}))) as {
        migration_missing?: boolean;
        view?: ExternalView;
        error?: string;
      };
      if (!res.ok || !json.view) {
        toast.error(json.error ?? 'No se pudo cargar la configuración.');
        return;
      }
      setMigrationMissing(Boolean(json.migration_missing));
      applyView(json.view);
    } catch {
      toast.error('No se pudo cargar la configuración de integraciones.');
    } finally {
      setLoading(false);
    }
  }, [applyView]);

  useEffect(() => {
    // Carga inicial desde la API; el setState ocurre después del fetch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function save(kind: Kind, payload: Record<string, unknown>) {
    setSaving(kind);
    try {
      const res = await fetch('/api/integrations/external', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [kind]: payload }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        view?: ExternalView;
        error?: string;
      };
      if (!res.ok || !json.view) {
        toast.error(json.error ?? 'No se pudo guardar.');
        return false;
      }
      applyView(json.view);
      setPreview(null);
      toast.success('Configuración guardada.');
      return true;
    } catch {
      toast.error('Error de red al guardar.');
      return false;
    } finally {
      setSaving(null);
    }
  }

  async function test(kind: Kind) {
    setTesting(kind);
    try {
      const res = await fetch('/api/integrations/external/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        detail?: string;
      };
      if (json.ok) toast.success(json.detail ?? 'Conexión correcta.');
      else toast.error(json.error ?? 'No se pudo conectar.');
    } catch {
      toast.error('Error de red al probar la conexión.');
    } finally {
      setTesting(null);
    }
  }

  async function loadLists() {
    setLoadingLists(true);
    try {
      const res = await fetch('/api/integrations/external/listmonk/lists');
      const json = (await res.json().catch(() => ({}))) as {
        lists?: ListmonkList[];
        error?: string;
      };
      if (!res.ok || !json.lists) {
        toast.error(json.error ?? 'No se pudieron leer las listas.');
        return;
      }
      setLists(json.lists);
      if (json.lists.length === 0) toast.info('Listmonk no tiene listas todavía.');
    } catch {
      toast.error('Error de red al leer las listas.');
    } finally {
      setLoadingLists(false);
    }
  }

  async function subscribe(dryRun: boolean) {
    if (!listmonkListId) {
      toast.error('Elige primero una lista.');
      return;
    }
    setSubscribing(true);
    try {
      const res = await fetch('/api/integrations/external/listmonk/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listId: listmonkListId, dryRun }),
      });
      const json = (await res.json().catch(() => ({}))) as
        | DryRunResult
        | SubscribeResult
        | { error?: string };
      if (!res.ok) {
        toast.error(('error' in json && json.error) || 'No se pudo suscribir.');
        return;
      }
      if ('dryRun' in json) {
        setPreview(json);
        return;
      }
      const result = json as SubscribeResult;
      setPreview(null);
      toast.success(
        `Listo: ${result.created} nuevos, ${result.added} agregados, ${result.failed} con error.`,
      );
      if (result.errors.length > 0) {
        toast.error(`Primer error: ${result.errors[0].error}`);
      }
      void loadLists();
    } catch {
      toast.error('Error de red al suscribir contactos.');
    } finally {
      setSubscribing(false);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium text-foreground">
          Servicios autoalojados
        </h3>
        <p className="text-xs text-muted-foreground">
          OpenReplay, Listmonk y VoiceSummary se conectan por API o con su
          tracker oficial: no se copia su código. Todo es opcional y se activa
          por negocio.
        </p>
      </div>

      {migrationMissing && (
        <div className="rounded-lg border border-amber-300/60 bg-amber-50/60 p-3 text-xs text-amber-800 dark:bg-amber-950/20 dark:text-amber-200">
          Falta aplicar la migración <code>132_external_integrations.sql</code>{' '}
          en Supabase. Hasta entonces la configuración no se puede guardar.
        </div>
      )}

      {/* ---------------- OpenReplay ---------------- */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
            <MonitorPlay className="h-5 w-5 text-muted-foreground" />
          </div>
          <div className="flex-1">
            <h4 className="flex items-center gap-2 text-sm font-medium text-foreground">
              OpenReplay
              {view.openreplay.enabled && (
                <Check className="h-4 w-4 text-primary" />
              )}
            </h4>
            <p className="text-xs text-muted-foreground">
              Grabación y reproducción de sesiones del CRM para reproducir
              incidencias. Licencia AGPL-3.0; el tracker es MIT.
            </p>
          </div>
          <Switch
            checked={openreplayEnabled}
            onCheckedChange={setOpenreplayEnabled}
            aria-label="Activar OpenReplay"
          />
        </div>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input
            value={openreplayUrl}
            onChange={(event) => setOpenreplayUrl(event.target.value)}
            placeholder="https://openreplay.midominio.com"
            className="border-border text-foreground placeholder:text-muted-foreground sm:col-span-2"
          />
          <Input
            value={openreplayKey}
            onChange={(event) => setOpenreplayKey(event.target.value)}
            placeholder="Project key"
            className="border-border text-foreground placeholder:text-muted-foreground"
          />
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          El tracker apunta a <code>&lt;URL&gt;/ingest</code>. La project key se
          ve en OpenReplay → Preferences → Projects.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            onClick={() =>
              void save('openreplay', {
                enabled: openreplayEnabled,
                url: openreplayUrl,
                projectKey: openreplayKey,
              })
            }
            disabled={saving === 'openreplay' || migrationMissing}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {saving === 'openreplay' && (
              <Loader2 className="h-4 w-4 animate-spin" />
            )}
            Guardar
          </Button>
          <Button
            variant="outline"
            onClick={() => void test('openreplay')}
            disabled={testing === 'openreplay' || !view.openreplay.url}
            className="border-border text-muted-foreground"
          >
            {testing === 'openreplay' && (
              <Loader2 className="h-4 w-4 animate-spin" />
            )}
            Probar conexión
          </Button>
        </div>
      </div>

      {/* ---------------- Listmonk ---------------- */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
            <Mail className="h-5 w-5 text-muted-foreground" />
          </div>
          <div className="flex-1">
            <h4 className="flex items-center gap-2 text-sm font-medium text-foreground">
              Listmonk
              {view.listmonk.enabled && <Check className="h-4 w-4 text-primary" />}
            </h4>
            <p className="text-xs text-muted-foreground">
              Boletines y listas de correo autoalojadas (AGPL-3.0). Suscribe los
              contactos del CRM que tengan email.
            </p>
          </div>
          <Switch
            checked={listmonkEnabled}
            onCheckedChange={setListmonkEnabled}
            aria-label="Activar Listmonk"
          />
        </div>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input
            value={listmonkUrl}
            onChange={(event) => setListmonkUrl(event.target.value)}
            placeholder="https://listmonk.midominio.com"
            className="border-border text-foreground placeholder:text-muted-foreground sm:col-span-2"
          />
          <Input
            value={listmonkUser}
            onChange={(event) => setListmonkUser(event.target.value)}
            placeholder="Usuario de API"
            className="border-border text-foreground placeholder:text-muted-foreground"
          />
          <Input
            type="password"
            value={listmonkToken}
            onChange={(event) => setListmonkToken(event.target.value)}
            placeholder={
              view.listmonk.has_token ? '•••••••• (guardado)' : 'Token de API'
            }
            className="border-border text-foreground placeholder:text-muted-foreground"
          />
          <div className="sm:col-span-2">
            <select
              value={listmonkListId ?? ''}
              onChange={(event) =>
                setListmonkListId(
                  event.target.value ? Number(event.target.value) : null,
                )
              }
              className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            >
              <option value="">Lista de destino (cárgala después de guardar)</option>
              {(lists ?? []).map((list) => (
                <option key={list.id} value={list.id}>
                  {list.name} — {list.subscriber_count} suscriptores
                </option>
              ))}
            </select>
            {view.listmonk.list_id && !lists && (
              <p className="mt-1 text-[11px] text-muted-foreground">
                Lista guardada con id {view.listmonk.list_id}. Pulsa “Ver listas”
                para confirmar que sigue existiendo.
              </p>
            )}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            onClick={() =>
              void save('listmonk', {
                enabled: listmonkEnabled,
                url: listmonkUrl,
                user: listmonkUser,
                // Sin token nuevo se conserva el guardado; el placeholder
                // indica “(guardado)” y el servidor nunca lo devuelve.
                ...(listmonkToken.trim() ? { token: listmonkToken.trim() } : {}),
                listId: listmonkListId,
              })
            }
            disabled={saving === 'listmonk' || migrationMissing}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {saving === 'listmonk' && (
              <Loader2 className="h-4 w-4 animate-spin" />
            )}
            Guardar
          </Button>
          <Button
            variant="outline"
            onClick={() => void test('listmonk')}
            disabled={testing === 'listmonk' || !view.listmonk.url}
            className="border-border text-muted-foreground"
          >
            {testing === 'listmonk' && (
              <Loader2 className="h-4 w-4 animate-spin" />
            )}
            Probar conexión
          </Button>
          <Button
            variant="outline"
            onClick={() => void loadLists()}
            disabled={loadingLists || !view.listmonk.has_token}
            className="border-border text-muted-foreground"
          >
            {loadingLists ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Users className="h-4 w-4" />
            )}
            Ver listas
          </Button>
        </div>

        <div className="mt-4 rounded-lg border border-border bg-muted/30 p-3">
          <p className="text-xs font-medium text-foreground">
            Suscribir contactos del CRM
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Usa el email de los contactos del CRM (hasta 200 por lote, sin
            duplicados). Primero se muestra una vista previa; nada se envía sin
            confirmar.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => void subscribe(true)}
              disabled={subscribing || !view.listmonk.enabled || !listmonkListId}
              className="border-border text-muted-foreground"
            >
              {subscribing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <FlaskConical className="h-3.5 w-3.5" />
              )}
              Vista previa
            </Button>
            {preview && (
              <Button
                size="sm"
                onClick={() => void subscribe(false)}
                disabled={subscribing}
                className="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {subscribing && (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                )}
                Confirmar {preview.total} contacto
                {preview.total === 1 ? '' : 's'}
              </Button>
            )}
          </div>
          {preview && (
            <div className="mt-3 space-y-1 text-[11px] text-muted-foreground">
              <p>
                Lista <strong className="text-foreground">{preview.list.name}</strong>{' '}
                · {preview.note}
              </p>
              {preview.truncated && (
                <p>
                  Hay más de 200 contactos con email: se procesará el lote más
                  reciente. Vuelve a ejecutarlo para el resto.
                </p>
              )}
              {preview.sample.length > 0 && (
                <p className="truncate">
                  Muestra: {preview.sample.map((row) => row.email).join(', ')}
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ---------------- VoiceSummary ---------------- */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
            <AudioLines className="h-5 w-5 text-muted-foreground" />
          </div>
          <div className="flex-1">
            <h4 className="flex items-center gap-2 text-sm font-medium text-foreground">
              VoiceSummary
              {view.voicesummary.enabled && (
                <Check className="h-4 w-4 text-primary" />
              )}
            </h4>
            <p className="text-xs text-muted-foreground">
              Analiza transcripciones de llamadas con IA (MIT). El CRM empuja
              cada llamada transcrita; también puedes enviarla a mano desde el
              diálogo de la llamada.
            </p>
          </div>
          <Switch
            checked={voicesummaryEnabled}
            onCheckedChange={setVoicesummaryEnabled}
            aria-label="Activar VoiceSummary"
          />
        </div>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input
            value={voicesummaryUrl}
            onChange={(event) => setVoicesummaryUrl(event.target.value)}
            placeholder="https://voicesummary.midominio.com"
            className="border-border text-foreground placeholder:text-muted-foreground sm:col-span-2"
          />
          <Input
            type="password"
            value={voicesummaryToken}
            onChange={(event) => setVoicesummaryToken(event.target.value)}
            placeholder={
              view.voicesummary.has_token
                ? '•••••••• (guardado)'
                : 'Token de API (opcional)'
            }
            className="border-border text-foreground placeholder:text-muted-foreground sm:col-span-2"
          />
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          VoiceSummary exige la URL del audio; sin grabación no se envía. El
          push automático ocurre al guardar la transcripción.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            onClick={() =>
              void save('voicesummary', {
                enabled: voicesummaryEnabled,
                url: voicesummaryUrl,
                ...(voicesummaryToken.trim()
                  ? { token: voicesummaryToken.trim() }
                  : {}),
              })
            }
            disabled={saving === 'voicesummary' || migrationMissing}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {saving === 'voicesummary' && (
              <Loader2 className="h-4 w-4 animate-spin" />
            )}
            Guardar
          </Button>
          <Button
            variant="outline"
            onClick={() => void test('voicesummary')}
            disabled={testing === 'voicesummary' || !view.voicesummary.url}
            className="border-border text-muted-foreground"
          >
            {testing === 'voicesummary' && (
              <Loader2 className="h-4 w-4 animate-spin" />
            )}
            Probar conexión
          </Button>
        </div>
      </div>
    </div>
  );
}

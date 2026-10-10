'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, Check, Radio, MessagesSquare, Copy } from 'lucide-react';

// ============================================================
// Panel de canales omnicanal (Evolution API + Chatwoot).
//
// Persiste vía /api/channels (admin+). Los secretos son write-only:
// el servidor los cifra y solo devuelve una bandera `has_*`; los
// inputs de secreto se muestran vacíos y solo se envían si el usuario
// escribe uno nuevo.
// ============================================================

type ChannelType = 'evolution' | 'chatwoot';

interface SerializedChannel {
  id: string;
  channel: ChannelType;
  config: Record<string, unknown>;
  is_active: boolean;
}

interface FieldDef {
  name: string;
  label: string;
  placeholder: string;
  /** El secreto se envía solo si el usuario lo reescribe. */
  secret?: boolean;
}

const CHANNELS: Array<{
  channel: ChannelType;
  title: string;
  description: string;
  icon: typeof Radio;
  fields: FieldDef[];
}> = [
  {
    channel: 'evolution',
    title: 'WhatsApp (Evolution API)',
    description:
      'Conecta un número de WhatsApp no oficial. Los mensajes entrantes llegan a tu bandeja.',
    icon: Radio,
    fields: [
      { name: 'base_url', label: 'URL base', placeholder: 'https://evolution.midominio.com' },
      { name: 'instance', label: 'Instancia', placeholder: 'mi-instancia' },
      { name: 'api_key', label: 'API key', placeholder: 'API key global de Evolution', secret: true },
    ],
  },
  {
    channel: 'chatwoot',
    title: 'Chatwoot',
    description:
      'Sincroniza tu cuenta de Chatwoot (helpdesk) para atención multicanal.',
    icon: MessagesSquare,
    fields: [
      { name: 'base_url', label: 'URL base', placeholder: 'https://chatwoot.midominio.com' },
      { name: 'account_id', label: 'Account ID', placeholder: '1' },
      { name: 'api_token', label: 'API token', placeholder: 'Token de acceso de Chatwoot', secret: true },
    ],
  },
];

export function OmnichannelPanel() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Partial<Record<ChannelType, SerializedChannel>>>({});

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/channels');
      const json = (await res.json()) as { data?: SerializedChannel[] };
      const map: Partial<Record<ChannelType, SerializedChannel>> = {};
      for (const row of json.data ?? []) map[row.channel] = row;
      setRows(map);
    } catch {
      // La sección simplemente muestra los formularios vacíos.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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
        <h3 className="text-sm font-medium text-foreground">Canales omnicanal</h3>
        <p className="text-xs text-muted-foreground">
          Agrega canales de mensajería adicionales a tu bandeja.
        </p>
      </div>
      {CHANNELS.map((def) => (
        <ChannelCard
          key={def.channel}
          def={def}
          row={rows[def.channel] ?? null}
          onSaved={(row) => setRows((prev) => ({ ...prev, [row.channel]: row }))}
          onRemoved={() =>
            setRows((prev) => ({ ...prev, [def.channel]: undefined }))
          }
        />
      ))}
    </div>
  );
}

function ChannelCard({
  def,
  row,
  onSaved,
  onRemoved,
}: {
  def: (typeof CHANNELS)[number];
  row: SerializedChannel | null;
  onSaved: (row: SerializedChannel) => void;
  onRemoved: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [isActive, setIsActive] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const Icon = def.icon;

  useEffect(() => {
    const next: Record<string, string> = {};
    for (const field of def.fields) {
      next[field.name] = field.secret
        ? ''
        : String((row?.config?.[field.name] as string | undefined) ?? '');
    }
    setValues(next);
    setIsActive(row?.is_active ?? false);
  }, [row, def.fields]);

  const hasSecret = (name: string) => Boolean(row?.config?.[`has_${name}`]);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/channels/${def.channel}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: values, is_active: true }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Error al guardar');
      onSaved(json.data as SerializedChannel);
      setIsActive(true);
      // Limpia el secreto del formulario (ya está guardado/cifrado).
      setValues((prev) => {
        const next = { ...prev };
        for (const field of def.fields) if (field.secret) next[field.name] = '';
        return next;
      });
      toast.success(`${def.title} configurado`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al guardar');
    } finally {
      setSaving(false);
    }
  }

  async function disable() {
    setSaving(true);
    try {
      const res = await fetch(`/api/channels/${def.channel}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Error al desactivar');
      onRemoved();
      setIsActive(false);
      toast.success(`${def.title} desactivado`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error');
    } finally {
      setSaving(false);
    }
  }

  async function test() {
    setTesting(true);
    try {
      const res = await fetch(`/api/channels/${def.channel}/test`, { method: 'POST' });
      const json = await res.json();
      if (json.ok) toast.success('Conexión correcta');
      else toast.error(`Sin conexión (${json.status ?? json.error ?? 'error'})`);
    } catch {
      toast.error('Error de red');
    } finally {
      setTesting(false);
    }
  }

  const webhookUrl =
    def.channel === 'evolution' && row
      ? `${typeof window !== 'undefined' ? window.location.origin : ''}/api/webhooks/evolution/${row.id}`
      : null;

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
          <Icon className="h-5 w-5 text-muted-foreground" />
        </div>
        <div className="flex-1">
          <h4 className="text-sm font-medium text-foreground">{def.title}</h4>
          <p className="text-xs text-muted-foreground">{def.description}</p>
        </div>
        {isActive && <Check className="h-4 w-4 text-primary" />}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        {def.fields.map((field) => (
          <Input
            key={field.name}
            type={field.secret ? 'password' : 'text'}
            value={values[field.name] ?? ''}
            onChange={(e) =>
              setValues((prev) => ({ ...prev, [field.name]: e.target.value }))
            }
            placeholder={
              field.secret && hasSecret(field.name)
                ? '•••••••• (guardado)'
                : field.placeholder
            }
            className={`border-border text-foreground placeholder:text-muted-foreground ${
              field.name === 'base_url' ? 'col-span-2' : ''
            }`}
          />
        ))}
      </div>

      {webhookUrl && (
        <div className="mt-3 rounded-lg bg-muted/50 p-3">
          <p className="text-xs text-muted-foreground">
            URL de webhook (configúrala en Evolution con el header{' '}
            <code className="text-foreground">apikey</code>):
          </p>
          <div className="mt-1 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate text-xs text-foreground">
              {webhookUrl}
            </code>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                navigator.clipboard?.writeText(webhookUrl);
                toast.success('URL copiada');
              }}
            >
              <Copy className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}

      <div className="mt-3 flex gap-2">
        <Button
          onClick={save}
          disabled={saving}
          className="bg-primary text-primary-foreground hover:bg-primary/90"
        >
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          Guardar
        </Button>
        {row && (
          <>
            <Button
              variant="outline"
              onClick={test}
              disabled={testing}
              className="border-border text-muted-foreground"
            >
              {testing && <Loader2 className="h-4 w-4 animate-spin" />}
              Probar conexión
            </Button>
            <Button
              variant="outline"
              onClick={disable}
              disabled={saving}
              className="border-border text-muted-foreground"
            >
              Desactivar
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

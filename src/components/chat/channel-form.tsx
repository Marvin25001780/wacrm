'use client';

// ============================================================
// ChannelForm — alta/edición de un canal de chat interno
// (migration 038). Nombre, descripción y miembros. En edición
// gestiona el alta/baja de miembros por diferencia.
// ============================================================

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { toast } from 'sonner';
import { type ChatChannel, type Profile } from '@/types';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Check } from 'lucide-react';

interface ChannelFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channel?: ChatChannel | null;
  onSaved: (channelId?: string) => void;
}

export function ChannelForm({ open, onOpenChange, channel, onSaved }: ChannelFormProps) {
  const supabase = createClient();
  const { accountId, user } = useAuth();
  const isEdit = !!channel;
  const meId = user?.id ?? '';

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(channel?.name ?? '');
    setDescription(channel?.description ?? '');

    (async () => {
      const [p, m] = await Promise.all([
        supabase.from('profiles').select('*').order('full_name'),
        isEdit && channel
          ? supabase.from('chat_channel_members').select('user_id').eq('channel_id', channel.id)
          : Promise.resolve({ data: [] as { user_id: string }[] }),
      ]);
      setProfiles((p.data ?? []) as unknown as Profile[]);
      if (isEdit) {
        const ids = ((m.data ?? []) as unknown as Array<{ user_id: string }>).map((r) => r.user_id);
        setSelected(new Set(ids));
      } else {
        setSelected(new Set(meId ? [meId] : []));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, channel, isEdit, meId]);

  function toggle(userId: string) {
    if (userId === meId) return; // no puedes salir de tu propio canal
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!name.trim()) {
      toast.error('El nombre del canal es obligatorio');
      return;
    }
    if (!accountId) {
      toast.error('Tu perfil no está vinculado a una cuenta.');
      return;
    }

    setSaving(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const uid = session?.user?.id;
      if (!uid) throw new Error('No autenticado');

      const memberIds = new Set(selected);
      memberIds.add(uid);

      if (isEdit && channel) {
        const { error: upErr } = await supabase
          .from('chat_channels')
          .update({ name: name.trim(), description: description.trim() || null })
          .eq('id', channel.id);
        if (upErr) throw upErr;

        const { data: current } = await supabase
          .from('chat_channel_members')
          .select('user_id')
          .eq('channel_id', channel.id);
        const currentIds = new Set(
          ((current ?? []) as unknown as Array<{ user_id: string }>).map((r) => r.user_id),
        );

        const toAdd = [...memberIds].filter((id) => !currentIds.has(id));
        const toRemove = [...currentIds].filter((id) => !memberIds.has(id));

        if (toAdd.length > 0) {
          const { error } = await supabase.from('chat_channel_members').insert(
            toAdd.map((id) => ({ channel_id: channel.id, account_id: accountId, user_id: id })),
          );
          if (error) throw error;
        }
        if (toRemove.length > 0) {
          const { error } = await supabase
            .from('chat_channel_members')
            .delete()
            .eq('channel_id', channel.id)
            .in('user_id', toRemove);
          if (error) throw error;
        }
      } else {
        const { data: created, error: insErr } = await supabase
          .from('chat_channels')
          .insert({
            account_id: accountId,
            name: name.trim(),
            description: description.trim() || null,
            created_by: uid,
          })
          .select('id')
          .single();
        if (insErr) throw insErr;
        const newId = (created as { id: string }).id;

        const { error: memErr } = await supabase.from('chat_channel_members').insert(
          [...memberIds].map((id) => ({ channel_id: newId, account_id: accountId, user_id: id })),
        );
        if (memErr) throw memErr;

        toast.success('Canal creado');
        onOpenChange(false);
        onSaved(newId);
        return;
      }

      toast.success('Canal actualizado');
      onOpenChange(false);
      onSaved(channel?.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al guardar el canal';
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-popover border-border text-popover-foreground sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">
            {isEdit ? 'Configurar canal' : 'Nuevo canal'}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Agrupa al equipo en un espacio de conversación.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="ch-name" className="text-muted-foreground">
              Nombre <span className="text-red-400">*</span>
            </Label>
            <Input
              id="ch-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej. Ventas, Soporte, General"
              className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="ch-desc" className="text-muted-foreground">
              Descripción
            </Label>
            <Textarea
              id="ch-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="¿De qué se habla en este canal?"
              className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-muted-foreground">Miembros</Label>
            <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-border bg-muted/40 p-1.5">
              {profiles.length === 0 ? (
                <p className="px-2 py-3 text-sm text-muted-foreground">No hay usuarios.</p>
              ) : (
                profiles.map((p) => {
                  const isMe = p.user_id === meId;
                  const checked = selected.has(p.user_id) || isMe;
                  return (
                    <button
                      key={p.user_id}
                      type="button"
                      onClick={() => toggle(p.user_id)}
                      disabled={isMe}
                      className={
                        'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors ' +
                        (isMe ? 'cursor-default' : 'hover:bg-muted')
                      }
                    >
                      <span
                        className={
                          'flex size-5 shrink-0 items-center justify-center rounded border ' +
                          (checked
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-border bg-background')
                        }
                      >
                        {checked && <Check className="size-3.5" />}
                      </span>
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                        {(p.full_name ?? '?').charAt(0).toUpperCase()}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-foreground">
                          {p.full_name}
                          {isMe ? ' (tú)' : ''}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {p.email}
                        </span>
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          <DialogFooter className="bg-popover border-border">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="border-border text-muted-foreground hover:bg-muted"
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={saving}
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              {saving && <Loader2 className="size-4 animate-spin" />}
              {isEdit ? 'Guardar' : 'Crear canal'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

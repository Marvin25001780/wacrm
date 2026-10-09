'use client';

// ============================================================
// Chat interno — mensajería del equipo (módulo 2.3, migration 038).
// Canales + hilo en vivo (Supabase Realtime) + composer. Alta/edición
// de canales y miembros, borrado, RLS por cuenta.
// ============================================================

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { format } from 'date-fns';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { useCan } from '@/hooks/use-can';
import { toast } from 'sonner';
import { type ChatChannel, type ChatMessage, type Profile } from '@/types';
import { ChannelForm } from '@/components/chat/channel-form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Plus,
  Search,
  Send,
  Settings,
  Trash2,
  Loader2,
  Hash,
  Users,
  MessagesSquare,
} from 'lucide-react';

export default function ChatPage() {
  const supabase = createClient();
  const { accountId, user } = useAuth();
  const canEdit = useCan('send-messages');
  const meId = user?.id ?? '';

  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [channels, setChannels] = useState<ChatChannel[]>([]);
  const [channelsLoading, setChannelsLoading] = useState(true);
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ChatChannel | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);

  // ------------------------------------------------------------
  // Carga
  // ------------------------------------------------------------
  const fetchProfiles = useCallback(async () => {
    const { data } = await supabase.from('profiles').select('*');
    const map: Record<string, Profile> = {};
    ((data ?? []) as unknown as Profile[]).forEach((p) => {
      map[p.user_id] = p;
    });
    setProfiles(map);
  }, [supabase]);

  const fetchChannels = useCallback(async () => {
    setChannelsLoading(true);
    const { data, error } = await supabase
      .from('chat_channels')
      .select('*, members:chat_channel_members(count)')
      .order('created_at', { ascending: true });
    setChannelsLoading(false);

    if (error) {
      console.error('[chat] fetch error:', error);
      toast.error('Error al cargar los canales');
      return;
    }

    const rows = (data ?? []) as unknown as Array<ChatChannel & { members?: { count: number }[] }>;
    const mapped = rows.map((r) => ({ ...r, member_count: r.members?.[0]?.count ?? 0 }));
    setChannels(mapped);
    setSelectedChannelId((prev) => prev ?? mapped[0]?.id ?? null);
  }, [supabase]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void Promise.all([fetchProfiles(), fetchChannels()]);
  }, [fetchProfiles, fetchChannels]);

  const loadMessages = useCallback(
    async (channelId: string) => {
      setMessagesLoading(true);
      const { data, error } = await supabase
        .from('chat_messages')
        .select('*')
        .eq('channel_id', channelId)
        .order('created_at', { ascending: true })
        .limit(300);
      setMessagesLoading(false);
      if (error) {
        toast.error('Error al cargar los mensajes');
        return;
      }
      setMessages((data ?? []) as unknown as ChatMessage[]);
    },
    [supabase],
  );

  useEffect(() => {
    if (!selectedChannelId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadMessages(selectedChannelId);
  }, [selectedChannelId, loadMessages]);

  // Realtime — mensajes nuevos del canal seleccionado.
  useEffect(() => {
    if (!selectedChannelId) return;
    const supabaseClient = createClient();
    const channel = supabaseClient
      .channel(`chat:${selectedChannelId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'chat_messages',
          filter: `channel_id=eq.${selectedChannelId}`,
        },
        (payload) => {
          const msg = payload.new as ChatMessage;
          setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
        },
      )
      .subscribe();

    return () => {
      supabaseClient.removeChannel(channel);
    };
  }, [selectedChannelId]);

  // Auto-scroll al fondo cuando llegan mensajes.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // ------------------------------------------------------------
  // Acciones
  // ------------------------------------------------------------
  function openCreate() {
    setEditing(null);
    setFormOpen(true);
  }

  function openSettings(channel: ChatChannel) {
    setEditing(channel);
    setFormOpen(true);
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (!body || !selectedChannelId || !accountId || !meId) return;

    setSending(true);
    const { data, error } = await supabase
      .from('chat_messages')
      .insert({
        channel_id: selectedChannelId,
        account_id: accountId,
        sender_id: meId,
        body,
      })
      .select('*')
      .single();
    setSending(false);

    if (error) {
      toast.error('Error al enviar el mensaje');
      return;
    }
    setDraft('');
    const msg = data as unknown as ChatMessage;
    setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
  }

  async function handleDeleteChannel() {
    if (!selectedChannelId) return;
    const id = selectedChannelId;
    setDeleting(true);
    const { error } = await supabase.from('chat_channels').delete().eq('id', id);
    setDeleting(false);
    if (error) {
      toast.error('Error al eliminar el canal');
      return;
    }
    toast.success('Canal eliminado');
    setDeleteOpen(false);
    setMessages([]);
    setSelectedChannelId(null);
    await fetchChannels();
  }

  const filteredChannels = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return channels;
    return channels.filter((c) => c.name.toLowerCase().includes(term));
  }, [channels, search]);

  const selected = channels.find((c) => c.id === selectedChannelId) ?? null;

  // ------------------------------------------------------------
  // Render
  // ------------------------------------------------------------
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Chat interno</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Conversaciones del equipo, en tiempo real.
          </p>
        </div>
        {canEdit && (
          <Button
            onClick={openCreate}
            className="bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            <Plus className="size-4" />
            Nuevo canal
          </Button>
        )}
      </div>

      <div className="flex h-[70vh] min-h-[420px] overflow-hidden rounded-lg border border-border bg-card">
        {/* Canales */}
        <aside className="flex w-60 shrink-0 flex-col border-r border-border sm:w-72">
          <div className="border-b border-border p-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar canal..."
                className="h-8 bg-muted border-border pl-8 text-foreground placeholder:text-muted-foreground"
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            {channelsLoading ? (
              <div className="flex justify-center py-6">
                <Loader2 className="size-5 animate-spin text-primary" />
              </div>
            ) : filteredChannels.length === 0 ? (
              <p className="px-2 py-6 text-center text-xs text-muted-foreground">
                {channels.length === 0 ? 'Sin canales todavía.' : 'Sin resultados.'}
              </p>
            ) : (
              <ul className="space-y-0.5">
                {filteredChannels.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedChannelId(c.id)}
                      className={
                        'flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left transition-colors ' +
                        (c.id === selectedChannelId
                          ? 'bg-primary/10 text-primary'
                          : 'text-muted-foreground hover:bg-muted hover:text-foreground')
                      }
                    >
                      <Hash className="size-4 shrink-0" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{c.name}</span>
                        <span className="block text-xs opacity-70">
                          {c.member_count} {c.member_count === 1 ? 'miembro' : 'miembros'}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>

        {/* Hilo */}
        <section className="flex min-w-0 flex-1 flex-col">
          {!selected ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 text-muted-foreground">
              <MessagesSquare className="size-8" />
              <p className="text-sm">
                {channels.length === 0
                  ? 'Crea un canal para empezar a conversar.'
                  : 'Selecciona un canal.'}
              </p>
            </div>
          ) : (
            <>
              {/* Header */}
              <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
                <div className="min-w-0">
                  <p className="inline-flex items-center gap-1.5 font-semibold text-foreground">
                    <Hash className="size-4 text-muted-foreground" />
                    <span className="truncate">{selected.name}</span>
                  </p>
                  <p className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <Users className="size-3.5" />
                      {selected.member_count}
                    </span>
                    {selected.description ? <span className="truncate">{selected.description}</span> : null}
                  </p>
                </div>
                {canEdit && (
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      title="Configurar canal"
                      onClick={() => openSettings(selected)}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <Settings className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      title="Eliminar canal"
                      onClick={() => setDeleteOpen(true)}
                      className="text-muted-foreground hover:text-rose-400"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                )}
              </header>

              {/* Mensajes */}
              <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
                {messagesLoading ? (
                  <div className="flex justify-center py-6">
                    <Loader2 className="size-5 animate-spin text-primary" />
                  </div>
                ) : messages.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    Aún no hay mensajes. ¡Escribe el primero!
                  </p>
                ) : (
                  messages.map((m) => {
                    const mine = m.sender_id === meId;
                    const sender = profiles[m.sender_id];
                    return (
                      <div
                        key={m.id}
                        className={'flex gap-2.5 ' + (mine ? 'flex-row-reverse' : 'flex-row')}
                      >
                        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                          {(sender?.full_name ?? '?').charAt(0).toUpperCase()}
                        </span>
                        <div className={'max-w-[75%] ' + (mine ? 'items-end text-right' : 'items-start')}>
                          <p className="mb-0.5 text-xs text-muted-foreground">
                            {mine ? 'Tú' : (sender?.full_name ?? 'Usuario')} ·{' '}
                            {format(new Date(m.created_at), 'HH:mm')}
                          </p>
                          <div
                            className={
                              'inline-block whitespace-pre-wrap break-words rounded-lg px-3 py-2 text-sm ' +
                              (mine
                                ? 'bg-primary text-primary-foreground'
                                : 'border border-border bg-muted text-foreground')
                            }
                          >
                            {m.body}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Composer */}
              <form
                onSubmit={handleSend}
                className="flex items-end gap-2 border-t border-border p-3"
              >
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSend(e);
                    }
                  }}
                  rows={1}
                  placeholder={canEdit ? 'Escribe un mensaje...' : 'Solo lectura'}
                  disabled={!canEdit}
                  className="max-h-32 min-h-9 flex-1 resize-none rounded-lg border border-border bg-muted px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60"
                />
                <Button
                  type="submit"
                  disabled={!canEdit || sending || !draft.trim()}
                  className="bg-primary hover:bg-primary/90 text-primary-foreground"
                >
                  {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                </Button>
              </form>
            </>
          )}
        </section>
      </div>

      {/* Form */}
      <ChannelForm
        open={formOpen}
        onOpenChange={setFormOpen}
        channel={editing}
        onSaved={(id) => {
          fetchChannels();
          if (id) setSelectedChannelId(id);
        }}
      />

      {/* Delete confirmation */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="bg-popover border-border text-popover-foreground sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">Eliminar canal</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              ¿Eliminar{' '}
              <span className="font-medium text-popover-foreground">{selected?.name}</span>? Se
              borrarán también sus mensajes.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="bg-popover border-border">
            <Button
              variant="outline"
              onClick={() => setDeleteOpen(false)}
              className="border-border text-muted-foreground hover:bg-muted"
            >
              Cancelar
            </Button>
            <Button variant="destructive" onClick={handleDeleteChannel} disabled={deleting}>
              {deleting && <Loader2 className="size-4 animate-spin" />}
              Eliminar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

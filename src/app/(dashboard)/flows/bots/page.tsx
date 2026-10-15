"use client";

// ============================================================
// Bots — listado funcional (versión mínima).
//
// Permite crear, editar, activar/desactivar y eliminar bots.
// Cada bot tiene nombre, canal asociado y versión. El backend
// incrementa la versión en cada guardado.
// ============================================================

import { useEffect, useMemo, useState } from "react";
import {
  Bot,
  MoreVertical,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CHANNEL_LABEL } from "@/lib/channels/config";
import { formatRelative } from "@/lib/automations/trigger-meta";
import { cn } from "@/lib/utils";
import type { SerializedChannel } from "@/lib/channels/config";

interface BotRecord {
  id: string;
  name: string;
  status: "active" | "inactive";
  channel_id: string | null;
  channel: { channel: string; config: Record<string, unknown> } | null;
  version: number;
  created_by_user_id: string | null;
  created_at: string;
}

interface AccountMember {
  user_id: string;
  full_name: string | null;
}

function channelLabel(
  ch: SerializedChannel | undefined,
): string {
  if (!ch) return "Sin canal";
  const config = ch.config as Record<string, string>;
  const display = config.display_name || config.instance || config.base_url;
  const base = CHANNEL_LABEL[ch.channel] ?? ch.channel;
  return display ? `${base} · ${display}` : base;
}

export default function BotsPage() {
  const [bots, setBots] = useState<BotRecord[]>([]);
  const [channels, setChannels] = useState<SerializedChannel[]>([]);
  const [members, setMembers] = useState<AccountMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<BotRecord | null>(null);
  const [formName, setFormName] = useState("");
  const [formChannelId, setFormChannelId] = useState<string | "">("");
  const [saving, setSaving] = useState(false);

  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function load() {
    try {
      setLoading(true);
      const [botsRes, channelsRes, membersRes] = await Promise.all([
        fetch("/api/bots"),
        fetch("/api/channels"),
        fetch("/api/account/members"),
      ]);

      const botsJson = await botsRes.json();
      const channelsJson = await channelsRes.json();
      const membersJson = await membersRes.json();

      if (!botsRes.ok) throw new Error(botsJson.error || "Error al cargar bots");
      if (!channelsRes.ok) throw new Error(channelsJson.error || "Error al cargar canales");

      setBots(botsJson.bots ?? []);
      setChannels(channelsJson.data ?? []);
      setMembers(membersJson.members ?? []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al cargar");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return bots;
    return bots.filter((b) => b.name.toLowerCase().includes(q));
  }, [bots, query]);

  function openCreate() {
    setEditing(null);
    setFormName("");
    setFormChannelId("");
    setDialogOpen(true);
  }

  function openEdit(bot: BotRecord) {
    setEditing(bot);
    setFormName(bot.name);
    setFormChannelId(bot.channel_id ?? "");
    setDialogOpen(true);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const name = formName.trim();
    if (!name) {
      toast.error("El nombre es obligatorio");
      return;
    }

    setSaving(true);
    try {
      const url = editing ? `/api/bots/${editing.id}` : "/api/bots";
      const method = editing ? "PATCH" : "POST";
      const body = JSON.stringify({
        name,
        channel_id: formChannelId || null,
      });

      const res = await fetch(url, { method, body });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Error al guardar");

      toast.success(editing ? "Bot actualizado" : "Bot creado");
      setDialogOpen(false);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  }

  async function toggleStatus(bot: BotRecord) {
    const next = bot.status === "active" ? "inactive" : "active";
    try {
      const res = await fetch(`/api/bots/${bot.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: next }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Error al actualizar");
      setBots((prev) =>
        prev.map((b) => (b.id === bot.id ? json.bot : b)),
      );
      toast.success(next === "active" ? "Bot activado" : "Bot desactivado");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al actualizar");
    }
  }

  async function handleDelete() {
    if (!deleteId) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/bots/${deleteId}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Error al eliminar");
      toast.success("Bot eliminado");
      setDeleteId(null);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al eliminar");
    } finally {
      setDeleting(false);
    }
  }

  const memberById = useMemo(() => {
    const map = new Map<string, AccountMember>();
    for (const m of members) map.set(m.user_id, m);
    return map;
  }, [members]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold">Bots</h1>
        <p className="text-sm text-muted-foreground">
          Cree y gestione sus bots para automatizar conversaciones y procesos.
        </p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Búsqueda por nombre de bot"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" />
          Nuevo bot
        </Button>
      </div>

      {loading ? (
        <div className="rounded-xl border border-border bg-card py-16 text-center text-sm text-muted-foreground">
          Cargando bots...
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-border bg-card py-16 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <Bot className="h-6 w-6 text-muted-foreground" />
          </div>
          <p className="mt-4 text-sm font-medium">
            {query ? "No se encontraron bots." : "No se han encontrado bots. 😭"}
          </p>
          {!query && (
            <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
              Crea un nuevo bot haciendo clic en el botón &quot;Nuevo bot&quot; de
              la esquina superior derecha.
            </p>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Nombre del canal</TableHead>
                <TableHead>Versión</TableHead>
                <TableHead>Creado en</TableHead>
                <TableHead>Autor</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((bot) => {
                const channel = channels.find((c) => c.id === bot.channel_id);
                const author = bot.created_by_user_id
                  ? memberById.get(bot.created_by_user_id)?.full_name || "—"
                  : "—";
                return (
                  <TableRow key={bot.id}>
                    <TableCell className="font-medium">{bot.name}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={bot.status === "active"}
                          onCheckedChange={() => toggleStatus(bot)}
                          aria-label={
                            bot.status === "active" ? "Desactivar" : "Activar"
                          }
                        />
                        <span
                          className={cn(
                            "text-xs font-medium",
                            bot.status === "active"
                              ? "text-emerald-600"
                              : "text-muted-foreground",
                          )}
                        >
                          {bot.status === "active" ? "Activo" : "Inactivo"}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {channelLabel(channel)}
                    </TableCell>
                    <TableCell>{bot.version}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatRelative(bot.created_at)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {author}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                        >
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openEdit(bot)}>
                            <Pencil className="mr-2 h-4 w-4" />
                            Editar
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => setDeleteId(bot.id)}
                            className="text-destructive focus:text-destructive"
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Eliminar
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Create / Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={handleSave}>
            <DialogHeader>
              <DialogTitle>
                {editing ? "Editar bot" : "Nuevo bot"}
              </DialogTitle>
              <DialogDescription>
                {editing
                  ? "Actualiza el nombre y el canal asociado del bot."
                  : "Crea un bot y asígnalo a un canal para empezar."}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="bot-name">Nombre</Label>
                <Input
                  id="bot-name"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="Ej. Trial Welcome Bot"
                  autoFocus
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="bot-channel">Canal</Label>
                <Select
                  value={formChannelId}
                  onValueChange={(v) => setFormChannelId(v ?? "")}
                >
                  <SelectTrigger id="bot-channel">
                    <SelectValue placeholder="Selecciona un canal" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">Sin canal</SelectItem>
                    {channels.map((ch) => (
                      <SelectItem key={ch.id} value={ch.id}>
                        {channelLabel(ch)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialogOpen(false)}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "Guardando..." : editing ? "Guardar" : "Crear bot"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={!!deleteId} onOpenChange={(v) => !v && setDeleteId(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>¿Eliminar bot?</DialogTitle>
            <DialogDescription>
              Esta acción no se puede deshacer. El bot dejará de estar
              disponible inmediatamente.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteId(null)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? "Eliminando..." : "Eliminar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

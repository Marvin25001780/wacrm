"use client";

// ============================================================
// Vincular una conversación (y su lead) a un contacto que YA estaba
// guardado.
//
// Cuando entra un mensaje de un canal del que no conocemos ningún dato
// del cliente, se crea un contacto/lead nuevos. Este diálogo permite
// buscar un contacto existente y fusionar el nuevo en él con el RPC
// `merge_contacts` (migración 050), que re-apunta todas las
// referencias antes de borrar el duplicado: no se pierden mensajes,
// negocios, notas ni etiquetas.
// ============================================================

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import type { Contact } from "@/types";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Check, Loader2, Link2, Search } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface LinkContactDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Contacto actual del hilo — el que se fusionará en el elegido. */
  source: Contact;
  /** Tras fusionar: (id del contacto perdedor, contacto superviviente). */
  onLinked: (loserId: string, survivor: Contact) => void;
}

/** Quita los caracteres que rompen la sintaxis de `or()` de PostgREST. */
function sanitizeTerm(term: string): string {
  return term.replace(/[,()*]/g, " ").trim();
}

export function LinkContactDialog({
  open,
  onOpenChange,
  source,
  onLinked,
}: LinkContactDialogProps) {
  const supabase = createClient();
  const { accountId } = useAuth();
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [merging, setMerging] = useState(false);

  // Limpia el estado cada vez que se abre (los diálogos conservan el
  // estado entre aperturas porque el componente sigue montado).
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open) return;
    setTerm("");
    setSelectedId(null);
    setResults([]);
  }, [open]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Búsqueda con debounce contra la lista de contactos de la cuenta.
  useEffect(() => {
    if (!open || !accountId) return;
    let cancelled = false;
    const handle = setTimeout(async () => {
      if (cancelled) return;
      setLoading(true);
      const clean = sanitizeTerm(term);
      let query = supabase
        .from("contacts")
        .select("*")
        .eq("account_id", accountId)
        .neq("id", source.id);
      if (clean) {
        query = query.or(
          `name.ilike.%${clean}%,phone.ilike.%${clean}%,email.ilike.%${clean}%,document.ilike.%${clean}%`,
        );
      }
      const { data, error } = await query
        .order("created_at", { ascending: false })
        .limit(20);
      if (cancelled) return;
      if (error) {
        console.error("link-contact search failed:", error.message);
        setResults([]);
      } else {
        setResults((data ?? []) as Contact[]);
      }
      setLoading(false);
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [open, accountId, term, source.id, supabase]);

  const selected = results.find((c) => c.id === selectedId) ?? null;

  async function handleLink() {
    if (!selected || !source) return;
    setMerging(true);
    const { error } = await supabase.rpc("merge_contacts", {
      p_survivor: selected.id,
      p_loser: source.id,
    });
    if (error) {
      console.error("merge_contacts failed:", {
        message: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code,
      });
      toast.error("No se pudo vincular. Inténtalo de nuevo.");
      setMerging(false);
      return;
    }
    toast.success(`Conversación vinculada a ${selected.name || selected.phone}`);
    setMerging(false);
    onLinked(source.id, selected);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Vincular a un contacto existente</DialogTitle>
          <DialogDescription>
            Fusiona esta conversación y su prospecto con un contacto que ya
            tenías guardado. No se pierden mensajes, negocios ni notas.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Buscar por nombre, teléfono, correo o cédula…"
            className="pl-8"
          />
        </div>

        <ScrollArea className="h-64 rounded-lg border border-border">
          <div className="p-1">
            {loading ? (
              <div className="flex items-center justify-center py-8 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
              </div>
            ) : results.length === 0 ? (
              <p className="px-3 py-8 text-center text-xs text-muted-foreground">
                {term ? "Sin resultados" : "Escribe para buscar un contacto"}
              </p>
            ) : (
              results.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setSelectedId(c.id)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors hover:bg-muted",
                    selectedId === c.id && "bg-primary/10",
                  )}
                >
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                    {(c.name || c.phone || "?").charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {c.name || c.phone}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {[c.phone, c.email, c.document].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  {selectedId === c.id && (
                    <Check className="h-4 w-4 shrink-0 text-primary" />
                  )}
                </button>
              ))
            )}
          </div>
        </ScrollArea>

        {selected && (
          <p className="text-xs text-muted-foreground">
            Se moverán la conversación y el prospecto de{" "}
            <strong>{source.name || source.phone}</strong> a{" "}
            <strong>{selected.name || selected.phone}</strong>.
          </p>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={merging}
          >
            Cancelar
          </Button>
          <Button onClick={handleLink} disabled={!selected || merging}>
            {merging ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <Link2 className="mr-1 h-4 w-4" />
                Vincular
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

"use client";

// ============================================================
// Bots — listado provisional.
//
// Este es el punto de entrada del submenú Flujos > Bots. Por ahora
// muestra el esqueleto de búsqueda, nuevo bot y empty state; la
// persistencia y el builder de bots vendrán en una iteración posterior.
// ============================================================

import { Bot, Plus, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function BotsPage() {
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
            className="pl-9"
          />
        </div>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          Nuevo bot
        </Button>
      </div>

      <div className="rounded-xl border border-border bg-card py-16 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">
          <Bot className="h-6 w-6 text-muted-foreground" />
        </div>
        <p className="mt-4 text-sm font-medium">
          No se han encontrado bots. 😭
        </p>
        <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
          Crea un nuevo bot haciendo clic en el botón &quot;Nuevo bot&quot; de la
          esquina superior derecha.
        </p>
      </div>
    </div>
  );
}

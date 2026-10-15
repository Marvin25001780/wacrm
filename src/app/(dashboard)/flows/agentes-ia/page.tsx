"use client";

// ============================================================
// Agentes de IA — listado provisional.
//
// Punto de entrada del submenú Flujos > Agentes de IA. Muestra la
// cabecera, búsqueda, saldo de crédito y empty state. El formulario
// de entrenamiento, base de conocimientos y simulador se añadirán
// cuando se defina el backend de agentes.
// ============================================================

import { Brain, Plus, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function AiAgentsPage() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold">Agentes de IA</h1>
        <p className="text-sm text-muted-foreground">
          Entrena y gestiona agentes de IA para atender conversaciones según
          tus necesidades.
        </p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Buscar agentes..."
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">
            Saldo de Crédito IA: $0.00
          </span>
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            Nuevo
          </Button>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card py-16 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">
          <Brain className="h-6 w-6 text-muted-foreground" />
        </div>
        <p className="mt-4 text-sm font-medium">
          No hay agentes de IA configurados.
        </p>
        <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
          Crea tu primer agente para empezar a automatizar respuestas con IA.
        </p>
      </div>
    </div>
  );
}

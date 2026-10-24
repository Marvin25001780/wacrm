"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { ImportWizard } from "@/components/collections/import-wizard";

export default function ImportarPage() {
  return (
    <div className="space-y-5">
      <div>
        <Link
          href="/cobranza/cartera"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Volver a la cartera
        </Link>
      </div>

      <div>
        <h1 className="text-xl font-semibold text-foreground">Carga masiva de cartera</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Sube un Excel o CSV. El importador detecta las columnas, normaliza fechas,
          montos y teléfonos de Venezuela, y valida cada fila antes de crear deudores,
          créditos y cuotas.
        </p>
      </div>

      <ImportWizard />
    </div>
  );
}

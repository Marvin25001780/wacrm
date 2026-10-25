"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { PaymentImportWizard } from "@/components/collections/payment-import-wizard";

export default function PagosPage() {
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
        <h1 className="text-xl font-semibold text-foreground">Carga masiva de pagos</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Sube un Excel o CSV con los pagos del día. Cada fila se aplica a una cuota concreta
          (folio + número de cuota); el importador valida saldo, duplicados y método antes de
          registrar nada.
        </p>
      </div>

      <PaymentImportWizard />
    </div>
  );
}

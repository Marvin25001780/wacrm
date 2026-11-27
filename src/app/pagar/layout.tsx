// ============================================================
// /pagar/[token] — página pública de pago por deudor.
//
// Vive fuera de (dashboard) y (auth): la abre el deudor sin cuenta.
// El token va en la ruta, así que el layout fija `no-referrer` y
// `noindex` para que no se filtre a recursos externos ni a buscadores.
// ============================================================

import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Pagar mi cuota",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export default function PagarLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:py-12">
        {children}
      </div>
    </div>
  );
}

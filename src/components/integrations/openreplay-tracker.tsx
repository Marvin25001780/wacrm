'use client';

import { useEffect } from 'react';

// ============================================================
// Tracker de OpenReplay (MIT) montado sobre el CRM.
//
// Solo se carga si el negocio activó la integración en Ajustes →
// Integraciones y la ruta /api/integrations/external/openreplay
// devuelve una URL + project key. El import es dinámico para que el
// paquete no entre en el bundle inicial y para que el CRM siga
// funcionando si OpenReplay no responde.
//
// `started` vive en el módulo: React estricto monta el efecto dos
// veces en desarrollo y el tracker no debe iniciar dos sesiones.
// ============================================================

let started = false;

interface OpenReplayTrackerProps {
  userID: string;
  /** Nombre del negocio o del usuario, solo para depurar sesiones. */
  accountName?: string | null;
  role?: string | null;
}

export function OpenReplayTracker({
  userID,
  accountName,
  role,
}: OpenReplayTrackerProps) {
  useEffect(() => {
    let cancelled = false;

    async function boot() {
      try {
        const res = await fetch('/api/integrations/external/openreplay', {
          cache: 'no-store',
        });
        if (!res.ok) return;

        const config = (await res.json().catch(() => null)) as {
          enabled?: boolean;
          url?: string | null;
          projectKey?: string | null;
        } | null;

        if (
          cancelled ||
          started ||
          !config?.enabled ||
          !config.url ||
          !config.projectKey
        ) {
          return;
        }

        started = true;
        const { default: Tracker } = await import('@openreplay/tracker');
        const tracker = new Tracker({
          projectKey: config.projectKey,
          ingestPoint: `${config.url.replace(/\/+$/, '')}/ingest`,
        });

        await tracker.start({
          userID,
          metadata: {
            account: accountName ?? '',
            role: role ?? '',
          },
        });
      } catch (error) {
        // La grabación es opcional: nunca debe romper la navegación.
        console.warn('[openreplay] no se pudo iniciar el tracker:', error);
      }
    }

    void boot();
    return () => {
      cancelled = true;
    };
  }, [userID, accountName, role]);

  return null;
}

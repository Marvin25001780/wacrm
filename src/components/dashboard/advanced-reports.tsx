'use client';

import { BarChart3, MessageSquare, CheckCircle, Radio, Phone, Loader2 } from 'lucide-react';
import type { AdvancedMetrics } from '@/lib/dashboard/types';
import { Skeleton } from './skeleton';

interface AdvancedReportsProps {
  data: AdvancedMetrics | null;
  loading: boolean;
}

export function AdvancedReports({ data, loading }: AdvancedReportsProps) {
  if (loading || !data) {
    return (
      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-sm font-semibold text-foreground mb-4">Reportes avanzados</h2>
        <Skeleton className="h-48 w-full" />
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <h2 className="text-sm font-semibold text-foreground mb-4">Reportes avanzados</h2>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="rounded-lg bg-muted/40 p-4">
          <div className="flex items-center gap-2 text-muted-foreground mb-2">
            <MessageSquare className="h-4 w-4" />
            <span className="text-xs font-medium">Total conversaciones</span>
          </div>
          <p className="text-2xl font-bold text-foreground tabular-nums">{data.totalConversations}</p>
        </div>
        <div className="rounded-lg bg-muted/40 p-4">
          <div className="flex items-center gap-2 text-muted-foreground mb-2">
            <CheckCircle className="h-4 w-4" />
            <span className="text-xs font-medium">Tasa de resolución</span>
          </div>
          <p className="text-2xl font-bold text-foreground tabular-nums">{data.responseRate}%</p>
          <p className="text-xs text-muted-foreground">{data.resolvedConversations} resueltas</p>
        </div>
        <div className="rounded-lg bg-muted/40 p-4">
          <div className="flex items-center gap-2 text-muted-foreground mb-2">
            <Radio className="h-4 w-4" />
            <span className="text-xs font-medium">Total emisiones</span>
          </div>
          <p className="text-2xl font-bold text-foreground tabular-nums">{data.totalBroadcasts}</p>
        </div>
        <div className="rounded-lg bg-muted/40 p-4">
          <div className="flex items-center gap-2 text-muted-foreground mb-2">
            <BarChart3 className="h-4 w-4" />
            <span className="text-xs font-medium">Contactos activos (30d)</span>
          </div>
          <p className="text-2xl font-bold text-foreground tabular-nums">{data.topContacts.length}</p>
        </div>
      </div>

      {data.topContacts.length > 0 && (
        <div className="mt-4">
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
            Top contactos por mensajes (30 días)
          </h3>
          <div className="space-y-1">
            {data.topContacts.map((c, i) => (
              <div key={c.phone} className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm hover:bg-muted/40">
                <span className="w-5 text-xs text-muted-foreground tabular-nums">#{i + 1}</span>
                <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="flex-1 truncate text-foreground">{c.name || c.phone}</span>
                <span className="text-xs text-muted-foreground tabular-nums">{c.messageCount} msgs</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
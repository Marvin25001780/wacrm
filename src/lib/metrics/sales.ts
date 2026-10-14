// ============================================================
// Agregación de la sección VENTAS — módulo de Métricas.
//
// Función PURA (sin Supabase): recibe las ofertas (`deals`) relevantes
// al período —creadas en el período ∪ cerradas en el período— y los
// catálogos (perfiles, equipos/miembros, etapas, contactos) y devuelve:
//   • KPIs de ventas y cotizaciones
//   • serie diaria (vendido / cotizado)
//   • embudo por etapa (ofertas abiertas)
//   • tablas por agente, equipo y producto
//   • registro de ventas (ganadas en el período)
//
// Definiciones:
//   • cotización → oferta CREADA dentro del período (monto cotizado)
//   • venta      → oferta GANADA, contada por `closed_at`
//   • perdida    → oferta PERDIDA, contada por `closed_at`
//   • abierta    → oferta con estado distinto de won/lost (embudo)
//   • tasa de cierre = ganadas / (ganadas + perdidas)
// ============================================================

import { localDayKey } from "@/lib/dashboard/date-utils";

export interface SalesDealRow {
  id: string;
  title: string;
  value: number | string | null;
  currency: string | null;
  status: string | null;
  product: string | null;
  /** profiles.id del agente asignado (nullable). */
  assigned_to: string | null;
  pipeline_id: string | null;
  stage_id: string | null;
  contact_id: string | null;
  created_at: string;
  closed_at: string | null;
}

export interface SalesProfileOption {
  /** profiles.id */
  id: string;
  /** auth user id — por si `assigned_to` guardara el user id. */
  userId: string | null;
  name: string;
}

export interface SalesTeamOption {
  id: string;
  name: string;
}

export interface SalesTeamMemberRow {
  teamId: string;
  profileId: string;
}

export interface SalesStageRow {
  id: string;
  name: string;
  position: number;
  color: string | null;
}

export interface SalesContactRow {
  id: string;
  name: string | null;
}

export interface SalesSeriesPoint {
  day: string;
  soldValue: number;
  quotedValue: number;
  soldCount: number;
  quotedCount: number;
}

export interface SalesTableRow {
  key: string;
  name: string;
  quotedCount: number;
  quotedValue: number;
  wonCount: number;
  wonValue: number;
  lostCount: number;
  /** ganadas / (ganadas + perdidas); null si no hubo cierres. */
  winRate: number | null;
}

export interface SalesFunnelStage {
  stageId: string;
  name: string;
  color: string | null;
  count: number;
  value: number;
}

export interface SalesRecordRow {
  id: string;
  /** ISO del cierre (closed_at). */
  date: string;
  title: string;
  contactName: string;
  agentName: string;
  product: string;
  value: number;
  currency: string | null;
}

export interface SalesResult {
  totals: {
    wonCount: number;
    wonValue: number;
    lostCount: number;
    openCount: number;
    openValue: number;
    quotedCount: number;
    quotedValue: number;
    /** Monto vendido / número de ventas. */
    ticket: number | null;
    /** ganadas / (ganadas + perdidas). */
    winRate: number | null;
  };
  series: SalesSeriesPoint[];
  funnel: SalesFunnelStage[];
  agents: SalesTableRow[];
  teams: SalesTableRow[];
  products: SalesTableRow[];
  sales: SalesRecordRow[];
  /** Moneda dominante del período (para formatear los montos). */
  currency: string;
}

const UNASSIGNED_KEY = "__unassigned__";
const NO_TEAM_KEY = "__no_team__";
const NO_PRODUCT_KEY = "__no_product__";

function toNumber(v: number | string | null | undefined): number {
  const n = typeof v === "string" ? parseFloat(v) : v ?? 0;
  return Number.isFinite(n) ? (n as number) : 0;
}

function ensureRow(
  map: Map<string, SalesTableRow>,
  key: string,
  name: string
): SalesTableRow {
  let row = map.get(key);
  if (!row) {
    row = {
      key,
      name,
      quotedCount: 0,
      quotedValue: 0,
      wonCount: 0,
      wonValue: 0,
      lostCount: 0,
      winRate: null,
    };
    map.set(key, row);
  }
  return row;
}

function finalizeRows(map: Map<string, SalesTableRow>): SalesTableRow[] {
  const rows = [...map.values()];
  for (const r of rows) {
    const decided = r.wonCount + r.lostCount;
    r.winRate = decided > 0 ? r.wonCount / decided : null;
  }
  return rows.sort(
    (a, b) =>
      b.wonValue - a.wonValue ||
      b.quotedValue - a.quotedValue ||
      a.name.localeCompare(b.name)
  );
}

export function aggregateSales(
  deals: SalesDealRow[],
  profiles: SalesProfileOption[],
  teams: SalesTeamOption[],
  members: SalesTeamMemberRow[],
  stages: SalesStageRow[],
  contacts: SalesContactRow[],
  dayKeys: string[],
  fallbackCurrency: string
): SalesResult {
  const dayKeySet = new Set(dayKeys);

  const profileById = new Map(profiles.map((p) => [p.id, p]));
  const profileByUserId = new Map<string, SalesProfileOption>();
  for (const p of profiles) {
    if (p.userId) profileByUserId.set(p.userId, p);
  }
  const resolveProfile = (id: string | null): SalesProfileOption | null =>
    id ? profileById.get(id) ?? profileByUserId.get(id) ?? null : null;

  // Perfil → equipos a los que pertenece.
  const teamsByProfile = new Map<string, string[]>();
  for (const m of members) {
    const arr = teamsByProfile.get(m.profileId);
    if (arr) arr.push(m.teamId);
    else teamsByProfile.set(m.profileId, [m.teamId]);
  }

  const stageById = new Map(stages.map((s) => [s.id, s]));
  const contactNameById = new Map(contacts.map((c) => [c.id, c.name ?? ""]));

  const seriesMap = new Map<string, SalesSeriesPoint>();
  for (const day of dayKeys) {
    seriesMap.set(day, {
      day,
      soldValue: 0,
      quotedValue: 0,
      soldCount: 0,
      quotedCount: 0,
    });
  }

  const agents = new Map<string, SalesTableRow>();
  const teamsAgg = new Map<string, SalesTableRow>();
  const products = new Map<string, SalesTableRow>();
  const funnelMap = new Map<string, SalesFunnelStage>();

  const totals = {
    wonCount: 0,
    wonValue: 0,
    lostCount: 0,
    openCount: 0,
    openValue: 0,
    quotedCount: 0,
    quotedValue: 0,
    ticket: null as number | null,
    winRate: null as number | null,
  };

  const sales: SalesRecordRow[] = [];
  const currencyCounts = new Map<string, number>();

  for (const d of deals) {
    const value = toNumber(d.value);
    const status = d.status ?? "open";

    const profile = resolveProfile(d.assigned_to);
    const agentKey = profile?.id ?? UNASSIGNED_KEY;
    const agentName = profile?.name ?? "Sin agente";
    const memberTeamIds = profile ? teamsByProfile.get(profile.id) ?? [] : [];
    const rawProduct = (d.product ?? "").trim();
    const productKey = rawProduct || NO_PRODUCT_KEY;
    const productName = rawProduct || "Sin producto";

    // Filas destino (agente + sus equipos + producto), creadas on-demand.
    const targets: SalesTableRow[] = [
      ensureRow(agents, agentKey, agentName),
      ensureRow(products, productKey, productName),
    ];
    if (memberTeamIds.length === 0) {
      targets.push(ensureRow(teamsAgg, NO_TEAM_KEY, "Sin equipo"));
    } else {
      for (const teamId of memberTeamIds) {
        const teamName = teams.find((t) => t.id === teamId)?.name ?? "Equipo";
        targets.push(ensureRow(teamsAgg, teamId, teamName));
      }
    }

    // ---- Cotización: oferta creada dentro del período -------------
    const createdDay = localDayKey(d.created_at);
    if (dayKeySet.has(createdDay)) {
      totals.quotedCount += 1;
      totals.quotedValue += value;
      const point = seriesMap.get(createdDay);
      if (point) {
        point.quotedCount += 1;
        point.quotedValue += value;
      }
      for (const t of targets) {
        t.quotedCount += 1;
        t.quotedValue += value;
      }
    }

    // ---- Cierre: ganada / perdida dentro del período --------------
    if (d.closed_at && (status === "won" || status === "lost")) {
      const closedDay = localDayKey(d.closed_at);
      if (dayKeySet.has(closedDay)) {
        if (status === "won") {
          totals.wonCount += 1;
          totals.wonValue += value;
          const point = seriesMap.get(closedDay);
          if (point) {
            point.soldCount += 1;
            point.soldValue += value;
          }
          for (const t of targets) {
            t.wonCount += 1;
            t.wonValue += value;
          }
          const currency = (d.currency ?? "").trim();
          if (currency) {
            currencyCounts.set(currency, (currencyCounts.get(currency) ?? 0) + 1);
          }
          sales.push({
            id: d.id,
            date: d.closed_at,
            title: d.title,
            contactName: d.contact_id
              ? contactNameById.get(d.contact_id) ?? ""
              : "",
            agentName,
            product: productName,
            value,
            currency: d.currency ?? null,
          });
        } else {
          totals.lostCount += 1;
          for (const t of targets) t.lostCount += 1;
        }
      }
    }

    // ---- Embudo: ofertas abiertas ahora --------------------------
    if (status !== "won" && status !== "lost") {
      totals.openCount += 1;
      totals.openValue += value;
      const stage = d.stage_id ? stageById.get(d.stage_id) : null;
      const stageId = d.stage_id ?? "__no_stage__";
      const funnelStage: SalesFunnelStage =
        funnelMap.get(stageId) ?? {
          stageId,
          name: stage?.name ?? "Sin etapa",
          color: stage?.color ?? null,
          count: 0,
          value: 0,
        };
      funnelStage.count += 1;
      funnelStage.value += value;
      funnelMap.set(stageId, funnelStage);
    }
  }

  const decided = totals.wonCount + totals.lostCount;
  totals.ticket = totals.wonCount > 0 ? totals.wonValue / totals.wonCount : null;
  totals.winRate = decided > 0 ? totals.wonCount / decided : null;

  // Moneda dominante entre las ventas del período.
  let currency = fallbackCurrency;
  let best = 0;
  for (const [code, count] of currencyCounts.entries()) {
    if (count > best) {
      best = count;
      currency = code;
    }
  }

  const series = dayKeys.map(
    (day) =>
      seriesMap.get(day) ?? {
        day,
        soldValue: 0,
        quotedValue: 0,
        soldCount: 0,
        quotedCount: 0,
      }
  );

  const funnel = [...funnelMap.values()].sort(
    (a, b) =>
      (stageById.get(a.stageId)?.position ?? 9999) -
        (stageById.get(b.stageId)?.position ?? 9999) ||
      a.name.localeCompare(b.name)
  );

  sales.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  return {
    totals,
    series,
    funnel,
    agents: finalizeRows(agents),
    teams: finalizeRows(teamsAgg),
    products: finalizeRows(products),
    sales,
    currency,
  };
}

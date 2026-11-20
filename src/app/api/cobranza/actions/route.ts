import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  allowedDebtorStatuses,
  DEFAULT_ACTION_CHANNEL,
  isActionChannel,
  tramoForDays,
  validateActionInput,
} from '@/lib/collections/desk';
import { todayIso } from '@/lib/collections/format';
import type {
  CollectionDebtorStatus,
  CollectionOutcome,
  CollectionPolicy,
} from '@/types/collections';

/**
 * POST /api/cobranza/actions
 *
 * Registra una gestión de cobranza. Si la tipificación es una promesa
 * de pago, crea la PTP en la misma transacción (RPC
 * `collection_record_action`, migración 125).
 *
 * Body:
 *   debtorId        UUID obligatorio
 *   level1 / level2 códigos de `collection_outcomes`
 *   channel         call | whatsapp | sms | email | visit | other
 *   direction       outbound | inbound (por defecto outbound)
 *   notes           texto libre (máx. 2000)
 *   creditId        obligatorio si level2 = ptp
 *   installmentId   opcional, debe ser del deudor
 *   amount          obligatorio si la tipificación lo exige
 *   dueDate         obligatorio si la tipificación lo exige
 *   debtorStatus    opcional (lista blanca por rol)
 *   callSessionId   opcional, liga la llamada del softphone
 *
 * La validación se hace en TypeScript para devolver mensajes legibles
 * antes de tocar la base; la función repite las comprobaciones que
 * protegen el dinero (crédito del deudor, fecha de la PTP, llamada
 * propia).
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('agent');
    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;

    const debtorId = asUuid(body.debtorId);
    if (!debtorId) {
      return NextResponse.json({ error: 'Falta el deudor.' }, { status: 400 });
    }

    const level1 = asText(body.level1);
    const level2 = asText(body.level2) || null;
    if (!level1) {
      return NextResponse.json(
        { error: 'Elige una tipificación de contacto.' },
        { status: 400 }
      );
    }

    const channel = isActionChannel(body.channel)
      ? body.channel
      : DEFAULT_ACTION_CHANNEL;
    const direction = body.direction === 'inbound' ? 'inbound' : 'outbound';
    const notes = asText(body.notes, 2000) || null;
    const creditId = asUuid(body.creditId);
    const installmentId = asUuid(body.installmentId);
    const callSessionId = asUuid(body.callSessionId);
    const amount = asAmount(body.amount);
    const dueDate = asDate(body.dueDate);

    const rawStatus = asText(body.debtorStatus);
    let debtorStatus: CollectionDebtorStatus | null = null;
    if (rawStatus) {
      const isAdmin = ctx.role === 'admin' || ctx.role === 'owner';
      const allowed = allowedDebtorStatuses(isAdmin);
      if (!allowed.includes(rawStatus as CollectionDebtorStatus)) {
        return NextResponse.json(
          { error: 'Ese estado del deudor no lo puede fijar tu rol.' },
          { status: 403 }
        );
      }
      debtorStatus = rawStatus as CollectionDebtorStatus;
    }

    // ---- Contexto del deudor: créditos, cuotas y política del tramo ----
    const { data: debtor, error: debtorError } = await ctx.supabase
      .from('collection_debtors')
      .select('id, account_id')
      .eq('id', debtorId)
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (debtorError) throw debtorError;
    if (!debtor) {
      return NextResponse.json(
        { error: 'Deudor no encontrado.' },
        { status: 404 }
      );
    }

    const [outcomeResult, installmentResult, summaryResult] = await Promise.all([
      ctx.supabase
        .from('collection_outcomes')
        .select(
          'code, level, parent_code, requires_amount, requires_date, requires_reason, active'
        ),
      ctx.supabase
        .from('collection_installments')
        .select('id, credit_id, total, paid_amount, status')
        .eq('debtor_id', debtorId),
      ctx.supabase
        .from('v_collection_debtor_summary')
        .select('days_overdue_max')
        .eq('id', debtorId)
        .maybeSingle(),
    ]);

    if (outcomeResult.error) throw outcomeResult.error;
    if (installmentResult.error) throw installmentResult.error;

    const outcomes = (outcomeResult.data ?? []) as CollectionOutcome[];
    const installments = (installmentResult.data ?? []) as Array<{
      id: string;
      credit_id: string;
      total: number;
      paid_amount: number;
      status: string;
    }>;

    const balances = new Map<string, number>();
    for (const installment of installments) {
      if (
        installment.status !== 'pending' &&
        installment.status !== 'partial'
      ) {
        continue;
      }
      const balance = Math.max(
        0,
        Number(installment.total) - Number(installment.paid_amount)
      );
      balances.set(
        installment.credit_id,
        (balances.get(installment.credit_id) ?? 0) + balance
      );
    }
    const credits = [...balances.entries()].map(([id, balance]) => ({
      id,
      balance,
    }));

    const daysOverdue = Number(
      (summaryResult.data as { days_overdue_max?: number } | null)
        ?.days_overdue_max ?? 0
    );
    const policy = await loadPolicy(ctx, daysOverdue);

    const errors = validateActionInput(
      { level1, level2, channel, notes, amount, dueDate, creditId },
      outcomes,
      { today: todayIso(), credits, policy }
    );

    if (errors.length > 0) {
      return NextResponse.json({ error: errors[0], errors }, { status: 400 });
    }

    if (installmentId && !installments.some((row) => row.id === installmentId)) {
      return NextResponse.json(
        { error: 'La cuota elegida no pertenece a este deudor.' },
        { status: 400 }
      );
    }

    // ---- Escritura atómica ----
    const { data, error } = await ctx.supabase.rpc('collection_record_action', {
      p_debtor_id: debtorId,
      p_level1: level1,
      p_level2: level2,
      p_channel: channel,
      p_direction: direction,
      p_notes: notes,
      p_credit_id: creditId,
      p_installment_id: installmentId,
      p_amount: amount,
      p_due_date: dueDate,
      p_debtor_status: debtorStatus,
      p_call_session_id: callSessionId,
    });

    if (error) {
      if (isMissingFunction(error)) {
        return NextResponse.json(
          {
            error:
              'Falta aplicar la migración 125_collection_agent_desk.sql para registrar gestiones.',
            migration: '125',
          },
          { status: 409 }
        );
      }
      // Los RAISE de la función son legibles a propósito.
      return NextResponse.json(
        { error: error.message ?? 'No se pudo registrar la gestión.' },
        { status: 400 }
      );
    }

    const result = (data ?? {}) as {
      action_id?: string;
      promise_id?: string | null;
      debtor_status?: string | null;
    };

    return NextResponse.json({
      actionId: result.action_id ?? null,
      promiseId: result.promise_id ?? null,
      debtorStatus: result.debtor_status ?? null,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

type AccountContext = Awaited<ReturnType<typeof requireRole>>;

async function loadPolicy(
  ctx: AccountContext,
  daysOverdue: number
): Promise<CollectionPolicy | null> {
  const { data, error } = await ctx.supabase
    .from('collection_policies')
    .select(
      'ptp_max_days, min_down_payment_pct, max_discount_pct, max_attempts_per_day, allowed_start, allowed_end'
    )
    .eq('account_id', ctx.accountId)
    .eq('tramo', tramoForDays(daysOverdue))
    .eq('active', true)
    .maybeSingle();

  // Sin política configurada se usan los valores por defecto del
  // esquema (7 días, 0 % de abono). No se inventa una regla.
  if (error || !data) return null;
  return data as unknown as CollectionPolicy;
}

function isMissingFunction(error: { code?: string } | null): boolean {
  return (
    error?.code === '42883' ||
    error?.code === 'PGRST202' ||
    error?.code === 'PGRST205'
  );
}

function asText(value: unknown, max = 400): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, max);
}

function asUuid(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)
    ? trimmed
    : null;
}

function asAmount(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.round(parsed * 100) / 100;
}

function asDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null;
}

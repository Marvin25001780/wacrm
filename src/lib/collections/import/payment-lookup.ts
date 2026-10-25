import type { SupabaseClient } from "@supabase/supabase-js";

import { installmentKey, type PaymentInstallmentRef } from "./payments";

const CHUNK = 300;

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

interface CreditRow {
  id: string;
  folio: string;
  debtor_id: string;
}

interface InstallmentRow {
  id: string;
  credit_id: string;
  number: number;
  total: number | string;
  paid_amount: number | string;
  status: string;
}

/**
 * Carga las cuotas reales para los pares folio + número del archivo.
 * Solo se consultan folios presentes en el lote.
 */
export async function loadInstallmentRefs(
  supabase: SupabaseClient,
  accountId: string,
  folios: string[],
): Promise<Map<string, PaymentInstallmentRef>> {
  const uniqueFolios = [...new Set(folios.map((folio) => folio.trim()).filter(Boolean))];
  if (uniqueFolios.length === 0) return new Map();

  const credits: CreditRow[] = [];
  for (const group of chunks(uniqueFolios, CHUNK)) {
    const { data, error } = await supabase
      .from("collection_credits")
      .select("id, folio, debtor_id")
      .eq("account_id", accountId)
      .in("folio", group);
    if (error) throw error;
    credits.push(...((data ?? []) as CreditRow[]));
  }

  if (credits.length === 0) return new Map();

  const creditIds = credits.map((credit) => credit.id);
  const installments: InstallmentRow[] = [];
  for (const group of chunks(creditIds, CHUNK)) {
    const { data, error } = await supabase
      .from("collection_installments")
      .select("id, credit_id, number, total, paid_amount, status")
      .in("credit_id", group);
    if (error) throw error;
    installments.push(...((data ?? []) as InstallmentRow[]));
  }

  const debtorIds = [...new Set(credits.map((credit) => credit.debtor_id))];
  const debtors = new Map<string, { name: string | null; document_number: string | null }>();
  for (const group of chunks(debtorIds, CHUNK)) {
    const { data, error } = await supabase
      .from("collection_debtors")
      .select("id, name, document_number")
      .in("id", group);
    if (error) throw error;
    for (const debtor of data ?? []) {
      debtors.set(debtor.id as string, {
        name: (debtor.name as string | null) ?? null,
        document_number: (debtor.document_number as string | null) ?? null,
      });
    }
  }

  const byCredit = new Map(credits.map((credit) => [credit.id, credit]));
  const refs = new Map<string, PaymentInstallmentRef>();

  for (const installment of installments) {
    const credit = byCredit.get(installment.credit_id);
    if (!credit || installment.status === "cancelled") continue;

    const debtor = debtors.get(credit.debtor_id);
    refs.set(installmentKey(credit.folio, installment.number), {
      installment_id: installment.id,
      credit_id: installment.credit_id,
      debtor_id: credit.debtor_id,
      debtor_name: debtor?.name ?? null,
      document_number: debtor?.document_number ?? null,
      folio: credit.folio,
      installment_number: installment.number,
      balance: Math.max(
        Number(installment.total ?? 0) - Number(installment.paid_amount ?? 0),
        0,
      ),
    });
  }

  return refs;
}

import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import type { CollectionReceipt } from "@/lib/collections/payment-links-shared";
import { signChatMediaUrl } from "@/lib/storage/chat-media";

const STATUSES = ["pending", "approved", "rejected"] as const;
type ReceiptStatus = (typeof STATUSES)[number];

/**
 * GET /api/cobranza/comprobantes?status=pending|approved|rejected|all
 *
 * Bandeja de comprobantes reportados por los deudores. Devuelve el
 * nombre del deudor y los conteos por estado para pintar las pestañas
 * sin tres llamadas desde el navegador.
 */
export async function GET(request: Request) {
  try {
    const ctx = await requireRole("agent");
    const url = new URL(request.url);
    const requested = url.searchParams.get("status")?.trim() ?? "all";
    const status: ReceiptStatus | "all" = requested === "all"
      ? "all"
      : STATUSES.includes(requested as ReceiptStatus)
        ? (requested as ReceiptStatus)
        : "all";

    let query = ctx.supabase
      .from("collection_receipts")
      .select("*")
      .eq("account_id", ctx.accountId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (status !== "all") query = query.eq("status", status);

    const [listRes, pendingRes, approvedRes, rejectedRes] = await Promise.all([
      query,
      ctx.supabase
        .from("collection_receipts")
        .select("id", { count: "exact", head: true })
        .eq("account_id", ctx.accountId)
        .eq("status", "pending"),
      ctx.supabase
        .from("collection_receipts")
        .select("id", { count: "exact", head: true })
        .eq("account_id", ctx.accountId)
        .eq("status", "approved"),
      ctx.supabase
        .from("collection_receipts")
        .select("id", { count: "exact", head: true })
        .eq("account_id", ctx.accountId)
        .eq("status", "rejected"),
    ]);

    if (listRes.error) {
      if (listRes.error.code === "42P01" || listRes.error.code === "PGRST205") {
        return NextResponse.json({
          receipts: [],
          counts: { pending: 0, approved: 0, rejected: 0 },
          migration_pending: true,
        });
      }
      throw new Error(listRes.error.message);
    }

    const rows = (listRes.data ?? []) as CollectionReceipt[];
    const debtorIds = [...new Set(rows.map((row) => row.debtor_id))];
    const names = new Map<string, string>();
    if (debtorIds.length > 0) {
      const { data: debtors } = await ctx.supabase
        .from("collection_debtors")
        .select("id, name")
        .in("id", debtorIds);
      for (const debtor of debtors ?? []) {
        names.set(debtor.id as string, (debtor.name as string) ?? "Deudor");
      }
    }

    return NextResponse.json({
      receipts: await Promise.all(
        rows.map(async (row) => ({
          ...row,
          debtor_name: names.get(row.debtor_id) ?? "Deudor",
          file_signed_url: row.file_url
            ? await signChatMediaUrl(ctx.supabase, row.file_url, 60 * 60)
            : null,
        })),
      ),
      counts: {
        pending: pendingRes.count ?? 0,
        approved: approvedRes.count ?? 0,
        rejected: rejectedRes.count ?? 0,
      },
      migration_pending: false,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

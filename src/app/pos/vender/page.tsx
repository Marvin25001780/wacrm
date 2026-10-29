"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  Loader2,
  Minus,
  Percent,
  Plus,
  Receipt,
  Search,
  ShoppingCart,
  Trash2,
  X,
} from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { usePosRate } from "@/components/pos/rate-context";
import { usePosShift } from "@/components/pos/shift-context";
import { SaleReceiptDialog } from "@/components/pos/sale-receipt-dialog";
import { PosButton, PosPageHeader } from "@/components/pos/pos-shell";
import { createClient } from "@/lib/supabase/client";
import {
  PAYMENT_METHODS,
  type PaymentMethod,
  bsToUsd,
  computeTotals,
  formatBs,
  formatUsd,
  igtfOf,
  round2,
  toNumber,
  usdToBs,
} from "@/lib/pos/money";

interface Product {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  kind: "product" | "supply" | "service";
  unit: string;
  cost_usd: number | string;
  price_usd: number | string;
  stock: number | string;
  taxable: boolean;
  is_parent?: boolean;
}

interface Line {
  productId: string;
  name: string;
  unitPrice: number;
  cost: number;
  taxable: boolean;
  quantity: number;
  discount: number;
}

interface Payment {
  id: string;
  method: PaymentMethod;
  amount: string;
  accountId: string;
  reference: string;
  received: string;
}

interface SurchargeRow {
  id: string;
  name: string;
  kind: "percent" | "fixed";
  value: number | string;
}

interface PriceListRow {
  id: string;
  name: string;
  is_default: boolean;
}

interface SaleChannelRow {
  id: string;
  name: string;
  is_default: boolean;
}

interface ProductPriceRow {
  product_id: string;
  price_list_id: string;
  price_usd: number | string;
}

interface DiscountRow {
  id: string;
  name: string;
  code: string;
  kind: "percent" | "fixed";
  value: number | string;
}

function newPayment(method: PaymentMethod = "cash_usd", accountId = ""): Payment {
  return {
    id: crypto.randomUUID(),
    method,
    amount: "",
    accountId,
    reference: "",
    received: "",
  };
}

/** Reparte un descuento global entre las líneas, proporcional al importe. */
function withGlobalDiscount(lines: Line[], amount: number): Line[] {
  const gross = lines.reduce(
    (sum, line) => sum + round2(line.quantity * line.unitPrice),
    0,
  );
  if (amount <= 0 || gross <= 0) {
    return lines.map((line) => ({ ...line, discount: 0 }));
  }

  const capped = Math.min(round2(amount), round2(gross));
  let remaining = capped;

  return lines.map((line, index) => {
    const lineGross = round2(line.quantity * line.unitPrice);
    const share =
      index === lines.length - 1
        ? remaining
        : round2(capped * (lineGross / gross));
    const safe = Math.max(0, Math.min(share, lineGross, remaining));
    remaining = round2(remaining - safe);
    return { ...line, discount: safe };
  });
}

export default function VenderPage() {
  const { accountId } = useAuth();
  const { rate } = usePosRate();
  const {
    shift: openShift,
    loading: shiftLoading,
    missing: shiftMissing,
  } = usePosShift();

  const [products, setProducts] = useState<Product[]>([]);
  const [accounts, setAccounts] = useState<
    { id: string; name: string; currency: "USD" | "VES" }[]
  >([]);
  const [customers, setCustomers] = useState<{ id: string; name: string }[]>([]);
  const [surchargeOptions, setSurchargeOptions] = useState<SurchargeRow[]>([]);
  const [priceLists, setPriceLists] = useState<PriceListRow[]>([]);
  const [prices, setPrices] = useState<ProductPriceRow[]>([]);
  const [priceListId, setPriceListId] = useState("");
  const [priceListsReady, setPriceListsReady] = useState(false);
  const [saleChannels, setSaleChannels] = useState<SaleChannelRow[]>([]);
  const [saleChannelId, setSaleChannelId] = useState("");
  const [saleChannelsReady, setSaleChannelsReady] = useState(false);
  const [selectedSurcharges, setSelectedSurcharges] = useState<string[]>([]);
  const [discountCode, setDiscountCode] = useState("");
  const [appliedDiscount, setAppliedDiscount] = useState<DiscountRow | null>(
    null,
  );
  const [discountError, setDiscountError] = useState<string | null>(null);
  const [applyingCode, setApplyingCode] = useState(false);
  const [customerId, setCustomerId] = useState("");
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<Line[]>([]);
  const [payments, setPayments] = useState<Payment[]>([newPayment()]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{
    saleId: string;
    number: number;
    total: number;
  } | null>(null);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [receiptSaleId, setReceiptSaleId] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!accountId) return;
    const supabase = createClient();
    setLoading(true);
    const [
      productsRes,
      accountsRes,
      customersRes,
      surchargesRes,
      listsRes,
      pricesRes,
      saleChannelsRes,
    ] = await Promise.all([
        supabase
          .from("pos_products")
          .select(
            "id, name, sku, barcode, kind, unit, cost_usd, price_usd, stock, taxable, is_parent",
          )
          .eq("account_id", accountId)
          .eq("active", true)
          .neq("kind", "supply")
          .eq("is_parent", false)
          .order("name"),
        supabase
          .from("pos_accounts")
          .select("id, name, currency")
          .eq("account_id", accountId)
          .eq("active", true)
          .order("name"),
        supabase
          .from("pos_customers")
          .select("id, name")
          .eq("account_id", accountId)
          .eq("active", true)
          .order("name"),
        supabase
          .from("pos_surcharges")
          .select("id, name, kind, value")
          .eq("account_id", accountId)
          .eq("active", true)
          .eq("charge_customer", true)
          .order("name"),
        supabase
          .from("pos_price_lists")
          .select("id, name, is_default")
          .eq("account_id", accountId)
          .eq("active", true)
          .order("is_default", { ascending: false })
          .order("name"),
        supabase
          .from("pos_product_prices")
          .select("product_id, price_list_id, price_usd")
          .eq("account_id", accountId),
        supabase
          .from("pos_sale_channels")
          .select("id, name, is_default")
          .eq("account_id", accountId)
          .eq("active", true)
          .order("is_default", { ascending: false })
          .order("name"),
      ]);
    let productRows = (productsRes.data ?? []) as Product[];
    if (productsRes.error) {
      const fallback = await supabase
        .from("pos_products")
        .select(
          "id, name, sku, barcode, kind, unit, cost_usd, price_usd, stock, taxable",
        )
        .eq("account_id", accountId)
        .eq("active", true)
        .neq("kind", "supply")
        .order("name");
      productRows = (fallback.data ?? []) as Product[];
    }
    setProducts(productRows);
    setAccounts(
      (accountsRes.data ?? []) as { id: string; name: string; currency: "USD" | "VES" }[],
    );
    setCustomers((customersRes.data ?? []) as { id: string; name: string }[]);
    setSurchargeOptions((surchargesRes.data ?? []) as SurchargeRow[]);

    if (listsRes.error) {
      setPriceListsReady(false);
      setPriceLists([
        { id: "principal", name: "Principal", is_default: true },
      ]);
      setPriceListId("principal");
      setPrices([]);
    } else {
      const lists = (listsRes.data ?? []) as PriceListRow[];
      setPriceListsReady(true);
      setPriceLists(lists);
      setPriceListId(
        (current) => current || lists.find((list) => list.is_default)?.id || lists[0]?.id || "",
      );
      setPrices((pricesRes.data ?? []) as ProductPriceRow[]);
    }

    // Canal de venta (Tienda, Delivery...). Si la migración 102 todavía
    // no está aplicada, el selector simplemente no aparece.
    if (saleChannelsRes.error) {
      setSaleChannelsReady(false);
      setSaleChannels([]);
      setSaleChannelId("");
    } else {
      const channels = (saleChannelsRes.data ?? []) as SaleChannelRow[];
      setSaleChannelsReady(true);
      setSaleChannels(channels);
      setSaleChannelId(
        (current) =>
          current ||
          channels.find((channel) => channel.is_default)?.id ||
          channels[0]?.id ||
          "",
      );
    }

    setLoading(false);
  }, [accountId]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return products;
    return products.filter(
      (product) =>
        product.name.toLowerCase().includes(term) ||
        (product.sku ?? "").toLowerCase().includes(term) ||
        (product.barcode ?? "").toLowerCase().includes(term),
    );
  }, [products, search]);

  const priceIndex = useMemo(() => {
    const map = new Map<string, Map<string, number>>();
    for (const row of prices) {
      let byList = map.get(row.product_id);
      if (!byList) {
        byList = new Map();
        map.set(row.product_id, byList);
      }
      byList.set(row.price_list_id, toNumber(row.price_usd));
    }
    return map;
  }, [prices]);

  const channel =
    priceLists.find((list) => list.id === priceListId) ?? priceLists[0] ?? null;

  function channelPrice(product: Product): number {
    if (!channel || channel.is_default) return toNumber(product.price_usd);
    return (
      priceIndex.get(product.id)?.get(channel.id) ??
      toNumber(product.price_usd)
    );
  }

  function addProduct(product: Product) {
    setSuccess(null);
    setCart((current) => {
      const existing = current.find((line) => line.productId === product.id);
      if (existing) {
        return current.map((line) =>
          line.productId === product.id
            ? { ...line, quantity: line.quantity + 1 }
            : line,
        );
      }
      return [
        ...current,
        {
          productId: product.id,
          name: product.name,
          unitPrice: channelPrice(product),
          cost: toNumber(product.cost_usd),
          taxable: product.taxable,
          quantity: 1,
          discount: 0,
        },
      ];
    });
  }

  function setQuantity(productId: string, quantity: number) {
    setCart((current) =>
      current
        .map((line) =>
          line.productId === productId
            ? { ...line, quantity: Math.max(quantity, 0) }
            : line,
        )
        .filter((line) => line.quantity > 0),
    );
  }

  function removeLine(productId: string) {
    setCart((current) => current.filter((l) => l.productId !== productId));
  }

  const grossSubtotal = useMemo(
    () =>
      round2(
        cart.reduce(
          (sum, line) => sum + round2(line.quantity * line.unitPrice),
          0,
        ),
      ),
    [cart],
  );

  const discountAmount = useMemo(() => {
    if (!appliedDiscount || grossSubtotal <= 0) return 0;
    const value = toNumber(appliedDiscount.value);
    return appliedDiscount.kind === "percent"
      ? round2((grossSubtotal * value) / 100)
      : Math.min(round2(value), grossSubtotal);
  }, [appliedDiscount, grossSubtotal]);

  const cartFinal = useMemo(
    () => withGlobalDiscount(cart, discountAmount),
    [cart, discountAmount],
  );

  const totalsBase = useMemo(
    () => computeTotals(cartFinal, { usdPaidBase: 0 }),
    [cartFinal],
  );

  const surchargeTotal = useMemo(
    () =>
      round2(
        surchargeOptions
          .filter((row) => selectedSurcharges.includes(row.id))
          .reduce((sum, row) => {
            const value = toNumber(row.value);
            return (
              sum +
              (row.kind === "percent"
                ? round2((totalsBase.subtotal * value) / 100)
                : value)
            );
          }, 0),
      ),
    [surchargeOptions, selectedSurcharges, totalsBase.subtotal],
  );

  const resolved = useMemo(() => {
    return payments.map((payment) => {
      const method = PAYMENT_METHODS.find((m) => m.value === payment.method)!;
      const raw = toNumber(payment.amount);
      const amountUsd =
        method.currency === "VES" ? bsToUsd(raw, rate) : round2(raw);
      const igtf = method.currency === "USD" ? igtfOf(amountUsd) : 0;
      return { ...payment, currency: method.currency, amountUsd, igtf };
    });
  }, [payments, rate]);

  const igtfTotal = round2(resolved.reduce((sum, p) => sum + p.igtf, 0));
  const total = round2(totalsBase.base + surchargeTotal + igtfTotal);
  const covered = round2(
    resolved.reduce((sum, p) => sum + p.amountUsd + p.igtf, 0),
  );
  const remaining = round2(total - covered);

  const change = useMemo(() => {
    let usd = 0;
    let bs = 0;
    for (const payment of resolved) {
      const received = toNumber(payment.received);
      if (received <= 0) continue;
      if (payment.method === "cash_usd") {
        const due = round2(payment.amountUsd + payment.igtf);
        if (received > due + 0.005) usd += received - due;
      } else if (payment.method === "cash_bs") {
        const due = round2(toNumber(payment.amount));
        if (received > due + 0.005) bs += received - due;
      }
    }
    return { usd: round2(usd), bs: round2(bs) };
  }, [resolved]);

  function changeOf(payment: Payment): number {
    const resolvedPayment = resolved.find((row) => row.id === payment.id);
    if (!resolvedPayment || !payment.received) return 0;
    const received = toNumber(payment.received);
    if (payment.method === "cash_usd") {
      const due = round2(
        resolvedPayment.amountUsd + resolvedPayment.igtf,
      );
      return received > due + 0.005 ? round2(received - due) : 0;
    }
    if (payment.method === "cash_bs") {
      const due = round2(toNumber(resolvedPayment.amount));
      return received > due + 0.005 ? round2(received - due) : 0;
    }
    return 0;
  }

  function fillExact() {
    const usdAccount = accounts.find((account) => account.currency === "USD");
    setPayments([
      {
        ...newPayment("cash_usd", usdAccount?.id ?? ""),
        amount: String(round2(totalsBase.base + surchargeTotal)),
      },
    ]);
  }

  async function applyDiscountCode() {
    const code = discountCode.trim().toUpperCase();
    if (!code) return;
    if (!accountId) return;
    if (cart.length === 0) {
      setDiscountError("Agrega productos antes de aplicar un código.");
      return;
    }

    setApplyingCode(true);
    setDiscountError(null);
    const supabase = createClient();
    const { data, error: codeError } = await supabase
      .from("pos_discounts")
      .select(
        "id, name, code, kind, value, max_uses, used_count, valid_from, valid_to, active",
      )
      .eq("account_id", accountId)
      .eq("code", code)
      .maybeSingle();
    setApplyingCode(false);

    if (codeError) {
      setDiscountError(
        "No se pudo validar el código. Revisa que la migración 090 esté aplicada.",
      );
      return;
    }
    if (!data) {
      setDiscountError("Ese código no existe.");
      return;
    }
    if (!data.active) {
      setDiscountError("Ese descuento está inactivo.");
      return;
    }

    const today = new Date().toLocaleDateString("en-CA", {
      timeZone: "America/Caracas",
    });
    if (data.valid_from && today < data.valid_from) {
      setDiscountError("Ese descuento todavía no está vigente.");
      return;
    }
    if (data.valid_to && today > data.valid_to) {
      setDiscountError("Ese descuento ya venció.");
      return;
    }
    if (data.max_uses != null && data.used_count >= data.max_uses) {
      setDiscountError("Ese descuento agotó sus usos.");
      return;
    }

    setAppliedDiscount(data as DiscountRow);
    setDiscountCode(data.code);
    setDiscountError(null);
  }

  function clearDiscount() {
    setAppliedDiscount(null);
    setDiscountCode("");
    setDiscountError(null);
  }

  function toggleSurcharge(id: string) {
    setSelectedSurcharges((current) =>
      current.includes(id)
        ? current.filter((value) => value !== id)
        : [...current, id],
    );
  }

  function updatePayment(id: string, patch: Partial<Payment>) {
    setPayments((current) =>
      current.map((payment) =>
        payment.id === id ? { ...payment, ...patch } : payment,
      ),
    );
  }

  async function cobrar() {
    if (!accountId) return;
    setError(null);

    if (cart.length === 0) {
      setError("Agrega al menos un producto.");
      return;
    }
    if (remaining > 0.005) {
      setError("El pago no cubre el total de la venta.");
      return;
    }
    if (covered > total + 0.005) {
      setError(
        "El pago supera el total. Usa “Cobrar exacto” y anota el recibido para calcular el vuelto.",
      );
      return;
    }

    const hasVes = resolved.some((p) => p.currency === "VES" && p.amountUsd > 0);
    if (hasVes && rate <= 0) {
      setError("Configura la tasa del día para cobrar en bolívares.");
      return;
    }

    setSaving(true);
    const supabase = createClient();

    const salePayload: Record<string, unknown> = {
      p_items: cartFinal.map((line) => ({
        product_id: line.productId,
        quantity: line.quantity,
        unit_price_usd: line.unitPrice,
        discount_usd: line.discount,
      })),
      p_payments: resolved
        .filter((payment) => payment.amountUsd > 0)
        .map((payment) => ({
          method: payment.method,
          currency: payment.currency,
          amount: toNumber(payment.amount),
          amount_usd: payment.amountUsd,
          reference: payment.reference.trim() || null,
          pos_account_id: payment.accountId || null,
        })),
      p_customer_id: null,
      p_notes: null,
      p_rate: rate,
    };

    // Se envían solo cuando existen: así la venta normal sigue
    // funcionando aunque la migración 090 aún no esté aplicada.
    if (appliedDiscount) salePayload.p_discount_code = appliedDiscount.code;
    if (selectedSurcharges.length > 0) {
      salePayload.p_surcharges = selectedSurcharges;
    }

    const { data, error: rpcError } = await supabase.rpc(
      "pos_create_sale",
      salePayload,
    );

    setSaving(false);

    if (rpcError) {
      setError(rpcError.message);
      return;
    }

    const result = data as {
      sale_id: string;
      number: number;
      total_usd: number;
    };

    // El cliente del POS se enlaza después: la venta ya está cobrada.
    if (customerId) {
      await supabase
        .from("pos_sales")
        .update({ pos_customer_id: customerId })
        .eq("id", result.sale_id);
    }

    if (priceListsReady && channel) {
      await supabase
        .from("pos_sales")
        .update({ price_list_id: channel.id })
        .eq("id", result.sale_id);
    }

    if (saleChannelsReady && saleChannelId) {
      await supabase
        .from("pos_sales")
        .update({ sale_channel_id: saleChannelId })
        .eq("id", result.sale_id);
    }

    if (change.usd > 0 || change.bs > 0) {
      await supabase
        .from("pos_sales")
        .update({ change_usd: change.usd, change_bs: change.bs })
        .eq("id", result.sale_id);
    }

    setSuccess({
      saleId: result.sale_id,
      number: result.number,
      total: toNumber(result.total_usd),
    });
    setCart([]);
    setPayments([newPayment()]);
    setSearch("");
    setCustomerId("");
    setAppliedDiscount(null);
    setDiscountCode("");
    setDiscountError(null);
    setSelectedSurcharges([]);
    void load();
    searchRef.current?.focus();
  }

  return (
    <div>
      <PosPageHeader
        title="Vender"
        subtitle="Cobra rápido y divide el pago entre métodos."
        actions={
          openShift ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Turno #{openShift.number}
            </span>
          ) : null
        }
      />

      {!shiftMissing && !shiftLoading && !openShift ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          <p>
            <strong>No hay un turno abierto.</strong> La venta se registra,
            pero no entrará en el arqueo de caja.
          </p>
          <Link
            href="/pos/turnos"
            className="rounded-lg bg-amber-800 px-3 py-1.5 font-bold text-white hover:bg-amber-900"
          >
            Abrir turno
          </Link>
        </div>
      ) : null}

      {success ? (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm">
          <CheckCircle2 className="h-5 w-5 text-emerald-600" />
          <div className="flex-1">
            <p className="font-bold text-emerald-800">
              Venta #{success.number} registrada
            </p>
            <p className="text-xs text-emerald-700">
              Total {formatUsd(success.total)} ·{" "}
              {formatBs(usdToBs(success.total, rate))}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setReceiptSaleId(success.saleId);
              setReceiptOpen(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-xs font-bold text-emerald-700 hover:bg-emerald-100"
          >
            <Receipt className="h-3.5 w-3.5" />
            Ver recibo
          </button>
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <section className="rounded-2xl border border-slate-200 bg-white">
          <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
            <Search className="h-4 w-4 text-slate-400" />
            <input
              ref={searchRef}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && filtered[0]) {
                  addProduct(filtered[0]);
                  setSearch("");
                }
              }}
              placeholder="Buscar o escanear nombre, SKU o código de barras"
              className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400"
            />
          </div>

          {saleChannels.length > 0 || priceLists.length > 1 ? (
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-slate-100 bg-slate-50/60 px-4 py-2">
              {saleChannels.length > 0 ? (
                <label className="flex items-center gap-2 text-[11px] font-semibold text-slate-500">
                  Canal de venta
                  <select
                    value={saleChannelId}
                    onChange={(event) => setSaleChannelId(event.target.value)}
                    className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700 outline-none"
                  >
                    {saleChannels.map((channel) => (
                      <option key={channel.id} value={channel.id}>
                        {channel.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              {priceLists.length > 1 ? (
                <label className="flex items-center gap-2 text-[11px] font-semibold text-slate-500">
                  Lista de precios
                  <select
                    value={priceListId}
                    onChange={(event) => setPriceListId(event.target.value)}
                    disabled={cart.length > 0}
                    className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700 outline-none disabled:opacity-60"
                  >
                    {priceLists.map((list) => (
                      <option key={list.id} value={list.id}>
                        {list.name}
                        {list.is_default ? " (base)" : ""}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              {priceLists.length > 1 && cart.length > 0 ? (
                <span className="text-[10px] text-slate-400">
                  Vacía la cuenta para cambiar de precio
                </span>
              ) : null}
            </div>
          ) : null}

          {loading ? (
            <div className="flex justify-center py-20">
              <Loader2 className="h-5 w-5 animate-spin text-[#3f3fd8]" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-6 py-16 text-center">
              <ShoppingCart className="mx-auto h-8 w-8 text-slate-300" />
              <p className="mt-3 text-sm font-bold text-slate-800">
                {products.length === 0
                  ? "Aún no hay productos para vender"
                  : "Sin resultados"}
              </p>
              <p className="mt-1 text-sm text-slate-500">
                {products.length === 0
                  ? "Crea tus productos en Catálogo y aparecen aquí con su precio."
                  : "Prueba con otro nombre o SKU."}
              </p>
            </div>
          ) : (
            <div className="grid gap-2 p-3 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map((product) => (
                <button
                  key={product.id}
                  type="button"
                  onClick={() => addProduct(product)}
                  className="rounded-xl border border-slate-200 bg-white p-3 text-left transition-colors hover:border-[#3f3fd8] hover:bg-indigo-50/40"
                >
                  <p className="line-clamp-2 text-sm font-semibold text-slate-800">
                    {product.name}
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    {product.kind === "service"
                      ? "Servicio"
                      : `${toNumber(product.stock)} ${product.unit} disponibles`}
                  </p>
                  <p className="mt-2 text-base font-black text-slate-900">
                    {formatUsd(channelPrice(product))}
                  </p>
                  <p className="text-[10px] text-slate-400">
                    {formatBs(usdToBs(channelPrice(product), rate))}
                  </p>
                </button>
              ))}
            </div>
          )}
        </section>

        <aside className="space-y-3">
          <section className="rounded-2xl border border-slate-200 bg-white">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <p className="text-sm font-bold text-slate-800">Cuenta</p>
              {cart.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setCart([])}
                  className="text-[11px] font-semibold text-slate-400 hover:text-red-600"
                >
                  Vaciar
                </button>
              ) : null}
            </div>

            <div className="border-b border-slate-100 px-4 py-2">
              <label className="flex items-center gap-2 text-[11px] font-semibold text-slate-500">
                Cliente
                <select
                  value={customerId}
                  onChange={(event) => setCustomerId(event.target.value)}
                  className="min-w-0 flex-1 rounded-lg border border-slate-200 px-2 py-1.5 text-xs font-medium text-slate-700 outline-none focus:border-[#3f3fd8]"
                >
                  <option value="">Consumidor final</option>
                  {customers.map((customer) => (
                    <option key={customer.id} value={customer.id}>
                      {customer.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {cart.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <p className="text-sm font-semibold text-slate-700">
                  Empieza una cuenta
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Toca un producto o escanea su código.
                </p>
              </div>
            ) : (
              <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto">
                {cart.map((line) => (
                  <li key={line.productId} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-800">
                          {line.name}
                        </p>
                        <p className="text-[11px] text-slate-500">
                          {formatUsd(line.unitPrice)} × {line.quantity}
                        </p>
                      </div>
                      <p className="text-sm font-bold text-slate-900">
                        {formatUsd(round2(line.unitPrice * line.quantity))}
                      </p>
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <div className="flex items-center gap-1 rounded-lg border border-slate-200">
                        <button
                          type="button"
                          onClick={() =>
                            setQuantity(line.productId, line.quantity - 1)
                          }
                          className="p-1.5 text-slate-500 hover:bg-slate-50"
                        >
                          <Minus className="h-3.5 w-3.5" />
                        </button>
                        <span className="min-w-6 text-center text-xs font-bold">
                          {line.quantity}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setQuantity(line.productId, line.quantity + 1)
                          }
                          className="p-1.5 text-slate-500 hover:bg-slate-50"
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeLine(line.productId)}
                        className="ml-auto rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500">
              <Percent className="h-3.5 w-3.5" />
              Descuento
            </p>

            <div className="mt-2 flex items-center gap-2">
              <input
                value={discountCode}
                onChange={(event) => {
                  setDiscountCode(event.target.value.toUpperCase());
                  setDiscountError(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !appliedDiscount) {
                    void applyDiscountCode();
                  }
                }}
                disabled={Boolean(appliedDiscount)}
                placeholder="Código (ej. VERANO10)"
                className="min-w-0 flex-1 rounded-lg border border-slate-200 px-2.5 py-1.5 font-mono text-xs uppercase outline-none focus:border-[#4338ca] disabled:bg-slate-50"
              />
              {appliedDiscount ? (
                <button
                  type="button"
                  onClick={clearDiscount}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] font-bold text-slate-500 hover:bg-slate-50"
                >
                  <X className="h-3 w-3" />
                  Quitar
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void applyDiscountCode()}
                  disabled={applyingCode || !discountCode.trim()}
                  className="rounded-lg bg-slate-100 px-3 py-1.5 text-[11px] font-bold text-slate-700 hover:bg-slate-200 disabled:opacity-40"
                >
                  {applyingCode ? "..." : "Aplicar"}
                </button>
              )}
            </div>

            {appliedDiscount ? (
              <p className="mt-2 flex items-center justify-between rounded-lg bg-emerald-50 px-2.5 py-1.5 text-[11px] text-emerald-700">
                <span>
                  <strong>{appliedDiscount.code}</strong> ·{" "}
                  {appliedDiscount.name}
                </span>
                <span className="font-bold">− {formatUsd(discountAmount)}</span>
              </p>
            ) : null}

            {discountError ? (
              <p className="mt-2 rounded-lg bg-red-50 px-2.5 py-1.5 text-[11px] text-red-700">
                {discountError}
              </p>
            ) : null}

            {surchargeOptions.length > 0 ? (
              <div className="mt-3 border-t border-slate-100 pt-3">
                <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                  Recargos
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {surchargeOptions.map((row) => {
                    const active = selectedSurcharges.includes(row.id);
                    return (
                      <button
                        key={row.id}
                        type="button"
                        onClick={() => toggleSurcharge(row.id)}
                        className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                          active
                            ? "border-[#4338ca] bg-indigo-50 text-[#4338ca]"
                            : "border-slate-200 text-slate-500 hover:bg-slate-50"
                        }`}
                      >
                        {row.name} ·{" "}
                        {row.kind === "percent"
                          ? `${toNumber(row.value)} %`
                          : formatUsd(toNumber(row.value))}
                      </button>
                    );
                  })}
                </div>
                {surchargeTotal > 0 ? (
                  <p className="mt-2 text-right text-[11px] font-semibold text-slate-600">
                    Suma de recargos: {formatUsd(surchargeTotal)}
                  </p>
                ) : null}
              </div>
            ) : null}
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-4">
            <dl className="space-y-1.5 text-sm">
              <Row label="Subtotal" value={formatUsd(grossSubtotal)} />
              {discountAmount > 0 ? (
                <Row
                  label={`Descuento ${appliedDiscount?.code ?? ""}`}
                  value={`− ${formatUsd(discountAmount)}`}
                />
              ) : null}
              <Row label="IVA (16%)" value={formatUsd(totalsBase.iva)} />
              {surchargeTotal > 0 ? (
                <Row label="Recargos" value={formatUsd(surchargeTotal)} />
              ) : null}
              <Row label="IGTF (3% divisas)" value={formatUsd(igtfTotal)} />
              <div className="my-2 border-t border-slate-100" />
              <div className="flex items-baseline justify-between">
                <dt className="font-bold text-slate-800">Total</dt>
                <dd className="text-right">
                  <p className="text-xl font-black text-slate-900">
                    {formatUsd(total)}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    {formatBs(usdToBs(total, rate))}
                  </p>
                </dd>
              </div>
              {change.usd > 0 || change.bs > 0 ? (
                <div className="mt-1 flex items-center justify-between rounded-lg bg-emerald-50 px-2 py-1.5 text-xs text-emerald-700">
                  <span className="font-semibold">Vuelto</span>
                  <span className="font-bold">
                    {[
                      change.usd > 0 ? formatUsd(change.usd) : null,
                      change.bs > 0 ? formatBs(change.bs) : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </div>
              ) : null}
            </dl>

            <div className="mt-3 space-y-2">
              {payments.map((payment) => {
                const method = PAYMENT_METHODS.find(
                  (m) => m.value === payment.method,
                )!;
                return (
                  <div
                    key={payment.id}
                    className="rounded-lg border border-slate-100 p-2"
                  >
                    <div className="flex items-center gap-2">
                      <select
                        value={payment.method}
                        onChange={(event) => {
                          const next = event.target.value as PaymentMethod;
                          const nextMethod = PAYMENT_METHODS.find(
                            (m) => m.value === next,
                          )!;
                          const account = accounts.find(
                            (a) => a.currency === nextMethod.currency,
                          );
                          updatePayment(payment.id, {
                            method: next,
                            amount: "",
                            accountId: account?.id ?? "",
                            reference: "",
                            received: "",
                          });
                        }}
                        className="w-32 rounded-lg border border-slate-200 px-2 py-1.5 text-xs outline-none focus:border-[#3f3fd8]"
                      >
                        {PAYMENT_METHODS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      <input
                        value={payment.amount}
                        onChange={(event) =>
                          updatePayment(payment.id, {
                            amount: event.target.value,
                          })
                        }
                        inputMode="decimal"
                        placeholder={
                          method.currency === "VES" ? "Bs" : "USD"
                        }
                        className="min-w-0 flex-1 rounded-lg border border-slate-200 px-2 py-1.5 text-sm outline-none focus:border-[#3f3fd8]"
                      />
                      {payments.length > 1 ? (
                        <button
                          type="button"
                          onClick={() =>
                            setPayments((current) =>
                              current.filter((p) => p.id !== payment.id),
                            )
                          }
                          className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                    </div>
                    <select
                      value={payment.accountId}
                      onChange={(event) =>
                        updatePayment(payment.id, {
                          accountId: event.target.value,
                        })
                      }
                      className="mt-1.5 w-full rounded-lg border border-slate-200 px-2 py-1 text-[11px] text-slate-600 outline-none focus:border-[#3f3fd8]"
                    >
                      <option value="">
                        Sin cuenta (no entra a Finanzas)
                      </option>
                      {accounts
                        .filter((account) => account.currency === method.currency)
                        .map((account) => (
                          <option key={account.id} value={account.id}>
                            {account.name}
                          </option>
                        ))}
                    </select>
                    {method.value !== "cash_usd" &&
                    method.value !== "cash_bs" ? (
                      <input
                        value={payment.reference}
                        onChange={(event) =>
                          updatePayment(payment.id, {
                            reference: event.target.value,
                          })
                        }
                        placeholder="Referencia: últimos dígitos, Zelle..."
                        className="mt-1.5 w-full rounded-lg border border-slate-200 px-2 py-1 text-[11px] text-slate-600 outline-none focus:border-[#3f3fd8]"
                      />
                    ) : (
                      <div className="mt-1.5 flex items-center justify-between gap-2">
                        <label className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-400">
                          Recibido
                          <input
                            value={payment.received}
                            onChange={(event) =>
                              updatePayment(payment.id, {
                                received: event.target.value,
                              })
                            }
                            inputMode="decimal"
                            placeholder={
                              method.currency === "VES" ? "Bs" : "USD"
                            }
                            className="w-20 rounded-lg border border-slate-200 px-2 py-1 text-right text-[11px] text-slate-700 outline-none focus:border-[#3f3fd8]"
                          />
                        </label>
                        {changeOf(payment) > 0 ? (
                          <span className="text-[10px] font-bold text-emerald-700">
                            Vuelto{" "}
                            {method.currency === "VES"
                              ? formatBs(changeOf(payment))
                              : formatUsd(changeOf(payment))}
                          </span>
                        ) : null}
                      </div>
                    )}
                  </div>
                );
              })}

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setPayments((c) => [...c, newPayment()])}
                  className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
                >
                  + Método
                </button>
                <button
                  type="button"
                  onClick={fillExact}
                  className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
                >
                  Cobrar exacto
                </button>
              </div>
            </div>

            {remaining > 0.005 ? (
              <p className="mt-2 text-[11px] font-semibold text-amber-600">
                Falta por cubrir: {formatUsd(remaining)}
              </p>
            ) : null}

            {error ? (
              <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
                {error}
              </p>
            ) : null}

            <PosButton
              className="mt-3 w-full py-3"
              onClick={() => void cobrar()}
              disabled={saving || cart.length === 0}
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Cobrar {formatUsd(total)}
            </PosButton>
          </section>
        </aside>
      </div>

      <SaleReceiptDialog
        saleId={receiptSaleId}
        open={receiptOpen}
        onOpenChange={setReceiptOpen}
      />
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-medium text-slate-700">{value}</dd>
    </div>
  );
}

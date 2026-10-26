"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  Loader2,
  Minus,
  Plus,
  Search,
  ShoppingCart,
  Trash2,
} from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { usePosRate } from "@/components/pos/rate-context";
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
  kind: "product" | "supply" | "service";
  unit: string;
  cost_usd: number | string;
  price_usd: number | string;
  stock: number | string;
  taxable: boolean;
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
}

function newPayment(method: PaymentMethod = "cash_usd"): Payment {
  return { id: crypto.randomUUID(), method, amount: "" };
}

export default function VenderPage() {
  const { accountId } = useAuth();
  const { rate } = usePosRate();

  const [products, setProducts] = useState<Product[]>([]);
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<Line[]>([]);
  const [payments, setPayments] = useState<Payment[]>([newPayment()]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{
    number: number;
    total: number;
  } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!accountId) return;
    const supabase = createClient();
    setLoading(true);
    const { data } = await supabase
      .from("pos_products")
      .select(
        "id, name, sku, kind, unit, cost_usd, price_usd, stock, taxable",
      )
      .eq("account_id", accountId)
      .eq("active", true)
      .neq("kind", "supply")
      .order("name");
    setProducts((data ?? []) as Product[]);
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
        (product.sku ?? "").toLowerCase().includes(term),
    );
  }, [products, search]);

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
          unitPrice: toNumber(product.price_usd),
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

  const totalsBase = useMemo(
    () => computeTotals(cart, { usdPaidBase: 0 }),
    [cart],
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
  const total = round2(totalsBase.base + igtfTotal);
  const covered = round2(
    resolved.reduce((sum, p) => sum + p.amountUsd + p.igtf, 0),
  );
  const remaining = round2(total - covered);

  function fillExact() {
    setPayments([{ ...newPayment("cash_usd"), amount: String(totalsBase.base) }]);
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

    const hasVes = resolved.some((p) => p.currency === "VES" && p.amountUsd > 0);
    if (hasVes && rate <= 0) {
      setError("Configura la tasa del día para cobrar en bolívares.");
      return;
    }

    setSaving(true);
    const supabase = createClient();

    const { data, error: rpcError } = await supabase.rpc("pos_create_sale", {
      p_items: cart.map((line) => ({
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
          reference: null,
        })),
      p_customer_id: null,
      p_notes: null,
      p_rate: rate,
    });

    setSaving(false);

    if (rpcError) {
      setError(rpcError.message);
      return;
    }

    const result = data as { number: number; total_usd: number };
    setSuccess({ number: result.number, total: toNumber(result.total_usd) });
    setCart([]);
    setPayments([newPayment()]);
    setSearch("");
    void load();
    searchRef.current?.focus();
  }

  return (
    <div>
      <PosPageHeader
        title="Vender"
        subtitle="Cobra rápido y divide el pago entre métodos."
      />

      {success ? (
        <div className="mb-4 flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm">
          <CheckCircle2 className="h-5 w-5 text-emerald-600" />
          <div>
            <p className="font-bold text-emerald-800">
              Venta #{success.number} registrada
            </p>
            <p className="text-xs text-emerald-700">
              Total {formatUsd(success.total)} ·{" "}
              {formatBs(usdToBs(success.total, rate))}
            </p>
          </div>
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
              placeholder="Buscar o escanear SKU y presionar Enter"
              className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400"
            />
          </div>

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
                    {formatUsd(toNumber(product.price_usd))}
                  </p>
                  <p className="text-[10px] text-slate-400">
                    {formatBs(usdToBs(toNumber(product.price_usd), rate))}
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
            <dl className="space-y-1.5 text-sm">
              <Row label="Subtotal" value={formatUsd(totalsBase.subtotal)} />
              <Row label="IVA (16%)" value={formatUsd(totalsBase.iva)} />
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
            </dl>

            <div className="mt-3 space-y-2">
              {payments.map((payment) => {
                const method = PAYMENT_METHODS.find(
                  (m) => m.value === payment.method,
                )!;
                return (
                  <div key={payment.id} className="flex items-center gap-2">
                    <select
                      value={payment.method}
                      onChange={(event) =>
                        updatePayment(payment.id, {
                          method: event.target.value as PaymentMethod,
                          amount: "",
                        })
                      }
                      className="w-36 rounded-lg border border-slate-200 px-2 py-1.5 text-xs outline-none focus:border-[#3f3fd8]"
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
                        updatePayment(payment.id, { amount: event.target.value })
                      }
                      inputMode="decimal"
                      placeholder={method.currency === "VES" ? "Bs" : "USD"}
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

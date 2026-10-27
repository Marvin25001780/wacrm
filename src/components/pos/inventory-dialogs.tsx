"use client";

import { useMemo, useState } from "react";
import { Loader2, Plus, Trash2, X } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { formatUsd, toNumber, usdToBs } from "@/lib/pos/money";
import { usePosRate } from "@/components/pos/rate-context";

export interface DialogProduct {
  id: string;
  name: string;
  unit: string;
  cost_usd: number | string;
  stock: number | string;
  kind: string;
}

export interface DialogAccount {
  id: string;
  name: string;
  currency: "USD" | "VES";
}

interface Line {
  key: string;
  productId: string;
  quantity: string;
  cost: string;
}

function useLines(products: DialogProduct[]): {
  lines: Line[];
  add: (productId?: string) => void;
  remove: (key: string) => void;
  update: (key: string, patch: Partial<Line>) => void;
} {
  const [lines, setLines] = useState<Line[]>(() => [
    {
      key: crypto.randomUUID(),
      productId: products[0]?.id ?? "",
      quantity: "1",
      cost: String(toNumber(products[0]?.cost_usd)),
    },
  ]);

  return {
    lines,
    add: (productId) => {
      const product =
        products.find((p) => p.id === productId) ?? products[0] ?? null;
      setLines((current) => [
        ...current,
        {
          key: crypto.randomUUID(),
          productId: product?.id ?? "",
          quantity: "1",
          cost: String(toNumber(product?.cost_usd)),
        },
      ]);
    },
    remove: (key) =>
      setLines((current) =>
        current.length === 1 ? current : current.filter((l) => l.key !== key),
      ),
    update: (key, patch) =>
      setLines((current) =>
        current.map((line) => (line.key === key ? { ...line, ...patch } : line)),
      ),
  };
}

function LineRow({
  products,
  line,
  showCost,
  costLabel,
  onUpdate,
  onRemove,
}: {
  products: DialogProduct[];
  line: Line;
  showCost: boolean;
  costLabel: string;
  onUpdate: (patch: Partial<Line>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="grid grid-cols-12 items-start gap-2">
      <select
        value={line.productId}
        onChange={(event) => {
          const product = products.find((p) => p.id === event.target.value);
          onUpdate({
            productId: event.target.value,
            ...(product ? { cost: String(toNumber(product.cost_usd)) } : {}),
          });
        }}
        className="col-span-6 rounded-lg border border-slate-200 px-2 py-2 text-xs outline-none focus:border-[#3f3fd8]"
      >
        {products.map((product) => (
          <option key={product.id} value={product.id}>
            {product.name}
          </option>
        ))}
      </select>
      <div className="col-span-3">
        <input
          value={line.quantity}
          onChange={(event) => onUpdate({ quantity: event.target.value })}
          inputMode="decimal"
          placeholder="0"
          className="w-full rounded-lg border border-slate-200 px-2 py-2 text-right text-xs outline-none focus:border-[#3f3fd8]"
        />
      </div>
      <div className="col-span-3">
        {showCost ? (
          <input
            value={line.cost}
            onChange={(event) => onUpdate({ cost: event.target.value })}
            inputMode="decimal"
            placeholder={costLabel}
            className="w-full rounded-lg border border-slate-200 px-2 py-2 text-right text-xs outline-none focus:border-[#3f3fd8]"
          />
        ) : (
          <button
            type="button"
            onClick={onRemove}
            className="mt-1 rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {showCost ? (
        <button
          type="button"
          onClick={onRemove}
          className="col-span-12 justify-self-end rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  );
}

function DialogShell({
  title,
  subtitle,
  children,
  footer,
  onClose,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  footer: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="text-lg font-black text-slate-900">{title}</h2>
            <p className="text-xs text-slate-500">{subtitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        <div className="border-t border-slate-100 px-5 py-3">{footer}</div>
      </div>
    </div>
  );
}

const inputClass =
  "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#3f3fd8]";

export function PurchaseDialog({
  products,
  accounts,
  onClose,
  onSaved,
}: {
  products: DialogProduct[];
  accounts: DialogAccount[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { lines, add, remove, update } = useLines(products);
  const { rate } = usePosRate();
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [supplierName, setSupplierName] = useState("");
  const [invoice, setInvoice] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isCredit = paymentMethod === "credit";

  const total = useMemo(
    () =>
      lines.reduce(
        (sum, line) => sum + toNumber(line.quantity) * toNumber(line.cost),
        0,
      ),
    [lines],
  );

  async function save() {
    const items = lines
      .map((line) => ({
        product_id: line.productId,
        quantity: toNumber(line.quantity),
        unit_cost_usd: toNumber(line.cost),
      }))
      .filter((item) => item.product_id && item.quantity > 0);

    if (items.length === 0) {
      setError("Agrega al menos una línea con cantidad.");
      return;
    }
    if (!isCredit && !accountId) {
      setError("Elige la cuenta de donde sale el pago.");
      return;
    }

    setSaving(true);
    setError(null);
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("pos_create_purchase", {
      p_payload: {
        doc_date: date,
        payment_method: paymentMethod,
        pos_account_id: isCredit ? null : accountId || null,
        due_date: isCredit ? dueDate || null : null,
        supplier_name: supplierName.trim() || null,
        invoice_number: invoice || null,
        note: note || null,
        rate,
        items,
      },
    });
    setSaving(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    onSaved();
  }

  return (
    <DialogShell
      title="Nueva compra"
      subtitle="Registra la entrada de mercancía de tus proveedores."
      onClose={onClose}
      footer={
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-bold text-slate-700">
            Total {formatUsd(total)}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-500 hover:bg-slate-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-xl bg-[#3f3fd8] px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Registrar compra
            </button>
          </div>
        </div>
      }
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold text-slate-500">
            Forma de pago *
          </span>
          <select
            value={paymentMethod}
            onChange={(event) => setPaymentMethod(event.target.value)}
            className={inputClass}
          >
            <option value="cash">Efectivo</option>
            <option value="transfer">Transferencia</option>
            <option value="zelle">Zelle</option>
            <option value="card">Punto de venta</option>
            <option value="credit">Crédito</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold text-slate-500">
            Proveedor
          </span>
          <input
            value={supplierName}
            onChange={(event) => setSupplierName(event.target.value)}
            placeholder="Nombre del proveedor"
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold text-slate-500">
            Fecha
          </span>
          <input
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            className={inputClass}
          />
        </label>
        {isCredit ? (
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-slate-500">
              Vence
            </span>
            <input
              type="date"
              value={dueDate}
              onChange={(event) => setDueDate(event.target.value)}
              className={inputClass}
            />
          </label>
        ) : (
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-slate-500">
              Cuenta del pago *
            </span>
            <select
              value={accountId}
              onChange={(event) => setAccountId(event.target.value)}
              className={inputClass}
            >
              {accounts.length === 0 ? (
                <option value="">Sin cuentas</option>
              ) : null}
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {isCredit ? (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
          Queda como cuenta por pagar. No sale dinero de una cuenta hasta que
          registres el pago en Inventario → Por pagar.
        </p>
      ) : null}

      <label className="mt-3 flex flex-col gap-1">
        <span className="text-[11px] font-semibold text-slate-500">
          Número de factura (opcional)
        </span>
        <input
          value={invoice}
          onChange={(event) => setInvoice(event.target.value)}
          className={inputClass}
        />
      </label>

      <div className="mt-4">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-bold text-slate-700">Líneas</p>
          <button
            type="button"
            onClick={() => add()}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
          >
            <Plus className="h-3.5 w-3.5" /> Agregar línea
          </button>
        </div>
        <div className="mb-1 grid grid-cols-12 gap-2 text-[10px] font-bold uppercase tracking-wide text-slate-400">
          <span className="col-span-6">Producto</span>
          <span className="col-span-3 text-right">Cantidad</span>
          <span className="col-span-3 text-right">Costo unit.</span>
        </div>
        <div className="space-y-2">
          {lines.map((line) => (
            <LineRow
              key={line.key}
              products={products}
              line={line}
              showCost
              costLabel="0,00"
              onUpdate={(patch) => update(line.key, patch)}
              onRemove={() => remove(line.key)}
            />
          ))}
        </div>
      </div>

      <label className="mt-4 flex flex-col gap-1">
        <span className="text-[11px] font-semibold text-slate-500">
          Nota (opcional)
        </span>
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={2}
          className={inputClass}
        />
      </label>

      {error ? (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </p>
      ) : null}
    </DialogShell>
  );
}

export function ReturnDialog({
  products,
  onClose,
  onSaved,
  rate,
}: {
  products: DialogProduct[];
  onClose: () => void;
  onSaved: () => void;
  rate: number;
}) {
  const { lines, add, remove, update } = useLines(products);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [invoice, setInvoice] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const items = lines
      .map((line) => ({
        product_id: line.productId,
        quantity: toNumber(line.quantity),
        unit_cost_usd: toNumber(line.cost),
      }))
      .filter((item) => item.product_id && item.quantity > 0);

    if (items.length === 0) {
      setError("Agrega al menos una línea con cantidad.");
      return;
    }

    setSaving(true);
    setError(null);
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("pos_create_return", {
      p_payload: {
        doc_date: date,
        invoice_number: invoice || null,
        note: note || null,
        items,
      },
    });
    setSaving(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    onSaved();
  }

  return (
    <DialogShell
      title="Nueva devolución"
      subtitle="Devuelve mercancía a un proveedor y resta existencias."
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-500 hover:bg-slate-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-xl bg-[#3f3fd8] px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Registrar devolución
          </button>
        </div>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold text-slate-500">
            Fecha
          </span>
          <input
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold text-slate-500">
            Factura del proveedor (opcional)
          </span>
          <input
            value={invoice}
            onChange={(event) => setInvoice(event.target.value)}
            className={inputClass}
          />
        </label>
      </div>

      <div className="mt-4">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-bold text-slate-700">Líneas</p>
          <button
            type="button"
            onClick={() => add()}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
          >
            <Plus className="h-3.5 w-3.5" /> Agregar línea
          </button>
        </div>
        <div className="space-y-2">
          {lines.map((line) => (
            <LineRow
              key={line.key}
              products={products}
              line={line}
              showCost
              costLabel="0,00"
              onUpdate={(patch) => update(line.key, patch)}
              onRemove={() => remove(line.key)}
            />
          ))}
        </div>
      </div>

      <label className="mt-4 flex flex-col gap-1">
        <span className="text-[11px] font-semibold text-slate-500">
          Motivo (opcional)
        </span>
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={2}
          className={inputClass}
        />
      </label>

      {rate > 0 ? (
        <p className="mt-2 text-[11px] text-slate-400">
          El costo en bolívares se calcula con la tasa del día.
        </p>
      ) : null}

      {error ? (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </p>
      ) : null}
    </DialogShell>
  );
}

export function AdjustmentDialog({
  products,
  initialType = "count",
  initialProductId,
  onClose,
  onSaved,
}: {
  products: DialogProduct[];
  initialType?: "count" | "loss";
  initialProductId?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [type, setType] = useState<"count" | "loss">(initialType);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState(
    initialType === "loss" ? "Merma" : "Conteo físico",
  );
  const [lines, setLines] = useState<
    { key: string; productId: string; value: string }[]
  >([
    {
      key: crypto.randomUUID(),
      productId: initialProductId ?? products[0]?.id ?? "",
      value: "0",
    },
  ]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function update(
    key: string,
    patch: Partial<{ productId: string; value: string }>,
  ) {
    setLines((current) =>
      current.map((line) => (line.key === key ? { ...line, ...patch } : line)),
    );
  }

  async function save() {
    const items = lines
      .map((line) => ({
        product_id: line.productId,
        value: toNumber(line.value),
      }))
      .filter((item) => item.product_id && item.value >= 0);

    if (items.length === 0) {
      setError("Agrega al menos una línea.");
      return;
    }

    setSaving(true);
    setError(null);
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("pos_create_adjustment", {
      p_payload: {
        type,
        doc_date: date,
        note: note || null,
        items,
      },
    });
    setSaving(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    onSaved();
  }

  return (
    <DialogShell
      title={type === "count" ? "Ajuste por conteo" : "Nueva salida"}
      subtitle={
        type === "count"
          ? "Fija la existencia real después de contar el inventario."
          : "Resta existencias por merma, daño o uso interno."
      }
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-500 hover:bg-slate-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-xl bg-[#3f3fd8] px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Guardar
          </button>
        </div>
      }
    >
      <div className="mb-3 flex gap-2">
        {(
          [
            ["count", "Conteo físico"],
            ["loss", "Merma / salida"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setType(value)}
            className={`rounded-xl border px-3 py-1.5 text-xs font-semibold ${
              type === value
                ? "border-[#3f3fd8] bg-indigo-50 text-[#3f3fd8]"
                : "border-slate-200 text-slate-600"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold text-slate-500">
            Fecha
          </span>
          <input
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold text-slate-500">
            Motivo
          </span>
          <input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            className={inputClass}
          />
        </label>
      </div>

      <div className="mt-4">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-bold text-slate-700">Líneas</p>
          <button
            type="button"
            onClick={() =>
              setLines((current) => [
                ...current,
                {
                  key: crypto.randomUUID(),
                  productId: products[0]?.id ?? "",
                  value: "0",
                },
              ])
            }
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
          >
            <Plus className="h-3.5 w-3.5" /> Agregar línea
          </button>
        </div>
        <div className="space-y-2">
          {lines.map((line) => {
            const product = products.find((p) => p.id === line.productId);
            return (
              <div key={line.key} className="grid grid-cols-12 gap-2">
                <select
                  value={line.productId}
                  onChange={(event) =>
                    update(line.key, { productId: event.target.value })
                  }
                  className="col-span-7 rounded-lg border border-slate-200 px-2 py-2 text-xs outline-none focus:border-[#3f3fd8]"
                >
                  {products.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
                <input
                  value={line.value}
                  onChange={(event) =>
                    update(line.key, { value: event.target.value })
                  }
                  inputMode="decimal"
                  placeholder={type === "count" ? "contado" : "cantidad"}
                  className="col-span-4 rounded-lg border border-slate-200 px-2 py-2 text-right text-xs outline-none focus:border-[#3f3fd8]"
                />
                <div className="col-span-1 flex items-center justify-center">
                  <button
                    type="button"
                    onClick={() =>
                      setLines((current) =>
                        current.length === 1
                          ? current
                          : current.filter((l) => l.key !== line.key),
                      )
                    }
                    className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                {product ? (
                  <p className="col-span-12 -mt-1 text-[10px] text-slate-400">
                    Existencia actual: {toNumber(product.stock)} {product.unit}
                    {type === "count"
                      ? ` · contado se guarda tal cual`
                      : ` · se restará del stock`}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      {error ? (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </p>
      ) : null}
    </DialogShell>
  );
}

export function SupplierPaymentDialog({
  doc,
  accounts,
  onClose,
  onSaved,
}: {
  doc: {
    id: string;
    invoice_number?: string | null;
    supplier_name?: string | null;
    total_usd: number | string;
    balance_usd?: number | string;
  };
  accounts: DialogAccount[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { rate } = usePosRate();
  const [amount, setAmount] = useState(String(toNumber(doc.balance_usd)));
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [reference, setReference] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!accountId) {
      setError("Elige la cuenta de donde sale el pago.");
      return;
    }
    const value = toNumber(amount);
    if (value <= 0) {
      setError("Escribe un monto mayor a cero.");
      return;
    }
    if (value > toNumber(doc.balance_usd) + 0.005) {
      setError("El pago supera el saldo de la compra.");
      return;
    }

    setSaving(true);
    setError(null);
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("pos_pay_supplier", {
      p_doc_id: doc.id,
      p_amount: value,
      p_account_id: accountId,
      p_reference: reference.trim() || null,
      p_rate: rate,
    });
    setSaving(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    onSaved();
  }

  return (
    <DialogShell
      title="Pagar compra"
      subtitle={`${doc.supplier_name ?? "Proveedor"} · ${
        doc.invoice_number ? `Factura ${doc.invoice_number}` : "Sin factura"
      }`}
      onClose={onClose}
      footer={
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-slate-500">
            Saldo {formatUsd(toNumber(doc.balance_usd))}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-500 hover:bg-slate-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-xl bg-[#3f3fd8] px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Registrar pago
            </button>
          </div>
        </div>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold text-slate-500">
            Monto a pagar
          </span>
          <input
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            inputMode="decimal"
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold text-slate-500">
            Cuenta
          </span>
          <select
            value={accountId}
            onChange={(event) => setAccountId(event.target.value)}
            className={inputClass}
          >
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name} ({account.currency})
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="mt-3 flex flex-col gap-1">
        <span className="text-[11px] font-semibold text-slate-500">
          Referencia
        </span>
        <input
          value={reference}
          onChange={(event) => setReference(event.target.value)}
          placeholder="Opcional"
          className={inputClass}
        />
      </label>
      {error ? (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </p>
      ) : null}
    </DialogShell>
  );
}

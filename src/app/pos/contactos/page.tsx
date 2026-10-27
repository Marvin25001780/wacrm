"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Pencil, Plus, Search, Users, X } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { PosButton, PosPageHeader } from "@/components/pos/pos-shell";
import { createClient } from "@/lib/supabase/client";

interface Customer {
  id: string;
  name: string;
  document: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  active: boolean;
}

export default function PosContactosPage() {
  const { accountId } = useAuth();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    if (!accountId) return;
    const supabase = createClient();
    setLoading(true);
    const { data } = await supabase
      .from("pos_customers")
      .select("id, name, document, phone, email, address, notes, active")
      .eq("account_id", accountId)
      .eq("active", true)
      .order("name");
    setCustomers((data ?? []) as Customer[]);
    setLoading(false);
  }, [accountId]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return customers;
    return customers.filter(
      (customer) =>
        customer.name.toLowerCase().includes(term) ||
        (customer.document ?? "").toLowerCase().includes(term) ||
        (customer.phone ?? "").toLowerCase().includes(term) ||
        (customer.email ?? "").toLowerCase().includes(term),
    );
  }, [customers, search]);

  function create() {
    setEditing(null);
    setOpen(true);
  }

  function edit(customer: Customer) {
    setEditing(customer);
    setOpen(true);
  }

  return (
    <div>
      <PosPageHeader
        title="Contactos"
        subtitle="Clientes del POS. No se mezclan con los contactos del CRM."
        actions={
          <PosButton onClick={create}>
            <Plus className="h-4 w-4" />
            Nuevo cliente
          </PosButton>
        }
      />

      <div className="mb-3 flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2">
        <Search className="h-4 w-4 text-slate-400" />
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Buscar por nombre, documento, teléfono o correo"
          className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400"
        />
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-5 w-5 animate-spin text-[#3f3fd8]" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white px-6 py-16 text-center">
          <Users className="mx-auto h-8 w-8 text-slate-300" />
          <p className="mt-3 text-sm font-bold text-slate-800">
            {customers.length === 0
              ? "Todavía no hay clientes"
              : "Sin resultados"}
          </p>
          <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
            {customers.length === 0
              ? "Registra a tus clientes para vender a crédito y llevar su historial."
              : "Prueba con otro nombre o documento."}
          </p>
          {customers.length === 0 ? (
            <div className="mt-5">
              <PosButton onClick={create}>Crear el primero</PosButton>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Cliente</th>
                <th className="px-4 py-2.5 font-semibold">Documento</th>
                <th className="px-4 py-2.5 font-semibold">Teléfono</th>
                <th className="px-4 py-2.5 font-semibold">Correo</th>
                <th className="px-4 py-2.5 text-right font-semibold">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((customer) => (
                <tr key={customer.id} className="hover:bg-slate-50/60">
                  <td className="px-4 py-3 font-semibold text-slate-800">
                    {customer.name}
                  </td>
                  <td className="px-4 py-3 text-slate-500">
                    {customer.document ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-slate-500">
                    {customer.phone ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-slate-500">
                    {customer.email ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => edit(customer)}
                      className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                      title="Editar"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {open ? (
        <CustomerDialog
          accountId={accountId}
          customer={editing}
          onClose={() => setOpen(false)}
          onSaved={() => {
            setOpen(false);
            void load();
          }}
        />
      ) : null}
    </div>
  );
}

function CustomerDialog({
  accountId,
  customer,
  onClose,
  onSaved,
}: {
  accountId: string | null;
  customer: Customer | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(customer?.name ?? "");
  const [document, setDocument] = useState(customer?.document ?? "");
  const [phone, setPhone] = useState(customer?.phone ?? "");
  const [email, setEmail] = useState(customer?.email ?? "");
  const [address, setAddress] = useState(customer?.address ?? "");
  const [notes, setNotes] = useState(customer?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!accountId) return;
    if (name.trim().length < 2) {
      setError("Escribe el nombre del cliente.");
      return;
    }

    setSaving(true);
    setError(null);
    const supabase = createClient();

    const payload = {
      name: name.trim(),
      document: document.trim() || null,
      phone: phone.trim() || null,
      email: email.trim() || null,
      address: address.trim() || null,
      notes: notes.trim() || null,
    };

    const { error: dbError } = customer
      ? await supabase.from("pos_customers").update(payload).eq("id", customer.id)
      : await supabase
          .from("pos_customers")
          .insert({ account_id: accountId, ...payload });

    setSaving(false);
    if (dbError) {
      setError(dbError.message);
      return;
    }
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-black text-slate-900">
              {customer ? "Editar cliente" : "Nuevo cliente"}
            </h2>
            <p className="text-xs text-slate-500">
              Solo para el POS. No crea ni modifica contactos del CRM.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nombre *">
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="Documento / RIF">
            <input
              value={document}
              onChange={(event) => setDocument(event.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="Teléfono">
            <input
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="Correo">
            <input
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className={inputClass}
            />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Dirección">
              <input
                value={address}
                onChange={(event) => setAddress(event.target.value)}
                className={inputClass}
              />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Notas">
              <textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                rows={2}
                className={inputClass}
              />
            </Field>
          </div>
        </div>

        {error ? (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </p>
        ) : null}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-500 hover:bg-slate-50"
          >
            Cancelar
          </button>
          <PosButton onClick={() => void save()} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Guardar
          </PosButton>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-semibold text-slate-500">{label}</span>
      {children}
    </label>
  );
}

const inputClass =
  "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#3f3fd8]";

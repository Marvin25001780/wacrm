"use client";

import { useState } from "react";

// Formulario público de la landing. Crea el contacto y el lead en el
// CRM mediante /api/public/lead (ver esa ruta para la validación).

type Status = "idle" | "sending" | "sent" | "error";

const inputClass =
  "w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-brand-purple focus:ring-2 focus:ring-purple-100";

export function ContactForm() {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (status === "sending") return;

    const form = new FormData(event.currentTarget);
    const payload = {
      name: String(form.get("name") ?? ""),
      phone: String(form.get("phone") ?? ""),
      email: String(form.get("email") ?? ""),
      company: String(form.get("company") ?? ""),
      message: String(form.get("message") ?? ""),
      website: String(form.get("website") ?? ""),
    };

    setStatus("sending");
    setError("");

    try {
      const res = await fetch("/api/public/lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };

      if (!res.ok) {
        setError(json.error || "No se pudo enviar. Inténtalo de nuevo.");
        setStatus("error");
        return;
      }

      setStatus("sent");
      event.currentTarget.reset();
    } catch {
      setError("No se pudo conectar. Revisa tu conexión e inténtalo otra vez.");
      setStatus("error");
    }
  }

  if (status === "sent") {
    return (
      <div className="flex h-full flex-col items-start justify-center rounded-2xl border border-emerald-200 bg-emerald-50 p-8">
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
          <svg
            className="h-6 w-6"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              d="M5 13l4 4L19 7"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2.5"
            />
          </svg>
        </span>
        <h3 className="mt-4 text-lg font-black text-slate-900">
          Recibimos tus datos
        </h3>
        <p className="mt-2 text-sm text-slate-600">
          Un asesor te contactará por teléfono o correo. Si prefieres
          adelantar, escríbenos a contacto@nexusbpo.space.
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xl shadow-slate-900/5 sm:p-8"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-bold text-slate-700">Nombre *</span>
          <input
            name="name"
            required
            minLength={2}
            maxLength={120}
            autoComplete="name"
            placeholder="Tu nombre"
            className={inputClass}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-bold text-slate-700">Teléfono *</span>
          <input
            name="phone"
            required
            maxLength={40}
            inputMode="tel"
            autoComplete="tel"
            placeholder="+58 414 1234567"
            className={inputClass}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-bold text-slate-700">Correo</span>
          <input
            name="email"
            type="email"
            maxLength={200}
            autoComplete="email"
            placeholder="tu@empresa.com"
            className={inputClass}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-bold text-slate-700">Empresa</span>
          <input
            name="company"
            maxLength={160}
            autoComplete="organization"
            placeholder="Nombre de tu empresa"
            className={inputClass}
          />
        </label>
      </div>

      <label className="mt-4 flex flex-col gap-1.5">
        <span className="text-xs font-bold text-slate-700">
          ¿Qué necesitas?
        </span>
        <textarea
          name="message"
          rows={4}
          maxLength={2000}
          placeholder="Cuéntanos cuántos agentes usan WhatsApp y qué quieres automatizar."
          className={inputClass}
        />
      </label>

      {/* Honeypot: invisible para personas, tentador para bots. */}
      <input
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="hidden"
      />

      {status === "error" ? (
        <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={status === "sending"}
        className="mt-5 inline-flex w-full items-center justify-center rounded-full bg-brand-purple px-6 py-3.5 text-sm font-extrabold text-white shadow-lg shadow-purple-500/20 transition-all hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-70"
      >
        {status === "sending" ? "Enviando..." : "Solicitar información"}
      </button>

      <p className="mt-3 text-center text-[11px] leading-relaxed text-slate-500">
        Al enviar aceptas la{" "}
        <a href="/privacidad" className="underline hover:text-brand-purple">
          Política de Privacidad
        </a>
        . Usamos tus datos solo para contactarte.
      </p>
    </form>
  );
}

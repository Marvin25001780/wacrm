"use client";

import Link from "next/link";

import { ContactForm } from "@/components/marketing/contact-form";

// ============================================================
// Landing pública de NEXUS CRM.
//
// Usa el Tailwind compilado del proyecto: los colores de marca viven
// en globals.css (@theme) y las animaciones en el bloque de estilos
// de abajo. Nada de CDN, así que no hay parpadeo ni dependencia
// externa.
//
// Los enlaces legales y de acceso apuntan a rutas reales del CRM.
// ============================================================

const LANDING_CSS = `
  html { scroll-behavior: smooth; }
  .text-gradient-purple {
    background: linear-gradient(135deg, #1E1035 0%, #6D28D9 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
  }
  .text-gradient-glow {
    background: linear-gradient(135deg, #A78BFA 0%, #C4B5FD 50%, #38BDF8 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
  }
  .badge-blur { backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); }
  @keyframes float-slow {
    0%, 100% { transform: translateY(0px) rotate(0deg); }
    50% { transform: translateY(-10px) rotate(1deg); }
  }
  @keyframes float-reverse {
    0%, 100% { transform: translateY(0px) rotate(0deg); }
    50% { transform: translateY(12px) rotate(-1.5deg); }
  }
  .animate-float-1 { animation: float-slow 5s ease-in-out infinite; }
  .animate-float-2 { animation: float-reverse 6s ease-in-out infinite; }
`;

export function Landing() {
  return (
    <div className="min-h-screen bg-white font-sans text-slate-800 antialiased selection:bg-purple-100 selection:text-brand-purple">
      <style dangerouslySetInnerHTML={{ __html: LANDING_CSS }} />

      {/* ---------------- Navbar ---------------- */}
      <header className="sticky top-0 z-50 border-b border-slate-100 bg-white/95 backdrop-blur-md">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-20 items-center justify-between">
            <Link
              href="/"
              className="group flex items-center gap-3"
              title="Nexus CRM Inicio"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-tr from-brand-purple to-purple-500 text-white shadow-md shadow-purple-500/20 transition-transform group-hover:scale-105">
                <svg
                  className="h-6 w-6"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  viewBox="0 0 24 24"
                >
                  <path
                    d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
              <span className="text-2xl font-black tracking-tight text-slate-900">
                Nexus<span className="text-brand-purple">CRM</span>
              </span>
            </Link>

            <nav
              aria-label="Navegación principal"
              className="hidden items-center space-x-8 md:flex"
            >
              <div className="group relative">
                <button className="flex items-center py-2 text-sm font-semibold text-slate-600 transition-colors hover:text-brand-purple">
                  <span>Soluciones</span>
                  <svg
                    className="ml-1 h-4 w-4 text-slate-400 transition-transform group-hover:rotate-180 group-hover:text-brand-purple"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      d="M19 9l-7 7-7-7"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                    />
                  </svg>
                </button>
                <div className="invisible absolute -left-4 top-full w-60 rounded-2xl border border-slate-100 bg-white p-3 opacity-0 shadow-xl transition-all duration-200 group-hover:visible group-hover:opacity-100">
                  <a
                    className="block rounded-xl p-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-purple-50 hover:text-brand-purple"
                    href="#ventas"
                  >
                    <span className="block font-bold">Para Equipos de Ventas</span>
                    <span className="text-xs text-slate-500">
                      Pipelines &amp; seguimiento
                    </span>
                  </a>
                  <a
                    className="block rounded-xl p-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-purple-50 hover:text-brand-purple"
                    href="#atencion"
                  >
                    <span className="block font-bold">Atención &amp; Soporte 24/7</span>
                    <span className="text-xs text-slate-500">
                      Bots e inteligencia artificial
                    </span>
                  </a>
                  <a
                    className="block rounded-xl p-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-purple-50 hover:text-brand-purple"
                    href="#cobranzas"
                  >
                    <span className="block font-bold">Gestión de Cobranzas</span>
                    <span className="text-xs text-slate-500">
                      Avisos y estados de cuenta
                    </span>
                  </a>
                </div>
              </div>
              <a
                className="text-sm font-semibold text-slate-600 transition-colors hover:text-brand-purple"
                href="#omnicanalidad"
              >
                Omnicanalidad
              </a>
              <a
                className="text-sm font-semibold text-slate-600 transition-colors hover:text-brand-purple"
                href="#canales"
              >
                Integraciones
              </a>
              <a
                className="text-sm font-semibold text-slate-600 transition-colors hover:text-brand-purple"
                href="#ia-automatizacion"
              >
                Automatizaciones
              </a>
              <a
                className="text-sm font-semibold text-slate-600 transition-colors hover:text-brand-purple"
                href="#precios"
              >
                Precios
              </a>
            </nav>

            <div className="flex items-center space-x-4">
              <div className="hidden items-center space-x-1 rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-bold uppercase tracking-wider text-slate-500 sm:flex">
                <span>ES</span>
              </div>
              <Link
                className="px-3 py-2 text-sm font-bold text-slate-700 transition-colors hover:text-brand-purple"
                href="/login"
              >
                Iniciar sesión
              </Link>
              <Link
                className="inline-flex items-center justify-center rounded-full bg-slate-900 px-6 py-3 text-sm font-extrabold text-white shadow-md transition-all duration-200 hover:bg-brand-purple hover:shadow-brand-purple/30"
                href="/signup"
              >
                Prueba gratis
              </Link>
            </div>
          </div>
        </div>
      </header>

      {/* ---------------- Hero ---------------- */}
      <section className="relative overflow-hidden bg-gradient-to-b from-purple-50/50 via-white to-white pb-24 pt-12">
        <div className="pointer-events-none absolute left-1/2 top-10 -z-10 h-96 w-full max-w-7xl -translate-x-1/2 rounded-full bg-gradient-to-r from-purple-200/30 via-pink-200/20 to-emerald-100/30 blur-3xl" />
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-12 lg:gap-8">
            <div className="space-y-8 text-center lg:col-span-7 lg:text-left">
              <div className="inline-flex items-center gap-2 rounded-full border border-purple-200/60 bg-purple-100 px-3.5 py-1.5 text-xs font-bold uppercase tracking-wider text-brand-purple sm:text-sm">
                <span className="h-2 w-2 animate-ping rounded-full bg-brand-whatsapp" />
                El CRM de WhatsApp y Redes Sociales nº1
              </div>

              <h1 className="text-4xl font-black leading-[1.15] tracking-tight text-slate-900 sm:text-5xl lg:text-6xl">
                Crea relaciones con tus clientes por{" "}
                <span className="text-brand-purple">WhatsApp</span> y haz crecer
                tu empresa
              </h1>

              <p className="mx-auto max-w-2xl text-lg font-normal leading-relaxed text-slate-600 sm:text-xl lg:mx-0">
                Convierte conversaciones en ventas. Centraliza los chats de{" "}
                <strong>
                  WhatsApp Business, Instagram DM, Facebook Messenger y TikTok
                </strong>{" "}
                en una única bandeja con embudos Kanban y agentes de IA.
              </p>

              <div className="space-y-4 pt-2">
                <div className="flex flex-col items-center justify-center gap-4 sm:flex-row lg:justify-start">
                  <Link
                    className="w-full rounded-full bg-slate-900 px-8 py-4 text-center text-base font-extrabold text-white shadow-xl shadow-slate-900/10 transition-all hover:bg-brand-purple hover:shadow-brand-purple/30 sm:w-auto"
                    href="/signup"
                  >
                    Empieza tu prueba gratis
                  </Link>
                  <a
                    className="flex w-full items-center justify-center gap-2 rounded-full border border-slate-300 px-8 py-4 text-center text-base font-bold text-slate-700 transition-all hover:border-slate-800 hover:text-slate-900 sm:w-auto"
                    href="#omnicanalidad"
                  >
                    <svg
                      className="h-5 w-5 text-brand-purple"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path
                        clipRule="evenodd"
                        d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z"
                        fillRule="evenodd"
                      />
                    </svg>
                    Ver demostración
                  </a>
                </div>
                <div className="flex items-center justify-center gap-6 text-xs font-medium text-slate-500 lg:justify-start">
                  <span className="flex items-center gap-1.5">
                    <svg
                      className="h-4 w-4 text-emerald-500"
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
                    Sin tarjeta de crédito
                  </span>
                  <span className="flex items-center gap-1.5">
                    <svg
                      className="h-4 w-4 text-emerald-500"
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
                    Conexión en minutos por QR
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-center gap-5 border-t border-slate-100 pt-4 lg:justify-start">
                <span className="text-xs font-extrabold uppercase tracking-wider text-slate-400">
                  Canales verificados:
                </span>
                <div className="flex flex-wrap items-center gap-4">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
                    <span className="h-2 w-2 rounded-full bg-brand-whatsapp" />{" "}
                    WhatsApp Cloud API
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-pink-200 bg-pink-50 px-3 py-1 text-xs font-bold text-pink-700">
                    <span className="h-2 w-2 rounded-full bg-brand-instagram" />{" "}
                    Instagram Direct
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-xs font-bold text-slate-800">
                    <span className="h-2 w-2 rounded-full bg-slate-900" /> TikTok
                    for Business
                  </span>
                </div>
              </div>
            </div>

            {/* Mockup expresivo */}
            <div className="relative flex justify-center lg:col-span-5">
              <div className="relative flex aspect-square w-full max-w-lg items-center justify-center">
                <div className="absolute -left-6 -top-6 h-36 w-36 rotate-12 rounded-3xl bg-pink-300 opacity-60 blur-sm" />
                <div className="absolute -bottom-6 -right-6 h-44 w-44 rounded-full bg-blue-300 opacity-50 blur-sm" />
                <div className="absolute left-1/2 top-1/2 h-80 w-80 -translate-x-1/2 -translate-y-1/2 rounded-full bg-purple-200/70" />

                <div className="animate-float-1 relative z-20 flex h-44 w-44 items-center justify-center rounded-full border-4 border-white bg-gradient-to-tr from-[#1EBE5D] to-[#25D366] shadow-2xl shadow-emerald-500/40 sm:h-52 sm:w-52">
                  <svg
                    className="h-24 w-24 text-white drop-shadow-md"
                    fill="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z" />
                  </svg>
                </div>

                <div className="animate-float-2 absolute -top-2 right-2 z-30 max-w-[210px] rounded-2xl border border-slate-100 bg-white/95 p-3.5 shadow-xl backdrop-blur-md sm:right-0">
                  <div className="mb-1.5 flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-emerald-500" />
                    <span className="text-[11px] font-black uppercase text-slate-500">
                      Nuevo Lead Calificado
                    </span>
                  </div>
                  <p className="text-xs font-bold text-slate-800">Andrea Mújica</p>
                  <p className="truncate text-[11px] text-slate-500">
                    &quot;Hola, quiero automatizar mis cobranzas&quot;
                  </p>
                  <span className="mt-1 inline-block rounded bg-purple-100 px-2 py-0.5 text-[10px] font-bold text-brand-purple">
                    WhatsApp • $32,000
                  </span>
                </div>

                <div className="absolute -left-2 bottom-2 z-30 max-w-[220px] rounded-2xl bg-slate-900 p-4 text-white shadow-2xl sm:-left-6">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-purple-400">
                      Agente IA Nexus
                    </span>
                    <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-bold text-emerald-300">
                      Respuesta 1s
                    </span>
                  </div>
                  <p className="text-xs font-semibold text-slate-200">
                    Cotización enviada y cita agendada en calendario
                  </p>
                  <div className="mt-2.5 flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                    <span className="text-[10px] text-slate-400">
                      Lead transferido a Ventas
                    </span>
                  </div>
                </div>

                <div className="absolute -bottom-4 right-10 z-20 flex h-20 w-20 rotate-6 flex-col items-center justify-center rounded-3xl border-4 border-white bg-amber-400 shadow-lg">
                  <div className="flex gap-2">
                    <div className="h-4 w-3 rounded-full bg-slate-900" />
                    <div className="h-4 w-3 rounded-full bg-slate-900" />
                  </div>
                  <div className="mt-1.5 h-2 w-4 rounded-b-full bg-slate-900" />
                  <span className="mt-1 text-[9px] font-black uppercase tracking-tighter text-slate-900">
                    24/7 ACTIVO
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ---------------- Beneficios ---------------- */}
      <section className="border-y border-slate-800 bg-slate-900 py-10 text-white">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
            <Benefit
              title="Todo en una bandeja"
              description="WhatsApp, Instagram, Messenger y TikTok sin cambiar de pestaña."
            />
            <Benefit
              title="IA que responde"
              description="Agentes entrenados con tu información, disponibles a toda hora."
            />
            <Benefit
              title="Cobranza ordenada"
              description="Cartera, cuotas y pagos con recordatorios y reportes."
            />
            <Benefit
              title="Conecta en minutos"
              description="Cada canal se activa con su flujo oficial, sin programar."
            />
          </div>
        </div>
      </section>

      {/* ---------------- Bandeja unificada ---------------- */}
      <section className="bg-slate-50 py-24" id="omnicanalidad">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mx-auto mb-16 max-w-3xl space-y-4 text-center">
            <span className="rounded-full bg-purple-100/70 px-3.5 py-1 text-xs font-extrabold uppercase tracking-widest text-brand-purple">
              Bandeja de Entrada Unificada
            </span>
            <h2 className="text-3xl font-black tracking-tight text-slate-900 sm:text-4xl">
              Todos tus canales en un solo lugar. Adiós a los mensajes perdidos.
            </h2>
            <p className="text-base text-slate-600 sm:text-lg">
              No cambies entre WhatsApp Web, la app de Instagram o la cuenta
              publicitaria de TikTok. Todo tu equipo atiende desde una consola
              unificada en tiempo real.
            </p>
          </div>

          <div className="mx-auto max-w-5xl rounded-3xl border border-slate-800 bg-slate-950 p-4 text-slate-100 shadow-2xl sm:p-6">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div className="flex items-center gap-3">
                <span className="h-3 w-3 rounded-full bg-red-500" />
                <span className="h-3 w-3 rounded-full bg-yellow-500" />
                <span className="h-3 w-3 rounded-full bg-green-500" />
                <span className="ml-2 font-mono text-xs font-bold text-slate-400">
                  nexusbpo.space/inbox
                </span>
              </div>
              <span className="inline-flex items-center gap-1.5 rounded-md bg-purple-900/60 px-2.5 py-1 text-xs font-bold text-purple-300">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> 4
                Canales Activos
              </span>
            </div>

            <div className="mt-4 grid grid-cols-1 overflow-hidden rounded-xl border border-slate-800/80 bg-[#0F0C1B] md:grid-cols-12">
              <div className="space-y-2 border-r border-slate-800/80 p-3 md:col-span-5">
                <div className="p-2">
                  <div className="w-full rounded-lg border border-slate-800 bg-slate-900/90 px-3 py-2 text-xs text-slate-500">
                    Buscar conversaciones...
                  </div>
                </div>

                <div className="flex items-center justify-between rounded-xl border border-slate-800/90 bg-slate-900/70 p-3 transition-colors hover:bg-slate-800">
                  <div className="flex items-center gap-3">
                    <div className="relative">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-pink-600/20 text-sm font-bold text-pink-500">
                        IG
                      </div>
                      <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-brand-purple text-[10px] font-bold text-white">
                        1
                      </span>
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-bold text-white">
                          @andrea_boutique
                        </span>
                        <span className="text-[10px] text-slate-500">Hace 5m</span>
                      </div>
                      <p className="truncate text-[11px] text-slate-400">
                        ¿Tienen catálogo para mayoreo?
                      </p>
                    </div>
                  </div>
                  <span className="h-2 w-2 rounded-full bg-brand-purple" />
                </div>

                <div className="flex items-center justify-between rounded-xl border border-purple-500/40 bg-purple-950/40 p-3">
                  <div className="flex items-center gap-3">
                    <div className="relative">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-600/20 text-sm font-bold text-emerald-400">
                        WA
                      </div>
                      <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 text-[10px] font-bold text-white">
                        3
                      </span>
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-bold text-white">
                          +58 422 2433946
                        </span>
                        <span className="text-[10px] text-purple-300">Ahora</span>
                      </div>
                      <p className="truncate text-[11px] font-medium text-slate-300">
                        Acabo de transferir, adjunto comprobante
                      </p>
                    </div>
                  </div>
                  <span className="h-2 w-2 rounded-full bg-emerald-400" />
                </div>

                <div className="flex items-center justify-between rounded-xl border border-transparent bg-slate-900/50 p-3 hover:border-slate-800">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-cyan-950 text-sm font-bold text-cyan-400">
                      TT
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-bold text-white">
                          carlos.ventas20
                        </span>
                        <span className="text-[10px] text-slate-500">1h</span>
                      </div>
                      <p className="truncate text-[11px] text-slate-400">
                        Vi su video, me interesa su CRM
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex flex-col justify-between bg-slate-900/40 p-4 md:col-span-7">
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500/20 text-xs font-bold text-emerald-400">
                      WA
                    </div>
                    <div>
                      <p className="text-xs font-bold text-white">
                        +58 422 2433946 (Andrea Mujica)
                      </p>
                      <p className="text-[10px] text-emerald-400">
                        Etapa: Calificado ($32,000)
                      </p>
                    </div>
                  </div>
                  <span className="rounded border border-purple-500/30 bg-purple-600/30 px-2.5 py-1 text-[11px] font-semibold text-purple-300">
                    Bot Auto-responder: ON
                  </span>
                </div>

                <div className="space-y-4 py-6 text-xs">
                  <div className="flex items-end gap-2">
                    <div className="max-w-sm rounded-2xl rounded-bl-none bg-slate-800 p-3">
                      <p className="text-slate-200">
                        Hola, me interesa el plan empresarial para 15 asesores de
                        ventas y conectar WhatsApp Business.
                      </p>
                      <span className="mt-1 block text-[10px] text-slate-500">
                        11:42 AM
                      </span>
                    </div>
                  </div>
                  <div className="flex items-end justify-end gap-2">
                    <div className="max-w-sm rounded-2xl rounded-br-none border border-purple-600/40 bg-purple-900/60 p-3 text-right">
                      <span className="mb-0.5 block text-[10px] font-bold text-purple-300">
                        Nexus AI Bot
                      </span>
                      <p className="text-white">
                        ¡Hola Andrea! Encantado. El plan Business incluye asesores
                        ilimitados, IA y WhatsApp multiagente oficial. ¿Te gustaría
                        agendar una demo guiada de 10 minutos?
                      </p>
                      <span className="mt-1 block text-[10px] text-purple-300">
                        11:42 AM • Entregado
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 border-t border-slate-800 pt-3">
                  <div className="w-full rounded-xl border border-slate-700/60 bg-slate-800/80 px-4 py-2.5 text-xs text-slate-500">
                    Escribe una respuesta o usa &apos;/&apos; para atajos...
                  </div>
                  <span className="rounded-xl bg-brand-purple px-4 py-2.5 text-xs font-bold text-white">
                    Enviar
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ---------------- Tres pilares ---------------- */}
      <section className="bg-white py-24" id="ventas">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mx-auto mb-16 max-w-3xl space-y-3 text-center">
            <span className="rounded-full border border-purple-200 bg-purple-50 px-3.5 py-1 text-xs font-extrabold uppercase tracking-widest text-brand-purple">
              Soluciones por Área
            </span>
            <h2 className="text-3xl font-black text-slate-900 sm:text-4xl">
              Diseñado para cada etapa de tu negocio
            </h2>
            <p className="text-base text-slate-600">
              Una sola plataforma para potenciar ventas comerciales, automatizar
              cobranzas recurrentes y fidelizar clientes con atención inmediata.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
            <article className="group flex flex-col justify-between rounded-3xl border border-slate-200 bg-white p-8 transition-all hover:border-purple-200 hover:shadow-xl">
              <div>
                <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-2xl bg-purple-100 font-bold text-brand-purple transition-transform group-hover:scale-110">
                  <svg
                    className="h-6 w-6"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                    />
                  </svg>
                </div>
                <h3 className="mb-2 text-xl font-black text-slate-900">
                  1. Para Equipos de Ventas
                </h3>
                <p className="mb-6 text-sm text-slate-600">
                  Visualiza cada oportunidad en pipelines Kanban personalizables.
                  Asigna prospectos automáticamente a tus asesores y no pierdas ni
                  un solo cierre.
                </p>

                <div className="space-y-2 rounded-xl border border-slate-800 bg-slate-900 p-3 text-xs text-slate-200">
                  <div className="flex justify-between border-b border-slate-800 pb-1.5 text-[10px] font-bold uppercase text-slate-400">
                    <span>Pipeline de Ventas</span>
                    <span className="text-purple-400">Total: $32,000 US$</span>
                  </div>
                  <div className="space-y-1.5 pt-1">
                    <div className="rounded border-l-2 border-amber-400 bg-slate-800 p-2 text-[11px]">
                      <p className="font-bold text-white">Prueba Software BPO</p>
                      <p className="text-[10px] text-slate-400">
                        10 US$ • Andrea Mujica
                      </p>
                    </div>
                    <div className="rounded border-l-2 border-emerald-400 bg-slate-800 p-2 text-[11px]">
                      <p className="font-bold text-white">
                        Suscripción Anual Meta
                      </p>
                      <p className="text-[10px] text-slate-400">
                        1,200 US$ • En Negociación
                      </p>
                    </div>
                  </div>
                </div>
              </div>
              <ul className="mt-6 space-y-2 text-xs font-semibold text-slate-700">
                <li className="flex items-center gap-2">
                  <Check /> Embudos múltiples por producto o país
                </li>
                <li className="flex items-center gap-2">
                  <Check /> Distribución equitativa tipo Round-Robin
                </li>
              </ul>
            </article>

            <article
              className="group flex flex-col justify-between rounded-3xl border border-purple-200 bg-gradient-to-b from-purple-50/30 to-white p-8 shadow-lg shadow-purple-500/5"
              id="atencion"
            >
              <div>
                <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-100 font-bold text-brand-whatsapp transition-transform group-hover:scale-110">
                  <svg
                    className="h-6 w-6"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      d="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a1.994 1.994 0 01-1.414-.586m0 0L11 14h4a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2v4l.586-.586z"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                    />
                  </svg>
                </div>
                <div className="mb-2 inline-block rounded-full bg-emerald-100 px-2.5 py-0.5 text-[10px] font-bold uppercase text-emerald-800">
                  Más Popular
                </div>
                <h3 className="mb-2 text-xl font-black text-slate-900">
                  2. Atención y Soporte 24/7
                </h3>
                <p className="mb-6 text-sm text-slate-600">
                  Resuelve dudas recurrentes en segundos con agentes de
                  Inteligencia Artificial entrenados con las preguntas y políticas
                  de tu empresa.
                </p>

                <div className="space-y-2 rounded-xl border border-purple-100 bg-white p-4 shadow-sm">
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                    <span className="text-xs font-bold text-slate-900">
                      Respuestas rápidas instantáneas
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500">
                    Plantillas aprobadas por Meta para envíos masivos y
                    recordatorios sin riesgo de baneo.
                  </p>
                </div>
              </div>
              <ul className="mt-6 space-y-2 text-xs font-semibold text-slate-700">
                <li className="flex items-center gap-2">
                  <Check /> Multiagente: 1 solo número para todo el staff
                </li>
                <li className="flex items-center gap-2">
                  <Check /> Encuestas de satisfacción CSAT al finalizar
                </li>
              </ul>
            </article>

            <article className="group flex flex-col justify-between rounded-3xl border border-slate-200 bg-white p-8 transition-all hover:border-purple-200 hover:shadow-xl" id="cobranzas">
              <div>
                <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-100 font-bold text-amber-700 transition-transform group-hover:scale-110">
                  <svg
                    className="h-6 w-6"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                    />
                  </svg>
                </div>
                <h3 className="mb-2 text-xl font-black text-slate-900">
                  3. Módulo de Cobranzas
                </h3>
                <p className="mb-6 text-sm text-slate-600">
                  Recupera cartera vencida y automatiza recordatorios de
                  vencimiento antes, durante y después del plazo con botones de
                  pago dinámicos.
                </p>

                <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                  <div className="flex items-center justify-between text-[11px] font-bold">
                    <span>Recordatorio Preventivo</span>
                    <span className="rounded bg-emerald-50 px-2 py-0.5 text-emerald-600">
                      Enviado por WhatsApp
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500">
                    &quot;Estimado cliente, su factura vence en 3 días. Haga clic
                    aquí para liquidar en línea.&quot;
                  </p>
                </div>
              </div>
              <ul className="mt-6 space-y-2 text-xs font-semibold text-slate-700">
                <li className="flex items-center gap-2">
                  <Check /> Historial de promesas de pago y notas
                </li>
                <li className="flex items-center gap-2">
                  <Check /> Carga masiva de cartera y pagos
                </li>
              </ul>
            </article>
          </div>
        </div>
      </section>

      {/* ---------------- Canales ---------------- */}
      <section
        className="relative overflow-hidden bg-slate-900 py-24 text-white"
        id="canales"
      >
        <div className="relative z-10 mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mb-12 flex flex-col justify-between md:flex-row md:items-end">
            <div className="max-w-2xl space-y-3">
              <span className="rounded-full border border-emerald-800/80 bg-emerald-950/70 px-3.5 py-1 text-xs font-extrabold uppercase tracking-widest text-emerald-400">
                Conexión Rápida Sin Código
              </span>
              <h2 className="text-3xl font-black tracking-tight text-white sm:text-4xl">
                Canales de Mensajería Oficiales
              </h2>
              <p className="text-base text-slate-400">
                Conecta WhatsApp escaneando un código QR o usando la Cloud API
                oficial de Meta. Cada canal se activa en tiempo récord con
                sincronización bidireccional.
              </p>
            </div>
            <div className="mt-4 md:mt-0">
              <span className="inline-flex items-center gap-2 rounded-xl border border-amber-800/50 bg-amber-950/40 px-3.5 py-2 text-xs text-amber-300">
                <svg
                  className="h-4 w-4 text-amber-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                  />
                </svg>
                Webhooks registrados de forma automática
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
            <ChannelCard
              code="WA"
              title="WhatsApp Business"
              description="Meta Cloud API y Evolution QR. Vincula tu número en segundos."
              footer="API Oficial Meta"
              badge="Conectado"
              tone="emerald"
            />
            <ChannelCard
              code="IG"
              title="Instagram Direct"
              description="Recibe DMs y respuestas a Stories directamente en tu bandeja."
              footer="Login directo"
              badge="Conectado"
              tone="pink"
            />
            <ChannelCard
              code="FB"
              title="Facebook Messenger"
              description="Atiende los mensajes que ingresan a tus páginas de empresa."
              footer="Página vinculada"
              badge="Conectado"
              tone="blue"
            />
            <ChannelCard
              code="TT"
              title="TikTok Business"
              description="Conecta con los leads generados en tus videos y campañas virales."
              footer="Login Kit"
              badge="Vinculado"
              tone="cyan"
            />
          </div>
        </div>
      </section>

      {/* ---------------- IA y automatizaciones ---------------- */}
      <section className="bg-white py-24" id="ia-automatizacion">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 items-center gap-16 lg:grid-cols-2">
            <div className="space-y-6">
              <div className="inline-flex items-center gap-2 rounded-full bg-purple-100 px-3 py-1 text-xs font-bold uppercase tracking-wider text-brand-purple">
                <svg
                  className="h-3.5 w-3.5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    d="M13 10V3L4 14h7v7l9-11h-7z"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                  />
                </svg>
                Automatización e IA Generativa
              </div>
              <h2 className="text-3xl font-black leading-tight tracking-tight text-slate-900 sm:text-4xl">
                Pon a tu empresa en piloto automático sin perder el toque humano
              </h2>
              <p className="text-base text-slate-600 sm:text-lg">
                Configura disparadores en segundos: califica presupuestos,
                distribuye chats entre agentes según su disponibilidad y guarda
                contactos en tu base de datos de inmediato.
              </p>

              <div className="space-y-4 pt-2">
                <FeatureStep
                  number="1"
                  tone="purple"
                  title="Calificación Automática de Prospectos"
                  description="El bot pregunta el presupuesto y la necesidad antes de transferir la conversación a un asesor humano."
                />
                <FeatureStep
                  number="2"
                  tone="emerald"
                  title="Respuestas con Inteligencia Artificial"
                  description="Entrena el bot con tu PDF de precios o tu web y responderá consultas técnicas con lenguaje natural 24 horas al día."
                />
                <FeatureStep
                  number="3"
                  tone="blue"
                  title="Sincronización con Webhooks y ERPs"
                  description="Conecta tu sistema de facturación o bases de datos externas sin programadores."
                />
              </div>
            </div>

            <div className="relative rounded-3xl border border-slate-200 bg-slate-50 p-6 sm:p-8">
              <div className="mb-6 flex items-center justify-between text-xs font-bold uppercase tracking-wider text-slate-400">
                <span>Flujo de Trabajo Inteligente</span>
                <span className="flex items-center gap-1 font-bold text-emerald-600">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" /> Activo
                </span>
              </div>

              <div className="space-y-4">
                <FlowStep
                  code="WA"
                  tone="emerald"
                  title="Disparador: Nuevo mensaje recibido"
                  subtitle="De cualquier número no registrado"
                  step="Paso 1"
                />
                <div className="flex justify-center">
                  <div className="-my-1 h-6 w-0.5 bg-purple-300" />
                </div>
                <FlowStep
                  code="IA"
                  tone="purple"
                  title="Agente de IA califica intención"
                  subtitle='Detecta "¿Cuánto cuesta?" o "Quiero contratar"'
                  step="Paso 2"
                />
                <div className="flex justify-center">
                  <div className="-my-1 h-6 w-0.5 bg-purple-300" />
                </div>
                <FlowStep
                  code="CRM"
                  tone="blue"
                  title='Crear lead en Pipeline "Calificado"'
                  subtitle="Asignar al asesor disponible y notificar al equipo"
                  step="Paso 3"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ---------------- Contacto ---------------- */}
      <section className="bg-white py-24" id="contacto">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
            <div className="space-y-5">
              <span className="inline-block rounded-full border border-purple-200 bg-purple-50 px-3.5 py-1 text-xs font-extrabold uppercase tracking-widest text-brand-purple">
                Hablemos
              </span>
              <h2 className="text-3xl font-black leading-tight tracking-tight text-slate-900 sm:text-4xl">
                Cuéntanos qué necesitas y te mostramos el CRM con tus canales
              </h2>
              <p className="max-w-xl text-base text-slate-600">
                Déjanos tus datos y coordinamos una demostración con tu equipo.
                Revisamos cómo usas WhatsApp hoy, qué quieres automatizar y qué
                módulos te convienen.
              </p>

              <ul className="space-y-2 text-sm font-medium text-slate-700">
                <li className="flex items-center gap-2">
                  <Check /> Demostración guiada, sin compromiso
                </li>
                <li className="flex items-center gap-2">
                  <Check /> Configuración de módulos según tu operación
                </li>
                <li className="flex items-center gap-2">
                  <Check /> Te contactamos en horario laborable
                </li>
              </ul>

              <div className="space-y-1 pt-2 text-sm text-slate-600">
                <p>
                  Correo:{" "}
                  <a
                    className="font-semibold text-brand-purple underline"
                    href="mailto:contacto@nexusbpo.space"
                  >
                    contacto@nexusbpo.space
                  </a>
                </p>
                <p>Teléfono: 0422 2433946</p>
              </div>
            </div>

            <ContactForm />
          </div>
        </div>
      </section>

      {/* ---------------- Precios / CTA ---------------- */}
      <section
        className="relative overflow-hidden bg-slate-900 py-20 text-white"
        id="precios"
      >
        <div className="pointer-events-none absolute -bottom-20 -right-20 h-96 w-96 rounded-full bg-brand-purple/20 blur-3xl" />
        <div className="relative z-10 mx-auto max-w-5xl px-4 text-center sm:px-6 lg:px-8">
          <div className="space-y-8">
            <span className="inline-block rounded-full border border-purple-500/30 bg-purple-500/20 px-4 py-1.5 text-xs font-bold uppercase tracking-wider text-purple-300">
              Empieza hoy mismo sin costo inicial
            </span>
            <h2 className="mx-auto max-w-3xl text-4xl font-black leading-tight tracking-tight sm:text-5xl">
              ¿Listo para transformar tus conversaciones de WhatsApp en ingresos?
            </h2>
            <p className="mx-auto max-w-2xl text-lg text-slate-400">
              Únete a las empresas que usan Nexus CRM para unificar sus canales,
              automatizar respuestas y cerrar más ventas a diario.
            </p>
            <div className="flex flex-col items-center justify-center gap-4 pt-4 sm:flex-row">
              <Link
                className="w-full rounded-full bg-brand-purple px-10 py-4 text-base font-black text-white shadow-xl shadow-purple-500/30 transition-all hover:bg-purple-600 sm:w-auto"
                href="/signup"
              >
                Prueba gratis
              </Link>
              <a
                className="w-full rounded-full border border-slate-700 px-8 py-4 text-base font-bold text-slate-300 transition-all hover:border-slate-500 sm:w-auto"
                href="#contacto"
              >
                Agendar una videollamada guiada
              </a>
            </div>
            <p className="text-xs text-slate-500">
              Sin tarjeta de crédito requerida • Soporte en español
            </p>
          </div>
        </div>
      </section>

      {/* ---------------- Footer ---------------- */}
      <footer className="border-t border-slate-100 bg-white py-16">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mb-12 grid grid-cols-2 gap-8 md:grid-cols-5">
            <div className="col-span-2 space-y-4">
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-brand-purple text-sm font-bold text-white">
                  N
                </div>
                <span className="text-xl font-black text-slate-900">
                  Nexus<span className="text-brand-purple">CRM</span>
                </span>
              </div>
              <p className="max-w-sm text-xs leading-relaxed text-slate-500">
                Plataforma omnicanal para equipos de ventas, soporte y cobranzas
                en WhatsApp, Instagram, TikTok y Facebook Messenger.
              </p>
              <div className="flex items-center gap-3 pt-2 text-xs text-slate-400">
                <span>© 2026 Nexus BPO / Nexus CRM.</span>
              </div>
            </div>

            <div>
              <h4 className="mb-4 text-xs font-bold uppercase tracking-wider text-slate-900">
                Producto
              </h4>
              <ul className="space-y-2.5 text-xs text-slate-600">
                <li>
                  <a
                    className="transition-colors hover:text-brand-purple"
                    href="#omnicanalidad"
                  >
                    Bandeja Unificada
                  </a>
                </li>
                <li>
                  <a
                    className="transition-colors hover:text-brand-purple"
                    href="#ventas"
                  >
                    Pipelines Kanban
                  </a>
                </li>
                <li>
                  <a
                    className="transition-colors hover:text-brand-purple"
                    href="#canales"
                  >
                    Integración WhatsApp
                  </a>
                </li>
                <li>
                  <a
                    className="transition-colors hover:text-brand-purple"
                    href="#ia-automatizacion"
                  >
                    Agentes de IA
                  </a>
                </li>
              </ul>
            </div>

            <div>
              <h4 className="mb-4 text-xs font-bold uppercase tracking-wider text-slate-900">
                Soluciones
              </h4>
              <ul className="space-y-2.5 text-xs text-slate-600">
                <li>
                  <a
                    className="transition-colors hover:text-brand-purple"
                    href="#ventas"
                  >
                    Para Ventas
                  </a>
                </li>
                <li>
                  <a
                    className="transition-colors hover:text-brand-purple"
                    href="#cobranzas"
                  >
                    Para Cobranzas
                  </a>
                </li>
                <li>
                  <a
                    className="transition-colors hover:text-brand-purple"
                    href="#atencion"
                  >
                    Para Atención al Cliente
                  </a>
                </li>
                <li>
                  <span className="text-slate-400">BPOs y Call Centers</span>
                </li>
              </ul>
            </div>

            <div>
              <h4 className="mb-4 text-xs font-bold uppercase tracking-wider text-slate-900">
                Seguridad &amp; Legal
              </h4>
              <ul className="space-y-2.5 text-xs text-slate-600">
                <li>
                  <Link
                    className="transition-colors hover:text-brand-purple"
                    href="/terminos"
                  >
                    Términos de Servicio
                  </Link>
                </li>
                <li>
                  <Link
                    className="transition-colors hover:text-brand-purple"
                    href="/privacidad"
                  >
                    Política de Privacidad
                  </Link>
                </li>
                <li>
                  <Link
                    className="transition-colors hover:text-brand-purple"
                    href="/cumplimiento"
                  >
                    Cumplimiento Meta &amp; API
                  </Link>
                </li>
                <li>
                  <Link
                    className="transition-colors hover:text-brand-purple"
                    href="/seguridad"
                  >
                    Seguridad
                  </Link>
                </li>
                <li>
                  <Link
                    className="transition-colors hover:text-brand-purple"
                    href="/estado-del-sistema"
                  >
                    Estado del sistema
                  </Link>
                </li>
                <li>
                  <Link
                    className="transition-colors hover:text-brand-purple"
                    href="/eliminacion-de-datos"
                  >
                    Eliminación de datos
                  </Link>
                </li>
                <li>
                  <Link
                    className="transition-colors hover:text-brand-purple"
                    href="/politicas"
                  >
                    Todas las políticas
                  </Link>
                </li>
                <li>
                  <Link
                    className="transition-colors hover:text-brand-purple"
                    href="/login"
                  >
                    Acceder al CRM
                  </Link>
                </li>
              </ul>
            </div>
          </div>

          <div className="flex flex-col items-center justify-between gap-4 border-t border-slate-100 pt-8 text-xs text-slate-400 sm:flex-row">
            <p>Nexus CRM — Gestión omnicanal para empresas en Latinoamérica.</p>
            <div className="flex items-center space-x-6">
              <span>Cloud API oficial</span>
              <span>Conexión OAuth</span>
              <span>SSL 256-bit</span>
            </div>
          </div>
        </div>
      </footer>

      {/* Tailwind compilado: no se carga ningún CDN. */}
    </div>
  );
}

function Benefit({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/10 text-brand-purple">
        <svg
          className="h-4 w-4"
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
      <div>
        <p className="text-sm font-bold text-white">{title}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-slate-400">
          {description}
        </p>
      </div>
    </div>
  );
}

function Check() {
  return (
    <svg
      className="h-4 w-4 text-emerald-500"
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
  );
}

const TONES = {
  emerald: {
    icon: "bg-emerald-950 text-emerald-400",
    badge: "border-emerald-700/60 bg-emerald-950 text-emerald-300",
    dot: "bg-emerald-400",
    ring: "hover:border-emerald-500/50",
  },
  pink: {
    icon: "bg-pink-950 text-pink-400",
    badge: "border-emerald-700/60 bg-emerald-950 text-emerald-300",
    dot: "bg-emerald-400",
    ring: "hover:border-pink-500/50",
  },
  blue: {
    icon: "bg-blue-950 text-blue-400",
    badge: "border-emerald-700/60 bg-emerald-950 text-emerald-300",
    dot: "bg-emerald-400",
    ring: "hover:border-blue-500/50",
  },
  cyan: {
    icon: "bg-slate-800 text-cyan-300",
    badge: "border-cyan-700/60 bg-cyan-950 text-cyan-300",
    dot: "bg-cyan-400",
    ring: "hover:border-cyan-500/50",
  },
} as const;

function ChannelCard({
  code,
  title,
  description,
  footer,
  badge,
  tone,
}: {
  code: string;
  title: string;
  description: string;
  footer: string;
  badge: string;
  tone: keyof typeof TONES;
}) {
  const styles = TONES[tone];
  return (
    <div
      className={`flex flex-col justify-between rounded-2xl border border-slate-800 bg-slate-950/70 p-5 transition-colors ${styles.ring}`}
    >
      <div>
        <div className="mb-4 flex items-center justify-between">
          <div
            className={`flex h-10 w-10 items-center justify-center rounded-xl font-bold ${styles.icon}`}
          >
            {code}
          </div>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold ${styles.badge}`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${styles.dot}`} /> {badge}
          </span>
        </div>
        <h4 className="mb-1 text-base font-bold text-white">{title}</h4>
        <p className="mb-4 text-xs text-slate-400">{description}</p>
      </div>
      <div className="flex items-center justify-between border-t border-slate-800/80 pt-3 text-xs text-slate-400">
        <span>{footer}</span>
        <Link className="font-bold text-purple-400 hover:underline" href="/login">
          Gestionar →
        </Link>
      </div>
    </div>
  );
}

const STEP_TONES = {
  purple: "bg-purple-100 text-brand-purple",
  emerald: "bg-emerald-100 text-brand-whatsapp",
  blue: "bg-blue-100 text-blue-600",
} as const;

function FeatureStep({
  number,
  title,
  description,
  tone,
}: {
  number: string;
  title: string;
  description: string;
  tone: keyof typeof STEP_TONES;
}) {
  return (
    <div className="flex items-start gap-4">
      <div
        className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-sm font-bold ${STEP_TONES[tone]}`}
      >
        {number}
      </div>
      <div>
        <h4 className="text-base font-bold text-slate-900">{title}</h4>
        <p className="text-sm text-slate-600">{description}</p>
      </div>
    </div>
  );
}

const FLOW_TONES = {
  purple: {
    wrapper: "border-purple-200 bg-purple-50/70",
    icon: "bg-brand-purple text-white",
    title: "text-purple-900",
    subtitle: "text-purple-700",
    step: "text-purple-600",
  },
  emerald: {
    wrapper: "border-slate-200 bg-white",
    icon: "bg-emerald-100 text-emerald-600",
    title: "text-slate-900",
    subtitle: "text-slate-500",
    step: "text-slate-400",
  },
  blue: {
    wrapper: "border-slate-200 bg-white",
    icon: "bg-blue-100 text-blue-600",
    title: "text-slate-900",
    subtitle: "text-slate-500",
    step: "text-slate-400",
  },
} as const;

function FlowStep({
  code,
  title,
  subtitle,
  step,
  tone,
}: {
  code: string;
  title: string;
  subtitle: string;
  step: string;
  tone: keyof typeof FLOW_TONES;
}) {
  const styles = FLOW_TONES[tone];
  return (
    <div
      className={`flex items-center justify-between rounded-2xl border p-4 shadow-sm ${styles.wrapper}`}
    >
      <div className="flex items-center gap-3">
        <span
          className={`flex h-8 w-8 items-center justify-center rounded-xl text-xs font-bold ${styles.icon}`}
        >
          {code}
        </span>
        <div>
          <p className={`text-xs font-bold ${styles.title}`}>{title}</p>
          <p className={`text-[11px] ${styles.subtitle}`}>{subtitle}</p>
        </div>
      </div>
      <span className={`text-[10px] font-bold ${styles.step}`}>{step}</span>
    </div>
  );
}

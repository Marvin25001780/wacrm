"use client"

import { useEffect } from "react"
import Script from "next/script"
import Link from "next/link"

export default function LandingPage() {
  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("opacity-100")
          entry.target.classList.remove("opacity-0", "translate-y-10")
        }
      })
    }, { threshold: 0.1 })
    document.querySelectorAll("section").forEach((s) => {
      s.classList.add("transition-all", "duration-1000", "opacity-0", "translate-y-10")
      observer.observe(s)
    })
    return () => observer.disconnect()
  }, [])

  const openModal = () => document.getElementById("formModal")?.classList.add("active")
  const closeModal = () => document.getElementById("formModal")?.classList.remove("active")

  return (
    <>
      <Script src="https://cdn.tailwindcss.com?plugins=forms,container-queries" strategy="beforeInteractive" />
      <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800&family=Inter:wght@300;400;500;600&family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap" rel="stylesheet" />
      <script id="tailwind-config" dangerouslySetInnerHTML={{
        __html: `
          tailwind.config = {
            darkMode: "class",
            theme: {
              extend: {
                colors: {
                  "primary-container": "#0a0e2e", "on-primary-fixed-variant": "#404467",
                  "error-container": "#93000a", "on-primary": "#2a2e4f",
                  "tertiary-container": "#2b0016", "on-secondary": "#1000a9",
                  "on-surface": "#e0e3e5", "secondary-container": "#3131c0",
                  "inverse-primary": "#585c80", "on-primary-container": "#777aa0",
                  "on-tertiary": "#640039", "surface-container-high": "#272a2c",
                  "surface": "#101415", "primary-fixed": "#dfe0ff",
                  "secondary-fixed-dim": "#c0c1ff", "on-primary-fixed": "#151939",
                  "tertiary-fixed": "#ffd9e4", "inverse-on-surface": "#2d3133",
                  "surface-bright": "#363a3b", "on-secondary-container": "#b0b2ff",
                  "outline-variant": "#46464e", "secondary": "#c0c1ff",
                  "surface-container-lowest": "#0b0f10", "surface-dim": "#101415",
                  "background": "#101415", "outline": "#919098",
                  "on-surface-variant": "#c7c5cf", "surface-container-low": "#191c1e",
                  "surface-container": "#1d2022", "tertiary-fixed-dim": "#ffb0cd",
                  "on-tertiary-fixed": "#3e0022", "surface-tint": "#c1c4ed",
                  "secondary-fixed": "#e1e0ff", "on-secondary-fixed-variant": "#2f2ebe",
                  "on-error": "#690005", "tertiary": "#ffb0cd",
                  "on-secondary-fixed": "#07006c", "on-error-container": "#ffdad6",
                  "primary": "#c1c4ed", "error": "#ffb4ab",
                  "primary-fixed-dim": "#c1c4ed", "surface-container-highest": "#323537",
                  "on-tertiary-fixed-variant": "#8c0053", "on-background": "#e0e3e5",
                  "surface-variant": "#323537", "inverse-surface": "#e0e3e5",
                  "on-tertiary-container": "#dd3b8d"
                },
                borderRadius: { DEFAULT: "1rem", lg: "2rem", xl: "3rem", full: "9999px" },
                fontFamily: {
                  "headline-lg": ["Plus Jakarta Sans"], "body-lg": ["Inter"],
                  "display-lg": ["Plus Jakarta Sans"], "body-md": ["Inter"],
                  "display-sm": ["Plus Jakarta Sans"], "label-md": ["Inter"]
                },
                fontSize: {
                  "headline-lg": ["32px", { lineHeight: "1.3", letterSpacing: "-0.01em", fontWeight: "700" }],
                  "body-lg": ["18px", { lineHeight: "1.6", fontWeight: "400" }],
                  "display-lg": ["64px", { lineHeight: "1.1", letterSpacing: "-0.03em", fontWeight: "800" }],
                  "body-md": ["16px", { lineHeight: "1.5", fontWeight: "400" }],
                  "display-sm": ["40px", { lineHeight: "1.2", letterSpacing: "-0.02em", fontWeight: "700" }],
                  "label-md": ["14px", { lineHeight: "1", letterSpacing: "0.05em", fontWeight: "600" }]
                }
              }
            }
          }
        `
      }} />
      <style>{`
        body { background-color: #0A0E2E; color: #E0E3E5; overflow-x: hidden; }
        .glass-card { background: rgba(255,255,255,0.03); backdrop-filter: blur(20px); border: 1px solid rgba(255,255,255,0.1); }
        .action-gradient { background: linear-gradient(135deg, #6366F1 0%, #EC4899 100%); }
        .glow-shadow:hover { box-shadow: 0 0 30px rgba(99,102,241,0.3); }
        .text-gradient { background: linear-gradient(to right, #C1C4ED, #FFB0CD); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
        @keyframes float { 0% { transform: translateY(0px); } 50% { transform: translateY(-10px); } 100% { transform: translateY(0px); } }
        .animate-float { animation: float 6s ease-in-out infinite; }
        .modal-overlay { display: none; position: fixed; inset: 0; z-index: 100; background: rgba(15,23,42,0.85); backdrop-filter: blur(12px); align-items: center; justify-content: center; padding: 24px; }
        .modal-overlay.active { display: flex; }
        .modal-content { animation: slideUp 0.4s ease-out; }
        @keyframes slideUp { 0% { opacity: 0; transform: translateY(30px); } 100% { opacity: 1; transform: translateY(0); } }
      `}</style>

      {/* TopNavBar */}
      <nav className="fixed top-0 w-full z-50 bg-surface/10 backdrop-blur-xl border-b border-white/10 shadow-[0_0_20px_rgba(99,102,241,0.15)]">
        <div className="max-w-[1440px] mx-auto px-[64px] flex justify-between items-center h-20">
          <div className="font-display-sm text-display-sm font-bold tracking-tighter text-on-surface">NEXUS</div>
          <div className="hidden md:flex items-center gap-[48px]">
            <a className="text-primary font-bold border-b-2 border-primary pb-1 font-body-md text-label-md hover:scale-105 transition-all duration-300" href="#">Services</a>
            <a className="text-on-surface-variant font-body-md text-label-md hover:scale-105 hover:text-primary transition-all duration-300" href="#">Technology</a>
            <a className="text-on-surface-variant font-body-md text-label-md hover:scale-105 hover:text-primary transition-all duration-300" href="#">Case Studies</a>
          </div>
          <div className="flex items-center gap-[24px]">
            <Link href="/login" className="text-on-surface-variant font-body-md text-label-md hover:text-primary transition-all duration-300">
              Sign In
            </Link>
            <button className="hidden md:block action-gradient text-white px-6 py-2.5 rounded-full font-label-md scale-102 active:scale-95 transition-transform glow-shadow">
              Contact Sales
            </button>
            <button className="md:hidden text-on-surface">
              <span className="material-symbols-outlined">menu</span>
            </button>
          </div>
        </div>
      </nav>

      <main className="relative">
        {/* Hero Section */}
        <section className="relative min-h-screen flex items-center pt-20 overflow-hidden">
          <div className="max-w-[1440px] mx-auto px-[64px] grid grid-cols-1 lg:grid-cols-2 gap-[48px] relative z-10">
            <div className="flex flex-col justify-center space-y-[24px]">
              <div className="inline-flex items-center gap-2 bg-[#0a0e2e]/30 border border-primary/20 px-4 py-2 rounded-full w-fit animate-float">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
                </span>
                <span className="text-primary font-label-md tracking-wider">AI-POWERED OMNICHANNEL</span>
              </div>
              <h1 className="font-display-lg text-[64px] lg:text-[64px] leading-[1.1]">
                Conectamos tu marca con el <span className="text-gradient">futuro</span>
              </h1>
              <p className="font-body-lg text-[18px] text-on-surface-variant max-w-xl">
                Revolucione su atención al cliente con nuestra plataforma de próxima generación. Ventas globales, cobranzas impulsadas por IA y cuidado omnicanal impecable.
              </p>
              <div className="flex flex-wrap gap-[24px] pt-4">
                <button onClick={openModal} className="action-gradient text-white px-8 py-4 rounded-full font-label-md text-lg glow-shadow transition-all transform hover:scale-105 active:scale-95">
                  Explorar Soluciones
                </button>
                <button className="glass-card text-on-surface px-8 py-4 rounded-full font-label-md text-lg hover:bg-white/5 transition-all transform hover:scale-105 active:scale-95">
                  Ver Demo
                </button>
              </div>
            </div>
            <div className="hidden lg:flex items-center justify-center relative">
              <div className="glass-card rounded-xl p-8 w-full max-w-md animate-float relative z-20">
                <div className="flex items-center justify-between mb-6">
                  <span className="text-primary font-bold">Live AI Analytics</span>
                  <span className="material-symbols-outlined text-primary">monitoring</span>
                </div>
                <div className="space-y-4">
                  <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-primary to-secondary w-3/4"></div>
                  </div>
                  <div className="flex justify-between text-sm text-on-surface-variant">
                    <span>Customer Satisfaction</span>
                    <span>98.4%</span>
                  </div>
                  <div className="grid grid-cols-2 gap-4 pt-4">
                    <div className="bg-surface-container p-4 rounded-lg">
                      <div className="text-display-sm text-primary font-bold">2.4s</div>
                      <div className="text-xs text-on-surface-variant">Avg Response Time</div>
                    </div>
                    <div className="bg-surface-container p-4 rounded-lg">
                      <div className="text-display-sm text-secondary font-bold">24/7</div>
                      <div className="text-xs text-on-surface-variant">Active Uptime</div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="absolute -top-10 -right-10 w-64 h-64 bg-primary/20 blur-[100px] rounded-full"></div>
              <div className="absolute -bottom-10 -left-10 w-64 h-64 bg-secondary/20 blur-[100px] rounded-full"></div>
            </div>
          </div>
        </section>

        {/* Feature Section: Ecosistema NEXUS */}
        <section className="py-[48px] bg-surface-container-lowest">
          <div className="max-w-[1440px] mx-auto px-[64px]">
            <div className="text-center mb-16 space-y-4">
              <h2 className="font-display-sm text-[40px] text-on-surface">Ecosistema <span className="text-primary">NEXUS</span></h2>
              <p className="font-body-md text-on-surface-variant max-w-2xl mx-auto">Una suite integral de herramientas diseñadas para escalar la comunicación de su empresa a nivel global.</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-[24px]">
              {[
                { icon: "smart_toy", title: "AI Agents", desc: "Intelligent automation 24/7. Agentes conversacionales que aprenden y resuelven el 80% de las consultas de forma autónoma.", isPrimary: true },
                { icon: "hub", title: "Proprietary CRM", desc: "Seamless management. Gestión de clientes centralizada diseñada específicamente para flujos de contact center masivos.", isPrimary: false },
                { icon: "chat_bubble", title: "Omnichannel", desc: "WhatsApp, Instagram, TikTok, Facebook. Conecte con su audiencia donde ya están, sin perder el hilo de la conversación.", isPrimary: true },
                { icon: "language", title: "Global Sales", desc: "High-performance teams. Equipos de ventas especializados para cierres internacionales y expansión de mercado.", isPrimary: false },
              ].map((f, i) => (
                <div key={i} className={`glass-card p-[24px] rounded-xl group transition-all duration-500 ${f.isPrimary ? 'hover:border-primary/50' : 'hover:border-secondary/50'}`}>
                  <div className={`w-16 h-16 rounded-lg flex items-center justify-center mb-6 group-hover:scale-110 transition-transform ${f.isPrimary ? 'bg-primary/10' : 'bg-secondary/10'}`}>
                    <span className={`material-symbols-outlined text-4xl ${f.isPrimary ? 'text-primary' : 'text-secondary'}`}>{f.icon}</span>
                  </div>
                  <h3 className="text-headline-lg font-headline-lg mb-4">{f.title}</h3>
                  <p className="text-on-surface-variant">{f.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Interactive Pricing */}
        <section className="py-[48px] relative overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(99,102,241,0.05)_0%,transparent_50%)]"></div>
          <div className="max-w-[1440px] mx-auto px-[64px] relative z-10">
            <div className="flex flex-col md:flex-row justify-between items-end mb-16 gap-[24px]">
              <div>
                <h2 className="font-display-sm text-[40px] text-on-surface mb-2">Planes de Crecimiento</h2>
                <p className="text-on-surface-variant">Seleccione el nivel de escalabilidad que su empresa necesita hoy.</p>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-[24px]">
              {/* Standard Plan */}
              <div className="glass-card p-8 rounded-xl flex flex-col h-full border-white/5 hover:bg-white/[0.04] transition-colors">
                <div className="mb-8">
                  <span className="text-on-surface-variant font-label-md">STARTUP</span>
                  <div className="flex items-baseline gap-1 mt-2">
                    <span className="text-4xl font-bold">$499</span>
                    <span className="text-on-surface-variant">/mo</span>
                  </div>
                </div>
                <ul className="space-y-4 mb-10 flex-grow">
                  {["Hasta 5 Agentes de IA", "WhatsApp & Instagram", "CRM Estándar"].map((item, i) => (
                    <li key={i} className="flex items-center gap-3">
                      <span className="material-symbols-outlined text-primary text-sm">check_circle</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
                <button onClick={openModal} className="w-full py-4 rounded-xl border border-white/20 hover:bg-white/5 font-label-md transition-all">Get Started</button>
              </div>

              {/* Enterprise Plan */}
              <div className="glass-card p-8 rounded-xl flex flex-col h-full border-primary/40 relative transform md:scale-105 shadow-[0_0_50px_rgba(99,102,241,0.1)] bg-white/[0.05]">
                <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-primary px-4 py-1 rounded-full text-on-primary text-xs font-bold tracking-widest">MOST POPULAR</div>
                <div className="mb-8">
                  <span className="text-primary font-label-md">PROFESSIONAL</span>
                  <div className="flex items-baseline gap-1 mt-2">
                    <span className="text-4xl font-bold">$1,299</span>
                    <span className="text-on-surface-variant">/mo</span>
                  </div>
                </div>
                <ul className="space-y-4 mb-10 flex-grow">
                  {[
                    { text: "Agentes de IA Ilimitados", bold: true },
                    { text: "Suite Omnicanal Completa", bold: false },
                    { text: "CRM con Dashboard Pro", bold: false },
                    { text: "Soporte Prioritario 24/7", bold: false },
                  ].map((item, i) => (
                    <li key={i} className="flex items-center gap-3">
                      <span className="material-symbols-outlined text-primary text-sm">check_circle</span>
                      <span className={item.bold ? "font-medium text-white" : ""}>{item.text}</span>
                    </li>
                  ))}
                </ul>
                <button onClick={openModal} className="w-full py-4 rounded-xl action-gradient text-white font-label-md transition-all glow-shadow">Scale Now</button>
              </div>

              {/* Customs Plan */}
              <div className="glass-card p-8 rounded-xl flex flex-col h-full border-white/5 hover:bg-white/[0.04] transition-colors">
                <div className="mb-8">
                  <span className="text-on-surface-variant font-label-md">GLOBAL</span>
                  <div className="flex items-baseline gap-1 mt-2">
                    <span className="text-4xl font-bold">Custom</span>
                  </div>
                </div>
                <p className="text-on-surface-variant mb-8">Soluciones personalizadas para corporaciones globales con necesidades específicas.</p>
                <ul className="space-y-4 mb-10 flex-grow">
                  {["Infrastructure dedicada", "Entrenamiento de LLM propio"].map((item, i) => (
                    <li key={i} className="flex items-center gap-3">
                      <span className="material-symbols-outlined text-secondary text-sm">check_circle</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
                <button onClick={openModal} className="w-full py-4 rounded-xl border border-white/20 hover:bg-white/5 font-label-md transition-all">Contact Sales</button>
              </div>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="py-[48px] bg-surface relative overflow-hidden">
          <div className="max-w-[1440px] mx-auto px-[64px] relative z-10">
            <div className="text-center mb-16">
              <h2 className="font-display-sm text-[40px] text-on-surface mb-4">Preguntas <span className="text-gradient">Frecuentes</span></h2>
              <p className="text-on-surface-variant max-w-2xl mx-auto">Todo lo que necesitas saber sobre nuestra plataforma y servicios.</p>
            </div>
            <div className="max-w-3xl mx-auto space-y-4">
              {[
                { q: "¿Cómo funciona la prueba gratuita de 10 días?", a: "Te activamos el servicio sin costo durante 10 días para que evalúes la calidad, los tiempos de respuesta y la plataforma. Al término, si deseas continuar, elegimos el plan que mejor se adapte a tu volumen." },
                { q: "¿Qué canales puedo integrar?", a: "WhatsApp (API oficial), Instagram, Facebook Messenger, TikTok, Telegram, chat web, email y telefonía IP. Todos unificados en un solo panel de control." },
                { q: "¿Tienen agentes bilingües?", a: "Sí. Contamos con agentes completamente bilingües (español/inglés) para atender mercados internacionales. También podemos cubrir portugués bajo demanda." },
                { q: "¿Cómo se factura la gestión de cobranza?", a: "Solo pagas comisión sobre lo efectivamente recuperado. No hay costos fijos ni mensualidades. Las comisiones varían según el tramo de mora, desde 1% (preventiva) hasta 20% (+121 días)." },
                { q: "¿Qué tipo de reportes recibo?", a: "Reportes semanales y mensuales con KPIs clave: tiempo promedio de respuesta, satisfacción (CSAT), volumen de interacciones, tasa de resolución, recuperación de cartera y más. Todo vía dashboard web." },
              ].map((faq, i) => (
                <details key={i} className="glass-card rounded-xl overflow-hidden border border-white/5 hover:border-primary/30 transition-all group">
                  <summary className="w-full p-6 flex items-center justify-between text-left cursor-pointer list-none">
                    <span className="font-headline-lg text-lg text-white">{faq.q}</span>
                    <span className="material-symbols-outlined text-primary transition-transform group-open:rotate-180">expand_more</span>
                  </summary>
                  <div className="px-6 pb-6 text-on-surface-variant font-body-md">{faq.a}</div>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section className="py-[48px] bg-[#0a0e2e] relative overflow-hidden">
          <div className="max-w-[1440px] mx-auto px-[64px] text-center relative z-10">
            <h2 className="font-display-lg text-[64px] mb-8 leading-tight">¿Listo para el siguiente nivel de <span className="text-gradient">crecimiento?</span></h2>
            <p className="text-body-lg text-on-primary-container max-w-2xl mx-auto mb-12">Únase a más de 500 empresas líderes que ya están transformando su comunicación con NEXUS.</p>
            <div className="flex justify-center gap-[24px]">
              <button onClick={openModal} className="action-gradient text-white px-10 py-5 rounded-full font-label-md text-xl glow-shadow hover:scale-105 transition-transform">Agendar Consultoría Gratuita</button>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="bg-[#0b0f10] border-t border-white/5">
        <div className="max-w-[1440px] mx-auto px-[64px] py-[48px] flex flex-col md:flex-row justify-between items-center gap-[24px]">
          <div className="flex flex-col items-center md:items-start gap-4">
            <div className="font-display-sm text-display-sm text-on-surface font-bold">NEXUS</div>
            <p className="text-on-surface-variant text-center md:text-left max-w-xs">Global infrastructure for the next generation of customer communication.</p>
          </div>
          <div className="flex flex-wrap justify-center gap-[48px]">
            <a className="text-on-surface-variant font-body-md text-body-md hover:text-tertiary transition-colors" href="#">Privacy Policy</a>
            <a className="text-on-surface-variant font-body-md text-body-md hover:text-tertiary transition-colors" href="#">Terms of Service</a>
            <a className="text-on-surface-variant font-body-md text-body-md hover:text-tertiary transition-colors" href="#">Compliance</a>
            <a className="text-on-surface-variant font-body-md text-body-md hover:text-tertiary transition-colors" href="#">Security</a>
          </div>
          <div className="text-on-surface-variant font-body-md text-body-md text-center">
            <p className="text-sm font-bold text-white/80">BEST VISION VENEZUELA, C.A.</p>
            <p className="text-xs text-slate-500 mt-1">RIF J-410713348</p>
            <p className="text-xs text-slate-500 mt-1">Av. Libertador, Edif. Centro Parima, Piso 9, Of. 3, Urb. Chacao, Caracas, Miranda, ZP 1060</p>
            <p className="text-xs text-slate-500 mt-2">© 2026 NEXUS Contact Center. Todos los derechos reservados.</p>
          </div>
        </div>
      </footer>

      {/* Modal */}
      <div className="modal-overlay" id="formModal">
        <div className="modal-content bg-[#1d2022] rounded-[32px] w-full max-w-xl p-8 md:p-12 relative shadow-2xl border border-white/10">
          <button onClick={closeModal} className="absolute top-6 right-6 w-10 h-10 bg-white/5 rounded-full flex items-center justify-center text-slate-400 hover:bg-white/10 transition-all">
            <span className="material-symbols-outlined">close</span>
          </button>
          <div className="text-center mb-10 mt-2">
            <div className="w-14 h-14 rounded-2xl action-gradient flex items-center justify-center text-white font-extrabold text-xl mx-auto mb-5 shadow-xl">N</div>
            <h3 className="text-3xl font-bold text-white mb-2">Empieza ahora</h3>
            <p className="text-on-surface-variant text-sm">Completa tus datos y te contactaremos en menos de 24 horas.</p>
          </div>
          <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); closeModal() }}>
            <div className="grid grid-cols-2 gap-4">
              <div><label className="block text-xs font-bold text-on-surface-variant uppercase tracking-widest mb-1.5">Nombre</label>
                <input required className="w-full bg-white/5 border border-white/10 rounded-2xl px-5 py-4 text-sm text-white focus:outline-none focus:border-primary" placeholder="Tu nombre" /></div>
              <div><label className="block text-xs font-bold text-on-surface-variant uppercase tracking-widest mb-1.5">Apellido</label>
                <input required className="w-full bg-white/5 border border-white/10 rounded-2xl px-5 py-4 text-sm text-white focus:outline-none focus:border-primary" placeholder="Tu apellido" /></div>
            </div>
            <div><label className="block text-xs font-bold text-on-surface-variant uppercase tracking-widest mb-1.5">Correo electrónico</label>
              <input type="email" required className="w-full bg-white/5 border border-white/10 rounded-2xl px-5 py-4 text-sm text-white focus:outline-none focus:border-primary" placeholder="tu@correo.com" /></div>
            <div><label className="block text-xs font-bold text-on-surface-variant uppercase tracking-widest mb-1.5">Teléfono</label>
              <input type="tel" required className="w-full bg-white/5 border border-white/10 rounded-2xl px-5 py-4 text-sm text-white focus:outline-none focus:border-primary" placeholder="+58 412 1234567" /></div>
            <div><label className="block text-xs font-bold text-on-surface-variant uppercase tracking-widest mb-1.5">Empresa</label>
              <input className="w-full bg-white/5 border border-white/10 rounded-2xl px-5 py-4 text-sm text-white focus:outline-none focus:border-primary" placeholder="Nombre de tu empresa" /></div>
            <div><label className="block text-xs font-bold text-on-surface-variant uppercase tracking-widest mb-1.5">Mensaje</label>
              <textarea rows={3} className="w-full bg-white/5 border border-white/10 rounded-2xl px-5 py-4 text-sm text-white focus:outline-none focus:border-primary resize-none" placeholder="Cuéntanos sobre tu proyecto..."></textarea></div>
            <button type="submit" className="w-full py-5 action-gradient text-white rounded-2xl font-bold text-base hover:shadow-xl hover:shadow-[#6366F1]/30 transition-all hover:scale-[1.01]">
              Enviar Solicitud
            </button>
          </form>
        </div>
      </div>
    </>
  )
}

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
      <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800&family=Inter:wght@300;400;500;600&display=swap" rel="stylesheet" />
      <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap" rel="stylesheet" />
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css" />
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
                fontFamily: { "display": ["Plus Jakarta Sans", "sans-serif"], "body": ["Inter", "sans-serif"] }
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
        .pill { display: inline-block; padding: 6px 16px; border-radius: 100px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.15em; }
      `}</style>

      {/* Navbar */}
      <nav className="fixed top-0 w-full z-50 bg-surface/10 backdrop-blur-xl border-b border-white/10 shadow-[0_0_20px_rgba(99,102,241,0.15)]">
        <div className="max-w-[1440px] mx-auto px-[64px] flex justify-between items-center h-20">
          <div className="font-display text-[28px] font-bold tracking-tighter text-on-surface">NEXUS</div>
          <div className="hidden lg:flex items-center gap-[48px]">
            <a className="text-primary font-bold border-b-2 border-primary pb-1 text-sm tracking-wider hover:scale-105 transition-all duration-300" href="#servicios">Servicios</a>
            <a className="text-on-surface-variant text-sm tracking-wider hover:scale-105 hover:text-primary transition-all duration-300" href="#proceso">Metodología</a>
            <a className="text-on-surface-variant text-sm tracking-wider hover:scale-105 hover:text-primary transition-all duration-300" href="#precios">Planes</a>
            <a className="text-on-surface-variant text-sm tracking-wider hover:scale-105 hover:text-primary transition-all duration-300" href="#testimonios">Casos de Éxito</a>
            <a className="text-on-surface-variant text-sm tracking-wider hover:scale-105 hover:text-primary transition-all duration-300" href="#faq">FAQ</a>
          </div>
          <div className="flex items-center gap-[24px]">
            <Link href="/login" className="text-on-surface-variant text-sm tracking-wider hover:text-primary transition-all">
              <i className="fas fa-user mr-2"></i>Iniciar Sesión
            </Link>
            <button onClick={openModal} className="hidden md:block action-gradient text-white px-6 py-2.5 rounded-full text-sm tracking-wider font-semibold glow-shadow transition-all hover:scale-105 active:scale-95">
              Agendar Demo
            </button>
            <button className="md:hidden text-on-surface">
              <span className="material-symbols-outlined">menu</span>
            </button>
          </div>
        </div>
      </nav>

      <main className="relative pt-20">
        {/* Hero */}
        <section className="relative min-h-[80vh] flex items-center overflow-hidden">
          <div className="max-w-[1440px] mx-auto px-[64px] grid grid-cols-1 gap-[48px] relative z-10">
            <div className="flex flex-col justify-center space-y-[24px]">
              <div className="inline-flex items-center gap-2 bg-primary-container/30 border border-primary/20 px-4 py-2 rounded-full w-fit animate-float">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
                </span>
                <span className="text-primary text-xs tracking-widest font-semibold">NEXUS BPO</span>
              </div>
              <h1 className="font-display text-[56px] lg:text-[72px] leading-[1.1] font-extrabold tracking-tight">
                Conectamos tu marca<br />
                <span className="text-gradient">con el mundo entero</span>
              </h1>
              <p className="text-[18px] text-on-surface-variant max-w-xl leading-relaxed">
                Gestión profesional de redes sociales, atención omnicanal y cobranza inteligente B2B/B2C.
                <span className="block mt-2 text-primary font-semibold">Un solo aliado estratégico para toda tu operación.</span>
              </p>
              <div className="flex flex-wrap gap-[24px] pt-4">
                <button onClick={openModal} className="action-gradient text-white px-8 py-4 rounded-full font-semibold glow-shadow transition-all transform hover:scale-105 active:scale-95 flex items-center gap-2">
                  <i className="fas fa-play-circle"></i> Agendar Demo Gratis
                </button>
                <a href="#servicios" className="glass-card text-on-surface px-8 py-4 rounded-full font-semibold hover:bg-white/5 transition-all transform hover:scale-105 flex items-center gap-2">
                  <i className="fas fa-arrow-down"></i> Ver Servicios
                </a>
              </div>
            </div>
            <div className="hidden lg:flex items-center justify-center relative">
              <div className="absolute w-64 h-64 bg-primary/20 blur-[100px] rounded-full"></div>
              <div className="absolute w-64 h-64 bg-secondary/20 blur-[100px] rounded-full translate-x-20 translate-y-20"></div>
            </div>
          </div>
        </section>



        {/* Servicios */}
        <section id="servicios" className="py-24 px-[64px] scroll-mt-20">
          <div className="max-w-[1440px] mx-auto">
            <div className="text-center mb-16">
              <span className="pill bg-primary-container/30 border border-primary/20 text-primary mb-6 inline-block">Nuestra Oferta</span>
              <h2 className="font-display text-[40px] font-extrabold text-on-surface mb-4">Soluciones Integrales</h2>
              <p className="text-on-surface-variant max-w-2xl mx-auto">Cubrimos cada punto de contacto con tus clientes para que tú te enfoques en crecer.</p>
            </div>
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
              {[
                { icon: "fa-comments", title: "Atención Omnicanal", desc: "WhatsApp, Instagram, Facebook, TikTok, Messenger, chat web y email en una sola plataforma unificada.", items: ["Respuestas en < 10 min", "Historial unificado por cliente", "Integración CRM"] },
                { icon: "fa-hashtag", title: "Gestión de Redes Sociales", desc: "Community management, moderación de comentarios, atención de DMs y generación de contenido.", items: ["Moderación 24/7", "Reportes semanales de interacción", "Detección de crisis"] },
                { icon: "fa-hand-holding-usd", title: "Gestión de Cobranza", desc: "Recuperación de cartera B2B y B2C con estrategia progresiva y reportes en tiempo real.", items: ["Preventiva a Judicial", "Comisiones desde 1%", "Reportes diarios de gestión"] },
                { icon: "fa-headset", title: "Soporte Técnico N1-N2", desc: "Mesa de ayuda para tus clientes con escalamiento inteligente y resolución en primer contacto.", items: ["FCR > 80%", "Base de conocimiento dinámica", "Escalamiento automatizado"] },
                { icon: "fa-chart-line", title: "Telemarketing & Ventas", desc: "Generación de leads, calificación y cierre con scripts optimizados y seguimiento CRM.", items: ["Lead scoring automatizado", "Grabación y monitoreo", "Reportes de conversión"] },
                { icon: "fa-robot", title: "Automatización con IA", desc: "Chatbots inteligentes, asistentes virtuales y automatización de respuestas frecuentes.", items: ["Chatbot 24/7 multicanal", "IA entrenada con tus datos", "Derivación a humano"] },
              ].map((s, i) => (
                <div key={i} className="glass-card rounded-3xl p-8 group hover:border-primary/40 transition-all duration-500">
                  <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center text-primary text-2xl mb-6 group-hover:scale-110 transition-transform">
                    <i className={`fas ${s.icon}`}></i>
                  </div>
                  <h3 className="text-2xl font-bold font-display text-on-surface mb-3">{s.title}</h3>
                  <p className="text-on-surface-variant text-sm leading-relaxed mb-6">{s.desc}</p>
                  <ul className="space-y-3 text-sm text-on-surface-variant">
                    {s.items.map((item, j) => (
                      <li key={j} className="flex items-start gap-3">
                        <span className="material-symbols-outlined text-primary text-sm mt-0.5">check_circle</span>
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Metodología */}
        <section id="proceso" className="py-24 px-[64px] bg-surface-container-lowest scroll-mt-20">
          <div className="max-w-[1440px] mx-auto">
            <div className="text-center mb-16">
              <span className="pill bg-primary-container/30 border border-primary/20 text-primary mb-6 inline-block">Metodología</span>
              <h2 className="font-display text-[40px] font-extrabold text-on-surface mb-4">¿Cómo trabajamos?</h2>
              <p className="text-on-surface-variant max-w-2xl mx-auto">Un proceso probado que garantiza resultados desde el día uno.</p>
            </div>
            <div className="grid md:grid-cols-4 gap-8 relative">
              <div className="hidden md:block absolute top-24 left-[12%] right-[12%] h-0.5 bg-gradient-to-r from-[#6366F1] via-[#EC4899] to-[#C1C4ED]"></div>
              {[
                { num: "01", title: "Diagnóstico", desc: "Analizamos tus canales actuales, volumen de interacciones y puntos de mejora." },
                { num: "02", title: "Estrategia", desc: "Diseñamos el flujo de atención, tono de voz y SLA personalizados para tu marca." },
                { num: "03", title: "Implementación", desc: "Activamos canales, entrenamos al equipo y comenzamos la operación en 48 horas." },
                { num: "04", title: "Optimización", desc: "Reportes semanales, ajustes continuos y mejora basada en datos reales." },
              ].map((p, i) => (
                <div key={i} className="text-center relative">
                  <div className="w-16 h-16 action-gradient text-white rounded-2xl flex items-center justify-center text-2xl font-extrabold font-display mx-auto mb-6 relative z-10 shadow-xl">{p.num}</div>
                  <h4 className="font-bold text-lg text-on-surface mb-2">{p.title}</h4>
                  <p className="text-sm text-on-surface-variant">{p.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Planes */}
        <section id="precios" className="py-24 px-[64px] scroll-mt-20 relative overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(99,102,241,0.05)_0%,transparent_50%)]"></div>
          <div className="max-w-[1440px] mx-auto relative z-10">
            <div className="text-center mb-16">
              <span className="pill bg-primary-container/30 border border-primary/20 text-primary mb-6 inline-block">Inversión</span>
              <h2 className="font-display text-[40px] font-extrabold text-on-surface mb-4">Planes Transparentes</h2>
              <p className="text-on-surface-variant max-w-2xl mx-auto">Sin letra pequeña. Eliges el plan que necesitas y lo ajustamos a tu volumen.</p>
            </div>
            <div className="grid lg:grid-cols-3 gap-8 items-stretch">
              {/* Social Media */}
              <div className="glass-card rounded-[32px] p-8 md:p-10 flex flex-col h-full hover:bg-white/[0.04] transition-all">
                <div className="mb-8">
                  <span className="pill bg-primary/10 text-primary border border-primary/30">Gestión de Redes</span>
                  <h3 className="font-display font-bold text-2xl mt-5 text-on-surface">Social Media</h3>
                  <p className="text-sm text-on-surface-variant mt-2">Gestión completa de interacciones digitales</p>
                </div>
                <div className="bg-white/5 p-4 rounded-2xl border border-white/10 mb-6">
                  <label className="block text-[10px] font-bold text-on-surface-variant uppercase tracking-widest mb-2">Cobertura horaria</label>
                  <select id="socialSelect" onChange={(e) => {
                    const p = document.getElementById("socialPrice")
                    if (p) p.textContent = "$" + e.target.value
                  }} className="w-full bg-transparent font-bold text-on-surface focus:outline-none cursor-pointer text-base">
                    <option value="150">L-V (8am–5pm) — $150/mes</option>
                    <option value="200" selected>Inc. fines de semana — $200/mes</option>
                    <option value="270">12h L-V + fines de semana — $270/mes</option>
                    <option value="350">Soporte global 24/7 — $350/mes</option>
                  </select>
                </div>
                <div className="flex items-baseline gap-1.5 mb-8">
                  <span className="text-5xl font-extrabold text-on-surface tracking-tighter" id="socialPrice">$200</span>
                  <span className="text-on-surface-variant">/mes</span>
                </div>
                <ul className="space-y-4 mb-10 flex-grow">
                  {["Atención de DMs y comentarios", "Resolución de dudas frecuentes", "Reporte semanal de interacciones", "Moderación de comunidad"].map((item, i) => (
                    <li key={i} className="flex items-start gap-3 text-on-surface-variant">
                      <span className="material-symbols-outlined text-primary text-sm mt-0.5">check_circle</span>
                      <span className="text-sm">{item}</span>
                    </li>
                  ))}
                </ul>
                <button onClick={openModal} className="w-full py-4 rounded-xl border border-white/20 hover:bg-white/5 font-semibold transition-all text-on-surface">Elegir Plan</button>
              </div>

              {/* Cobranza (destacado) */}
              <div className="glass-card rounded-[32px] p-8 md:p-10 flex flex-col h-full border-primary/40 relative transform md:scale-105 shadow-[0_0_50px_rgba(99,102,241,0.1)] bg-white/[0.05]">
                <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-primary px-4 py-1 rounded-full text-on-primary text-xs font-bold tracking-widest">MÁS SOLICITADO</div>
                <div className="mb-8">
                  <span className="pill bg-[#EC4899]/20 text-[#FFB0CD] border border-[#EC4899]/30">Recuperación B2B / B2C</span>
                  <h3 className="font-display font-bold text-2xl mt-5 text-on-surface">Gestión de Cobranza</h3>
                  <p className="text-sm text-on-surface-variant mt-2">Solo pagas por resultados recuperados</p>
                </div>
                <div className="space-y-2.5 mb-10 flex-grow">
                  <p className="text-xs text-on-surface-variant uppercase font-bold tracking-widest mb-4">Comisiones por tramo de mora:</p>
                  {[["Preventiva", "1%"], ["0 a 30 días", "2%"], ["31 a 60 días", "4%"], ["61 a 90 días", "6%"], ["91 a 120 días", "8%"], ["+121 días", "20%"]].map(([label, pct], i) => (
                    <div key={i} className="flex justify-between items-center bg-white/5 p-3 rounded-2xl border border-white/10">
                      <span className="text-on-surface-variant">{label}</span>
                      <span className="font-extrabold text-[#FFB0CD]">{pct}</span>
                    </div>
                  ))}
                </div>
                <button onClick={openModal} className="w-full py-4 rounded-xl action-gradient text-white font-semibold transition-all glow-shadow">Solicitar Gestión</button>
              </div>

              {/* Enterprise */}
              <div className="glass-card rounded-[32px] p-8 md:p-10 flex flex-col h-full hover:bg-white/[0.04] transition-all">
                <div className="mb-8 text-center">
                  <span className="pill bg-white/5 text-on-surface-variant border border-white/10">Corporativo</span>
                  <h3 className="font-display font-bold text-2xl mt-5 text-on-surface">Enterprise</h3>
                  <p className="text-sm text-on-surface-variant mt-2">Para empresas con alto volumen</p>
                </div>
                <div className="mb-8">
                  <div className="w-full h-44 rounded-3xl bg-white/5 flex items-center justify-center">
                    <i className="fas fa-building text-5xl text-on-surface-variant/30"></i>
                  </div>
                </div>
                <div className="text-center mb-10">
                  <p className="font-display font-bold text-2xl text-on-surface">A tu medida</p>
                  <p className="text-sm text-on-surface-variant mt-3 leading-relaxed">Infraestructura dedicada, reportes en tiempo real, SLA personalizado y soporte 24/7.</p>
                </div>
                <ul className="space-y-4 mb-10 flex-grow">
                  {["Agentes dedicados", "Paneles de control en vivo", "Integración API con tu CRM", "Gestor de cuenta asignado"].map((item, i) => (
                    <li key={i} className="flex items-start gap-3 text-on-surface-variant">
                      <span className="material-symbols-outlined text-secondary text-sm mt-0.5">check_circle</span>
                      <span className="text-sm">{item}</span>
                    </li>
                  ))}
                </ul>
                <a href="https://wa.me/584222433946" target="_blank" rel="noopener" className="block w-full py-4 rounded-xl border border-white/20 hover:bg-white/5 font-semibold transition-all text-center text-on-surface">Consultar</a>
              </div>
            </div>
          </div>
        </section>

        {/* Casos de Éxito */}
        <section id="testimonios" className="py-24 px-[64px] bg-surface-container-lowest scroll-mt-20">
          <div className="max-w-[1440px] mx-auto">
            <div className="text-center mb-16">
              <span className="pill bg-primary-container/30 border border-primary/20 text-primary mb-6 inline-block">Casos de Éxito</span>
              <h2 className="font-display text-[40px] font-extrabold text-on-surface mb-4">Lo que dicen nuestros clientes</h2>
              <p className="text-on-surface-variant max-w-2xl mx-auto">Empresas que confían en NEXUS para su operación de contact center.</p>
            </div>
            <div className="grid md:grid-cols-3 gap-8">
              {[
                { initials: "MG", name: "María González", role: "Directora de Marketing · ModaVE", text: "Desde que trabajamos con NEXUS, nuestro tiempo de respuesta bajó de 45 minutos a 3 minutos. El ROI fue inmediato." },
                { initials: "CR", name: "Carlos Rodríguez", role: "CFO · Financiera Plus", text: "Recuperamos el 40% de nuestra cartera morosa en los primeros 3 meses. El equipo de cobranza de NEXUS es implacable." },
                { initials: "AL", name: "Ana Lucía Pérez", role: "CEO · EcommerceBox", text: "Externalizamos todo nuestro customer service con NEXUS. La calidad supera nuestras expectativas." },
              ].map((t, i) => (
                <div key={i} className="glass-card rounded-3xl p-8 border border-white/5 hover:border-primary/30 transition-all duration-500">
                  <div className="flex text-[#F59E0B] mb-4">{Array(5).fill(0).map((_, j) => <i key={j} className="fas fa-star"></i>)}</div>
                  <p className="text-on-surface-variant text-sm leading-relaxed mb-6 italic">&ldquo;{t.text}&rdquo;</p>
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center text-primary font-bold">{t.initials}</div>
                    <div>
                      <div className="font-bold text-sm text-on-surface">{t.name}</div>
                      <div className="text-xs text-on-surface-variant">{t.role}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className="py-24 px-[64px] scroll-mt-20">
          <div className="max-w-4xl mx-auto">
            <div className="text-center mb-16">
              <span className="pill bg-primary-container/30 border border-primary/20 text-primary mb-6 inline-block">FAQ</span>
              <h2 className="font-display text-[40px] font-extrabold text-on-surface mb-4">Preguntas Frecuentes</h2>
            </div>
            <div className="space-y-4">
              {[
                { q: "¿Cómo funciona la prueba gratuita de 10 días?", a: "Te activamos el servicio sin costo durante 10 días para que evalúes la calidad, los tiempos de respuesta y la plataforma. Al término, si deseas continuar, elegimos el plan que mejor se adapte a tu volumen." },
                { q: "¿Qué canales puedo integrar?", a: "WhatsApp (API oficial), Instagram, Facebook Messenger, TikTok, Telegram, chat web, email y telefonía IP. Todos unificados en un solo panel de control." },
                { q: "¿Tienen agentes bilingües?", a: "Sí. Contamos con agentes completamente bilingües (español/inglés) para atender mercados internacionales. También podemos cubrir portugués bajo demanda." },
                { q: "¿Cómo se factura la gestión de cobranza?", a: "Solo pagas comisión sobre lo efectivamente recuperado. No hay costos fijos ni mensualidades. Las comisiones varían según el tramo de mora, desde 1% (preventiva) hasta 20% (+121 días)." },
                { q: "¿Qué tipo de reportes recibo?", a: "Reportes semanales y mensuales con KPIs clave: tiempo promedio de respuesta, satisfacción (CSAT), volumen de interacciones, tasa de resolución, recuperación de cartera y más. Todo vía dashboard web." },
              ].map((faq, i) => (
                <details key={i} className="glass-card rounded-xl overflow-hidden border border-white/5 hover:border-primary/30 transition-all group">
                  <summary className="w-full p-6 flex items-center justify-between text-left cursor-pointer list-none">
                    <span className="text-lg font-semibold text-on-surface">{faq.q}</span>
                    <span className="material-symbols-outlined text-primary transition-transform group-open:rotate-180">expand_more</span>
                  </summary>
                  <div className="px-6 pb-6 text-on-surface-variant">{faq.a}</div>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* CTA Final */}
        <section className="py-24 px-[64px] bg-primary-container relative overflow-hidden">
          <div className="max-w-5xl mx-auto text-center relative z-10">
            <h2 className="font-display text-[48px] font-extrabold mb-6 leading-tight">¿Listo para transformar<br />tu operación?</h2>
            <p className="text-on-primary-container text-lg max-w-xl mx-auto mb-10">Agenda una demo sin compromiso y descubre cómo NEXUS puede potenciar tu contacto con clientes.</p>
            <div className="flex flex-col sm:flex-row justify-center gap-4">
              <button onClick={openModal} className="action-gradient text-white px-10 py-5 rounded-full font-bold text-lg glow-shadow hover:scale-105 transition-transform flex items-center justify-center gap-2">
                <i className="fas fa-calendar-check"></i> Agendar Demo Gratis
              </button>
              <a href="https://wa.me/584222433946" target="_blank" rel="noopener" className="glass-card text-on-surface px-10 py-5 rounded-full font-bold text-lg hover:bg-white/5 transition-all flex items-center justify-center gap-2">
                <i className="fab fa-whatsapp"></i> Hablar por WhatsApp
              </a>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="bg-surface-container-lowest border-t border-white/5">
        <div className="max-w-[1440px] mx-auto px-[64px] py-[48px] flex flex-col md:flex-row justify-between items-center gap-[24px]">
          <div className="flex flex-col items-center md:items-start gap-4">
            <div className="text-[28px] font-bold font-display text-on-surface">NEXUS</div>
            <p className="text-on-surface-variant text-center md:text-left max-w-xs text-sm">Talento, tecnología y compromiso para llevar tu experiencia de cliente al siguiente nivel.</p>
          </div>
          <div className="flex flex-wrap justify-center gap-[48px]">
            {["Servicios", "Sobre Nosotros", "Blog", "Contacto"].map((item, i) => (
              <a key={i} className="text-on-surface-variant text-sm hover:text-primary transition-colors" href="#">{item}</a>
            ))}
          </div>
          <div className="text-on-surface-variant text-sm text-center">
            <p className="font-bold text-white/80">REPRESENTACIONES J.J.D.C, CA</p>
            <p className="text-xs text-slate-500 mt-1">RIF J408094193</p>
            <p className="text-xs text-slate-500 mt-1">CTRA VIEJA DE LOS TEQUES CASA NRO 4 BARRIO MAMERA CARACAS DISTRITO CAPITAL ZONA POSTAL 1000</p>
            <p className="text-xs text-slate-500 mt-1">Teléfono: 0422 2433946 · contacto@nexusbpo.space</p>
            <p className="text-xs text-slate-500 mt-2">© 2026 NEXUS Contact Center. Todos los derechos reservados.</p>
          </div>
        </div>
      </footer>

      {/* Modal */}
      <div className="modal-overlay" id="formModal">
        <div className="modal-content bg-surface-container rounded-[32px] w-full max-w-xl p-8 md:p-12 relative shadow-2xl border border-white/10">
          <button onClick={closeModal} className="absolute top-6 right-6 w-10 h-10 bg-white/5 rounded-full flex items-center justify-center text-on-surface-variant hover:bg-white/10 transition-all">
            <span className="material-symbols-outlined">close</span>
          </button>
          <div className="text-center mb-10 mt-2">
            <div className="w-14 h-14 rounded-2xl action-gradient flex items-center justify-center text-white font-extrabold text-xl mx-auto mb-5 shadow-xl">N</div>
            <h3 className="text-3xl font-bold text-on-surface mb-2">Empieza ahora</h3>
            <p className="text-on-surface-variant text-sm">Completa tus datos y te contactaremos en menos de 24 horas.</p>
          </div>
          <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); closeModal() }}>
            <div className="grid grid-cols-2 gap-4">
              <div><label className="block text-xs font-bold text-on-surface-variant uppercase tracking-widest mb-1.5">Nombre</label>
                <input required className="w-full bg-white/5 border border-white/10 rounded-2xl px-5 py-4 text-sm text-on-surface focus:outline-none focus:border-primary" placeholder="Tu nombre" /></div>
              <div><label className="block text-xs font-bold text-on-surface-variant uppercase tracking-widest mb-1.5">Apellido</label>
                <input required className="w-full bg-white/5 border border-white/10 rounded-2xl px-5 py-4 text-sm text-on-surface focus:outline-none focus:border-primary" placeholder="Tu apellido" /></div>
            </div>
            <div><label className="block text-xs font-bold text-on-surface-variant uppercase tracking-widest mb-1.5">Correo electrónico</label>
              <input type="email" required className="w-full bg-white/5 border border-white/10 rounded-2xl px-5 py-4 text-sm text-on-surface focus:outline-none focus:border-primary" placeholder="tu@correo.com" /></div>
            <div><label className="block text-xs font-bold text-on-surface-variant uppercase tracking-widest mb-1.5">Teléfono</label>
              <input type="tel" required className="w-full bg-white/5 border border-white/10 rounded-2xl px-5 py-4 text-sm text-on-surface focus:outline-none focus:border-primary" placeholder="+58 412 1234567" /></div>
            <div><label className="block text-xs font-bold text-on-surface-variant uppercase tracking-widest mb-1.5">Empresa</label>
              <input className="w-full bg-white/5 border border-white/10 rounded-2xl px-5 py-4 text-sm text-on-surface focus:outline-none focus:border-primary" placeholder="Nombre de tu empresa" /></div>
            <div><label className="block text-xs font-bold text-on-surface-variant uppercase tracking-widest mb-1.5">Mensaje</label>
              <textarea rows={3} className="w-full bg-white/5 border border-white/10 rounded-2xl px-5 py-4 text-sm text-on-surface focus:outline-none focus:border-primary resize-none" placeholder="Cuéntanos sobre tu proyecto..."></textarea></div>
            <button type="submit" className="w-full py-5 action-gradient text-white rounded-2xl font-bold text-base glow-shadow hover:scale-[1.01] transition-all">Enviar Solicitud</button>
          </form>
        </div>
      </div>
    </>
  )
}

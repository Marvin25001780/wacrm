"use client"

import { useEffect } from "react"
import Script from "next/script"
import Link from "next/link"

export default function LandingPage() {
  useEffect(() => {
    // Initialize AOS
    if (typeof window !== "undefined" && (window as any).AOS) {
      ;(window as any).AOS.init({ duration: 800, once: true })
    }

    // Counter animation
    const counters = document.querySelectorAll(".counter")
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const el = entry.target as HTMLElement
            const target = Number(el.getAttribute("data-target")) || 0
            let current = 0
            const increment = Math.ceil(target / 60)
            const timer = setInterval(() => {
              current += increment
              if (current >= target) { current = target; clearInterval(timer) }
              el.textContent = current.toLocaleString()
            }, 25)
            observer.unobserve(el)
          }
        })
      },
      { threshold: 0.5 }
    )
    counters.forEach((c) => observer.observe(c))
    return () => observer.disconnect()
  }, [])

  const openModal = () => document.getElementById("formModal")?.classList.add("active")
  const closeModal = () => document.getElementById("formModal")?.classList.remove("active")
  const closeMobile = () => document.getElementById("mobileMenu")?.classList.add("hidden")

  return (
    <>
      <Script src="https://cdn.tailwindcss.com" strategy="beforeInteractive" />
      <Script src="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/js/all.min.js" strategy="lazyOnload" />
      <Script src="https://unpkg.com/aos@2.3.1/dist/aos.js" strategy="lazyOnload" />
      <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet" />

      <style>{`
        :root { scroll-behavior: smooth; }
        body { background: #F8FAFC; color: #1E293B; font-family: 'Inter', sans-serif; overflow-x: hidden; }
        ::selection { background: #1A237E; color: white; }
        .glass { background: rgba(255,255,255,0.85); backdrop-filter: blur(20px); border-bottom: 1px solid rgba(0,0,0,0.06); }
        .gradient-text {
          background: linear-gradient(135deg, #1A237E 0%, #6A1B9A 35%, #D81B60 65%, #00ACC1 100%);
          -webkit-background-clip: text; -webkit-text-fill-color: transparent;
          background-size: 200% auto; animation: shimmer 4s linear infinite;
        }
        @keyframes shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
        .gradient-bg { background: linear-gradient(135deg, #1A237E, #6A1B9A, #D81B60); background-size: 200% 200%; animation: shimmer 4s linear infinite; }
        .hero-radial { background: radial-gradient(ellipse at 50% 0%, rgba(26,35,126,0.08) 0%, transparent 70%), radial-gradient(ellipse at 80% 80%, rgba(216,27,96,0.05) 0%, transparent 50%); }
        .card-hover { transition: all 0.5s cubic-bezier(0.4, 0, 0.2, 1); border: 1px solid rgba(0,0,0,0.04); }
        .card-hover:hover { transform: translateY(-12px); box-shadow: 0 40px 80px -20px rgba(26,35,126,0.15); border-color: rgba(26,35,126,0.1); }
        .btn-primary { background: #1A237E; color: white; border-radius: 100px; padding: 18px 40px; font-weight: 700; transition: all 0.3s; font-family: 'Plus Jakarta Sans', sans-serif; }
        .btn-primary:hover { background: #6A1B9A; transform: scale(1.03); box-shadow: 0 20px 60px -10px rgba(26,35,126,0.4); }
        .btn-outline { background: transparent; color: #1A237E; border: 2px solid #1A237E; border-radius: 100px; padding: 16px 38px; font-weight: 700; transition: all 0.3s; font-family: 'Plus Jakarta Sans', sans-serif; }
        .btn-outline:hover { background: #1A237E; color: white; }
        .btn-login { background: transparent; color: white; border: 2px solid white; border-radius: 100px; padding: 8px 20px; font-weight: 700; font-size: 13px; transition: all 0.3s; font-family: 'Plus Jakarta Sans', sans-serif; }
        .btn-login:hover { background: white; color: #1A237E; }
        .price-card { transition: all 0.5s cubic-bezier(0.4, 0, 0.2, 1); }
        .price-card.featured { transform: scale(1.02); box-shadow: 0 40px 80px -20px rgba(26,35,126,0.25); }
        .price-card:hover { transform: translateY(-8px); }
        .price-card.featured:hover { transform: scale(1.02) translateY(-8px); }
        .modal-overlay { display: none; position: fixed; inset: 0; z-index: 100; background: rgba(15,23,42,0.7); backdrop-filter: blur(12px); align-items: center; justify-content: center; padding: 24px; }
        .modal-overlay.active { display: flex; }
        .modal-content { animation: slideUp 0.4s ease-out; }
        @keyframes slideUp { 0% { opacity: 0; transform: translateY(30px); } 100% { opacity: 1; transform: translateY(0); } }
        .whatsapp-float { position: fixed; bottom: 28px; right: 28px; z-index: 50; width: 64px; height: 64px; background: #25D366; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: white; font-size: 30px; box-shadow: 0 8px 30px rgba(37,211,102,0.4); transition: all 0.3s; }
        .whatsapp-float:hover { transform: scale(1.1); box-shadow: 0 12px 40px rgba(37,211,102,0.5); color: white; }
        .stat-item { position: relative; }
        .stat-item:not(:last-child)::after { content: ''; position: absolute; right: 0; top: 50%; transform: translateY(-50%); height: 50%; width: 1px; background: rgba(255,255,255,0.15); }
        @media (max-width: 768px) { .stat-item:not(:last-child)::after { display: none; } }
        .testimonial-card { transition: all 0.4s; }
        .testimonial-card:hover { transform: translateY(-8px); }
        .pill { display: inline-block; padding: 6px 16px; border-radius: 100px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.15em; }
        .faq-item summary::-webkit-details-marker { display: none; }
        .faq-item summary { cursor: pointer; user-select: none; }
        .toast { visibility: hidden; min-width: 320px; background: #1A237E; color: white; text-align: center; border-radius: 20px; padding: 20px 28px; position: fixed; z-index: 200; left: 50%; bottom: 40px; transform: translateX(-50%); box-shadow: 0 30px 60px rgba(0,0,0,0.3); font-weight: 600; }
        .toast.show { visibility: visible; animation: slideUp 0.4s ease, fadeOut 0.4s ease 3s forwards; }
        @keyframes fadeOut { to { opacity: 0; transform: translateX(-50%) translateY(20px); } }
      `}</style>

      {/* WhatsApp Float */}
      <a href="https://wa.me/5842422433946?text=Hola%20NEXUS%2C%20quiero%20informaci%C3%B3n%20sobre%20sus%20servicios"
         target="_blank" rel="noopener" className="whatsapp-float" aria-label="Chatea por WhatsApp">
        <i className="fab fa-whatsapp"></i>
      </a>

      {/* Navbar */}
      <nav className="glass sticky top-0 z-50 py-3 lg:py-4">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between">
          <a href="#" className="flex items-center gap-3 group">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#1A237E] to-[#6A1B9A] flex items-center justify-center text-white font-extrabold text-lg font-jakarta shadow-lg group-hover:shadow-xl transition-all">N</div>
            <div className="flex flex-col">
              <span className="font-jakarta font-extrabold text-xl tracking-tighter text-[#1A237E] leading-none">NEXUS</span>
              <span className="text-[7px] font-bold text-slate-400 uppercase tracking-[0.25em] mt-0.5">Contact Center</span>
            </div>
          </a>

          <div className="hidden lg:flex items-center gap-8">
            <a href="#servicios" className="text-sm font-semibold text-slate-500 hover:text-[#1A237E] transition-colors">Servicios</a>
            <a href="#proceso" className="text-sm font-semibold text-slate-500 hover:text-[#1A237E] transition-colors">Metodología</a>
            <a href="#precios" className="text-sm font-semibold text-slate-500 hover:text-[#1A237E] transition-colors">Planes</a>
            <a href="#testimonios" className="text-sm font-semibold text-slate-500 hover:text-[#1A237E] transition-colors">Casos de Éxito</a>
            <a href="#faq" className="text-sm font-semibold text-slate-500 hover:text-[#1A237E] transition-colors">FAQ</a>
            <Link href="/login" className="btn-login">
              <i className="fas fa-user mr-2"></i>Iniciar Sesión
            </Link>
            <button onClick={openModal} className="btn-primary text-sm py-3 px-7 shadow-xl shadow-[#1A237E]/20">
              <i className="fas fa-calendar-check mr-2"></i>Agendar Demo
            </button>
          </div>

          <div className="flex items-center gap-3 lg:hidden">
            <Link href="/login" className="btn-login text-xs px-3 py-2">
              <i className="fas fa-user mr-1"></i>Ingresar
            </Link>
            <button className="p-2 text-slate-600" onClick={() => document.getElementById('mobileMenu')?.classList.toggle('hidden')} aria-label="Abrir menú">
              <i className="fas fa-bars text-2xl"></i>
            </button>
          </div>
        </div>

        <div id="mobileMenu" className="hidden lg:hidden bg-white border-t border-slate-100 px-4 py-6 space-y-4">
          <a href="#servicios" onClick={closeMobile} className="block font-semibold text-slate-600 py-2">Servicios</a>
          <a href="#proceso" onClick={closeMobile} className="block font-semibold text-slate-600 py-2">Metodología</a>
          <a href="#precios" onClick={closeMobile} className="block font-semibold text-slate-600 py-2">Planes</a>
          <a href="#testimonios" onClick={closeMobile} className="block font-semibold text-slate-600 py-2">Casos de Éxito</a>
          <a href="#faq" onClick={closeMobile} className="block font-semibold text-slate-600 py-2">FAQ</a>
          <Link href="/login" onClick={closeMobile} className="block w-full text-center py-3 bg-[#1A237E] text-white rounded-full font-bold hover:bg-[#6A1B9A] transition-all">
            <i className="fas fa-user mr-2"></i>Iniciar Sesión
          </Link>
          <button onClick={() => { openModal(); closeMobile(); }} className="w-full py-3 border-2 border-[#1A237E] text-[#1A237E] rounded-full font-bold hover:bg-[#1A237E] hover:text-white transition-all">Agendar Demo</button>
        </div>
      </nav>

      {/* Announcement Bar */}
      <div className="gradient-bg py-2.5 px-4 text-center text-white text-sm font-jakarta font-bold">
        <i className="fas fa-rocket mr-2"></i> Prueba gratis de 10 días — descubre el poder de NEXUS sin compromiso.
        <button onClick={openModal} className="ml-3 underline underline-offset-4 hover:text-white/80 transition-colors font-extrabold">Reclamar →</button>
      </div>

      {/* Hero */}
      <header className="relative pt-16 pb-24 md:pt-28 md:pb-36 px-4 hero-radial overflow-hidden">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-20 left-10 w-72 h-72 bg-[#1A237E]/5 rounded-full blur-3xl"></div>
          <div className="absolute bottom-10 right-10 w-96 h-96 bg-[#D81B60]/5 rounded-full blur-3xl"></div>
        </div>
        <div className="max-w-7xl mx-auto text-center relative">
          <div className="flex flex-wrap items-center justify-center gap-3 mb-8" data-aos="fade-down" data-aos-delay="100">
            <span className="pill bg-[#EEF2FF] text-[#1A237E] border border-[#C7D2FE]">
              <i className="fas fa-headset mr-1.5"></i> Contact Center & Social Media
            </span>
            <span className="pill bg-white/90 text-[#1A237E] border border-[#C7D2FE] shadow-lg">
              <i className="fas fa-building mr-1.5"></i> BEST VISION VENEZUELA, C.A.
            </span>
          </div>
          <h1 className="text-5xl sm:text-6xl md:text-7xl lg:text-8xl font-jakarta font-extrabold mb-6 tracking-tight leading-[1.05]" data-aos="fade-up" data-aos-delay="200">
            Conectamos tu marca<br />
            <span className="gradient-text">con el mundo entero</span>
          </h1>
          <p className="text-lg md:text-xl lg:text-2xl text-slate-500 max-w-4xl mx-auto mb-12 leading-relaxed font-light px-4" data-aos="fade-up" data-aos-delay="300">
            Gestión profesional de redes sociales, atención omnicanal y cobranza inteligente B2B/B2C.
            <span className="block mt-2 font-medium text-[#1A237E]">Un solo aliado estratégico para toda tu operación.</span>
          </p>
          <div className="flex flex-col sm:flex-row justify-center gap-4 sm:gap-6" data-aos="fade-up" data-aos-delay="400">
            <button onClick={openModal} className="btn-primary text-lg shadow-2xl shadow-[#1A237E]/25 flex items-center justify-center gap-2">
              <i className="fas fa-play-circle"></i> Agendar Demo Gratis
            </button>
            <a href="#servicios" className="btn-outline text-lg flex items-center justify-center gap-2">
              <i className="fas fa-arrow-down"></i> Ver Servicios
            </a>
          </div>
          <div className="mt-12 flex items-center justify-center gap-2 text-sm text-slate-400" data-aos="fade-up" data-aos-delay="500">
            <i className="fas fa-shield-alt text-green-400"></i>
            <span>Sin compromiso · Cancelación en cualquier momento</span>
          </div>
        </div>
      </header>

      {/* Stats Banner */}
      <section className="relative -mt-16 z-10 max-w-6xl mx-auto px-4" data-aos="fade-up">
        <div className="bg-gradient-to-r from-[#1A237E] via-[#6A1B9A] to-[#D81B60] rounded-3xl shadow-2xl shadow-[#1A237E]/20 p-8 md:p-12">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 md:gap-0 text-center text-white">
            <div className="stat-item">
              <div className="text-3xl md:text-4xl font-extrabold font-jakarta"><span className="counter" data-target="150">0</span>+</div>
              <div className="text-xs text-white/70 mt-1 font-semibold uppercase tracking-wider">Clientes Activos</div>
            </div>
            <div className="stat-item">
              <div className="text-3xl md:text-4xl font-extrabold font-jakarta"><span className="counter" data-target="50">0</span>K+</div>
              <div className="text-xs text-white/70 mt-1 font-semibold uppercase tracking-wider">Interacciones/mes</div>
            </div>
            <div className="stat-item">
              <div className="text-3xl md:text-4xl font-extrabold font-jakarta"><span className="counter" data-target="98">0</span>%</div>
              <div className="text-xs text-white/70 mt-1 font-semibold uppercase tracking-wider">Satisfacción</div>
            </div>
            <div className="stat-item">
              <div className="text-3xl md:text-4xl font-extrabold font-jakarta"><span className="counter" data-target="3">0</span>min</div>
              <div className="text-xs text-white/70 mt-1 font-semibold uppercase tracking-wider">Tiempo de respuesta</div>
            </div>
          </div>
        </div>
      </section>

      {/* Servicios */}
      <section id="servicios" className="pt-36 pb-24 px-4 scroll-mt-20">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16" data-aos="fade-up">
            <span className="pill bg-[#EEF2FF] text-[#1A237E] border border-[#C7D2FE] mb-6 inline-block">Nuestra Oferta</span>
            <h2 className="text-4xl md:text-5xl font-jakarta font-extrabold text-slate-900 mb-4">Soluciones Integrales</h2>
            <p className="text-lg text-slate-500 max-w-2xl mx-auto">Cubrimos cada punto de contacto con tus clientes para que tú te enfoques en crecer.</p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {[
              { icon: "fa-comments", color: "bg-[#EEF2FF] text-[#1A237E]", title: "Atención Omnicanal", desc: "WhatsApp, Instagram, Facebook, TikTok, Messenger, chat web y email en una sola plataforma unificada.",
                items: ["Respuestas en < 10 min", "Historial unificado por cliente", "Integración CRM"] },
              { icon: "fa-hashtag", color: "bg-pink-50 text-[#D81B60]", title: "Gestión de Redes Sociales", desc: "Community management, moderación de comentarios, atención de DMs y generación de contenido.",
                items: ["Moderación 24/7", "Reportes semanales de interacción", "Detección de crisis"] },
              { icon: "fa-hand-holding-usd", color: "bg-green-50 text-green-600", title: "Gestión de Cobranza", desc: "Recuperación de cartera B2B y B2C con estrategia progresiva y reportes en tiempo real.",
                items: ["Preventiva a Judicial", "Comisiones desde 1%", "Reportes diarios de gestión"] },
              { icon: "fa-headset", color: "bg-cyan-50 text-[#00ACC1]", title: "Soporte Técnico N1-N2", desc: "Mesa de ayuda para tus clientes con escalamiento inteligente y resolución en primer contacto.",
                items: ["FCR (First Contact Resolution) > 80%", "Base de conocimiento dinámica", "Escalamiento automatizado"] },
              { icon: "fa-chart-line", color: "bg-amber-50 text-[#F59E0B]", title: "Telemarketing & Ventas", desc: "Generación de leads, calificación y cierre con scripts optimizados y seguimiento CRM.",
                items: ["Lead scoring automatizado", "Grabación y monitoreo de llamadas", "Reportes de conversión"] },
              { icon: "fa-robot", color: "bg-purple-50 text-[#6A1B9A]", title: "Automatización con IA", desc: "Chatbots inteligentes, asistentes virtuales y automatización de respuestas frecuentes.",
                items: ["Chatbot 24/7 multicanal", "IA entrenada con tu base de datos", "Derivación a humano en vivo"] }
            ].map((s, i) => (
              <div key={i} className="bg-white rounded-3xl p-8 card-hover" data-aos="fade-up" data-aos-delay={100 + i * 100}>
                <div className={`w-14 h-14 ${s.color} rounded-2xl flex items-center justify-center text-2xl mb-6`}>
                  <i className={`fas ${s.icon}`}></i>
                </div>
                <h3 className="text-2xl font-bold font-jakarta text-slate-900 mb-3">{s.title}</h3>
                <p className="text-slate-500 text-sm leading-relaxed mb-6">{s.desc}</p>
                <ul className="space-y-3 text-sm text-slate-600">
                  {s.items.map((item, j) => (
                    <li key={j}><i className="fas fa-check-circle text-green-500 mr-2"></i>{item}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Proceso */}
      <section id="proceso" className="py-24 px-4 bg-white scroll-mt-20">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16" data-aos="fade-up">
            <span className="pill bg-[#EEF2FF] text-[#1A237E] border border-[#C7D2FE] mb-6 inline-block">Metodología</span>
            <h2 className="text-4xl md:text-5xl font-jakarta font-extrabold text-slate-900 mb-4">¿Cómo trabajamos?</h2>
            <p className="text-lg text-slate-500 max-w-2xl mx-auto">Un proceso probado que garantiza resultados desde el día uno.</p>
          </div>
          <div className="grid md:grid-cols-4 gap-8 relative">
            <div className="hidden md:block absolute top-24 left-[12%] right-[12%] h-0.5 bg-gradient-to-r from-[#1A237E] via-[#6A1B9A] to-[#D81B60]"></div>
            {[
              { num: "01", color: "bg-[#1A237E]", title: "Diagnóstico", desc: "Analizamos tus canales actuales, volumen de interacciones y puntos de mejora." },
              { num: "02", color: "bg-[#6A1B9A]", title: "Estrategia", desc: "Diseñamos el flujo de atención, tono de voz y SLA personalizados para tu marca." },
              { num: "03", color: "bg-[#D81B60]", title: "Implementación", desc: "Activamos canales, entrenamos al equipo y comenzamos la operación en 48 horas." },
              { num: "04", color: "bg-[#00ACC1]", title: "Optimización", desc: "Reportes semanales, ajustes continuos y mejora basada en datos reales." }
            ].map((p, i) => (
              <div key={i} className="text-center relative" data-aos="fade-up" data-aos-delay={100 + i * 100}>
                <div className={`w-16 h-16 ${p.color} text-white rounded-2xl flex items-center justify-center text-2xl font-extrabold font-jakarta mx-auto mb-6 relative z-10 shadow-xl`}>{p.num}</div>
                <h4 className="font-bold text-lg text-slate-900 mb-2">{p.title}</h4>
                <p className="text-sm text-slate-500">{p.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Precios */}
      <section id="precios" className="py-24 px-4 scroll-mt-20">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16" data-aos="fade-up">
            <span className="pill bg-[#EEF2FF] text-[#1A237E] border border-[#C7D2FE] mb-6 inline-block">Inversión</span>
            <h2 className="text-4xl md:text-5xl font-jakarta font-extrabold text-slate-900 mb-4">Planes Transparentes</h2>
            <p className="text-lg text-slate-500 max-w-2xl mx-auto">Sin letra pequeña. Eliges el plan que necesitas y lo ajustamos a tu volumen.</p>
          </div>
          <div className="grid lg:grid-cols-3 gap-8 items-stretch">
            <div className="bg-white rounded-[32px] p-8 md:p-10 price-card shadow-sm border border-slate-100" data-aos="fade-up" data-aos-delay="100">
              <div className="mb-8">
                <span className="pill bg-[#EEF2FF] text-[#1A237E]">Gestión de Redes</span>
                <h3 className="font-jakarta font-bold text-2xl mt-5">Social Media</h3>
                <p className="text-sm text-slate-400 mt-2">Gestión completa de interacciones digitales</p>
              </div>
              <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 mb-6">
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Cobertura horaria</label>
                <select id="socialSelect" onChange={(e) => {
                  const p = document.getElementById("socialPrice")
                  if (p) p.textContent = "$" + e.target.value
                }} className="w-full bg-transparent font-bold text-slate-800 focus:outline-none cursor-pointer text-base">
                  <option value="150">L-V (8am–5pm) — $150/mes</option>
                  <option value="200" selected>Inc. fines de semana — $200/mes</option>
                  <option value="270">12h L-V + fines de semana — $270/mes</option>
                  <option value="350">Soporte global 24/7 — $350/mes</option>
                </select>
              </div>
              <div className="flex items-baseline gap-1.5 mb-8">
                <span className="text-5xl font-extrabold text-slate-900 tracking-tighter" id="socialPrice">$200</span>
                <span className="text-slate-400">/mes</span>
              </div>
              <ul className="space-y-4 mb-10">
                {["Atención de DMs y comentarios", "Resolución de dudas frecuentes", "Reporte semanal de interacciones", "Moderación de comunidad"].map((item, i) => (
                  <li key={i} className="flex items-start gap-3 text-slate-600"><i className="fas fa-check-circle text-green-500 mt-0.5"></i><span className="text-sm">{item}</span></li>
                ))}
              </ul>
              <button onClick={openModal} className="w-full py-4 bg-[#1A237E] text-white rounded-2xl font-bold hover:bg-[#6A1B9A] transition-all shadow-lg shadow-[#1A237E]/15">Elegir Plan</button>
            </div>

            <div className="bg-gradient-to-br from-white to-slate-50 rounded-[32px] p-8 md:p-10 price-card featured text-slate-900 relative overflow-hidden border-2 border-[#1A237E]/10" data-aos="fade-up" data-aos-delay="200">
              <div className="absolute top-0 right-0 w-40 h-40 bg-[#1A237E]/5 rounded-full -mr-10 -mt-10"></div>
              <div className="absolute top-4 right-4">
                <span className="pill bg-[#F59E0B] text-[#0F1A5E] border-0 text-[10px]"><i className="fas fa-star mr-1"></i> MÁS SOLICITADO</span>
              </div>
              <div className="mb-8 relative">
                <span className="pill bg-[#D81B60] text-white border-0">Recuperación B2B / B2C</span>
                <h3 className="font-jakarta font-bold text-2xl mt-5 text-slate-900">Gestión de Cobranza</h3>
                <p className="text-sm text-slate-500 mt-2">Solo pagas por resultados recuperados</p>
              </div>
              <div className="space-y-2.5 mb-10 relative">
                <p className="text-xs text-slate-400 uppercase font-bold tracking-widest mb-4">Comisiones por tramo de mora:</p>
                {[["Preventiva", "1%"], ["0 a 30 días", "2%"], ["31 a 60 días", "4%"], ["61 a 90 días", "6%"], ["91 a 120 días", "8%"], ["+121 días", "20%"]].map(([label, pct], i) => (
                  <div key={i} className="flex justify-between items-center bg-[#1A237E]/5 p-3 rounded-2xl border border-[#1A237E]/10 text-slate-700"><span>{label}</span><span className="font-extrabold text-[#D81B60]">{pct}</span></div>
                ))}
              </div>
              <button onClick={openModal} className="w-full py-4 bg-gradient-to-r from-[#1A237E] to-[#6A1B9A] text-white rounded-2xl font-bold text-lg hover:shadow-xl hover:shadow-[#1A237E]/30 transition-all shadow-lg mt-auto relative">Solicitar Gestión</button>
            </div>

            <div className="bg-white rounded-[32px] p-8 md:p-10 price-card shadow-sm border border-slate-100" data-aos="fade-up" data-aos-delay="300">
              <div className="mb-8 text-center">
                <span className="pill bg-slate-100 text-slate-500">Corporativo</span>
                <h3 className="font-jakarta font-bold text-2xl mt-5">Enterprise</h3>
                <p className="text-sm text-slate-400 mt-2">Para empresas con alto volumen</p>
              </div>
              <div className="mb-8">
                <div className="w-full h-44 rounded-3xl bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center">
                  <i className="fas fa-building text-5xl text-slate-300"></i>
                </div>
              </div>
              <div className="text-center mb-10">
                <p className="font-jakarta font-bold text-2xl text-slate-700">A tu medida</p>
                <p className="text-sm text-slate-400 mt-3 leading-relaxed">Infraestructura dedicada, reportes en tiempo real, SLA personalizado y soporte 24/7.</p>
              </div>
              <ul className="space-y-4 mb-10">
                {["Agentes dedicados", "Paneles de control en vivo", "Integración API con tu CRM", "Gestor de cuenta asignado"].map((item, i) => (
                  <li key={i} className="flex items-start gap-3 text-slate-600"><i className="fas fa-check-circle text-green-500 mt-0.5"></i><span className="text-sm">{item}</span></li>
                ))}
              </ul>
              <a href="https://wa.me/5842422433946?text=Hola%20NEXUS%2C%20quiero%20informaci%C3%B3n%20del%20plan%20Enterprise" target="_blank" rel="noopener" className="block w-full py-4 border-2 border-[#1A237E] text-[#1A237E] text-center rounded-2xl font-bold hover:bg-[#1A237E] hover:text-white transition-all">Consultar</a>
            </div>
          </div>
        </div>
      </section>

      {/* Testimonios */}
      <section id="testimonios" className="py-24 px-4 bg-white scroll-mt-20">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16" data-aos="fade-up">
            <span className="pill bg-[#EEF2FF] text-[#1A237E] border border-[#C7D2FE] mb-6 inline-block">Casos de Éxito</span>
            <h2 className="text-4xl md:text-5xl font-jakarta font-extrabold text-slate-900 mb-4">Lo que dicen nuestros clientes</h2>
            <p className="text-lg text-slate-500 max-w-2xl mx-auto">Empresas que confían en NEXUS para su operación de contact center.</p>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            {[
              { initials: "MG", color: "bg-[#EEF2FF] text-[#1A237E]", name: "María González", role: "Directora de Marketing · ModaVE",
                text: "Desde que trabajamos con NEXUS, nuestro tiempo de respuesta bajó de 45 minutos a 3 minutos. El ROI fue inmediato." },
              { initials: "CR", color: "bg-green-100 text-green-700", name: "Carlos Rodríguez", role: "CFO · Financiera Plus",
                text: "Recuperamos el 40% de nuestra cartera morosa en los primeros 3 meses. El equipo de cobranza de NEXUS es implacable." },
              { initials: "AL", color: "bg-pink-100 text-[#D81B60]", name: "Ana Lucía Pérez", role: "CEO · EcommerceBox",
                text: "Externalizamos todo nuestro customer service con NEXUS. La calidad supera nuestras expectativas." }
            ].map((t, i) => (
              <div key={i} className="bg-slate-50 rounded-3xl p-8 testimonial-card border border-slate-100" data-aos="fade-up" data-aos-delay={100 + i * 100}>
                <div className="flex text-[#F59E0B] mb-4">{Array(5).fill(0).map((_, j) => <i key={j} className="fas fa-star"></i>)}</div>
                <p className="text-slate-600 text-sm leading-relaxed mb-6 italic">&ldquo;{t.text}&rdquo;</p>
                <div className="flex items-center gap-4">
                  <div className={`w-12 h-12 ${t.color} rounded-full flex items-center justify-center font-bold`}>{t.initials}</div>
                  <div><div className="font-bold text-sm text-slate-900">{t.name}</div><div className="text-xs text-slate-400">{t.role}</div></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="py-24 px-4 scroll-mt-20">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-16" data-aos="fade-up">
            <span className="pill bg-[#EEF2FF] text-[#1A237E] border border-[#C7D2FE] mb-6 inline-block">FAQ</span>
            <h2 className="text-4xl md:text-5xl font-jakarta font-extrabold text-slate-900 mb-4">Preguntas Frecuentes</h2>
          </div>
          <div className="space-y-4" data-aos="fade-up">
            {[
              { q: "¿Cómo funciona la prueba gratuita de 10 días?",
                a: "Te activamos el servicio sin costo durante 10 días para que evalúes la calidad, los tiempos de respuesta y la plataforma. Al término, si deseas continuar, elegimos el plan que mejor se adapte a tu volumen." },
              { q: "¿Qué canales puedo integrar?",
                a: "WhatsApp (API oficial), Instagram, Facebook Messenger, TikTok, Telegram, chat web, email y telefonía IP. Todos unificados en un solo panel de control." },
              { q: "¿Tienen agentes bilingües?",
                a: "Sí. Contamos con agentes completamente bilingües (español/inglés) para atender mercados internacionales. También podemos cubrir portugués bajo demanda." },
              { q: "¿Cómo se factura la gestión de cobranza?",
                a: "Solo pagas comisión sobre lo efectivamente recuperado. No hay costos fijos ni mensualidades. Las comisiones varían según el tramo de mora, desde 1% (preventiva) hasta 20% (+121 días)." },
              { q: "¿Qué tipo de reportes recibo?",
                a: "Reportes semanales y mensuales con KPIs clave: tiempo promedio de respuesta, satisfacción (CSAT), volumen de interacciones, tasa de resolución, recuperación de cartera y más. Todo vía dashboard web." }
            ].map((faq, i) => (
              <details key={i} className="faq-item bg-white rounded-2xl border border-slate-100 overflow-hidden group">
                <summary className="flex justify-between items-center p-6 font-bold text-slate-800 hover:bg-slate-50 transition-colors">
                  {faq.q}
                  <i className="fas fa-chevron-down text-slate-400 group-open:rotate-180 transition-transform"></i>
                </summary>
                <div className="px-6 pb-6 text-slate-500 text-sm leading-relaxed">{faq.a}</div>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Final */}
      <section className="py-24 px-4" data-aos="fade-up">
        <div className="max-w-5xl mx-auto bg-gradient-to-r from-[#1A237E] via-[#6A1B9A] to-[#D81B60] rounded-[48px] p-12 md:p-20 text-center text-white relative overflow-hidden shadow-2xl shadow-[#1A237E]/20">
          <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full blur-3xl -mr-20 -mt-20"></div>
          <div className="absolute bottom-0 left-0 w-64 h-64 bg-white/5 rounded-full blur-3xl -ml-20 -mb-20"></div>
          <h2 className="text-4xl md:text-5xl font-jakarta font-extrabold mb-6 relative">¿Listo para transformar<br />tu operación?</h2>
          <p className="text-lg text-white/80 max-w-xl mx-auto mb-10 relative">Agenda una demo sin compromiso y descubre cómo NEXUS puede potenciar tu contacto con clientes.</p>
          <div className="flex flex-col sm:flex-row justify-center gap-4 relative">
            <button onClick={openModal} className="bg-white text-[#1A237E] px-10 py-5 rounded-full font-bold text-lg hover:bg-slate-100 transition-all shadow-xl flex items-center justify-center gap-2">
              <i className="fas fa-calendar-check"></i> Agendar Demo Gratis
            </button>
            <a href="https://wa.me/5842422433946?text=Hola%20NEXUS%2C%20quiero%20informaci%C3%B3n" target="_blank" rel="noopener" className="bg-transparent border-2 border-white text-white px-10 py-5 rounded-full font-bold text-lg hover:bg-white hover:text-[#1A237E] transition-all flex items-center justify-center gap-2">
              <i className="fab fa-whatsapp"></i> Hablar por WhatsApp
            </a>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-[#070F3E] text-white pt-20 pb-10 px-4">
        <div className="max-w-7xl mx-auto">
          <div className="grid md:grid-cols-4 gap-12 mb-16">
            <div>
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center text-white font-extrabold text-lg font-jakarta">N</div>
                <div className="flex flex-col">
                  <span className="font-jakarta font-extrabold text-xl tracking-tighter leading-none">NEXUS</span>
                  <span className="text-[7px] font-bold text-slate-500 uppercase tracking-[0.25em] mt-0.5">Contact Center</span>
                </div>
              </div>
              <p className="text-slate-400 text-sm leading-relaxed">Talento, tecnología y compromiso para llevar tu experiencia de cliente al siguiente nivel.</p>
            </div>
            <div>
              <h5 className="font-bold text-sm text-white uppercase tracking-widest mb-6">Servicios</h5>
              <ul className="space-y-3 text-sm text-slate-400">
                {["Atención Omnicanal", "Redes Sociales", "Gestión de Cobranza", "Soporte Técnico", "Telemarketing"].map((item, i) => (
                  <li key={i}><a href="#" className="hover:text-white transition-colors">{item}</a></li>
                ))}
              </ul>
            </div>
            <div>
              <h5 className="font-bold text-sm text-white uppercase tracking-widest mb-6">Empresa</h5>
              <ul className="space-y-3 text-sm text-slate-400">
                {["Sobre Nosotros", "Carreras", "Blog", "Política de Privacidad"].map((item, i) => (
                  <li key={i}><a href="#" className="hover:text-white transition-colors">{item}</a></li>
                ))}
              </ul>
            </div>
            <div>
              <h5 className="font-bold text-sm text-white uppercase tracking-widest mb-6">Contacto</h5>
              <ul className="space-y-3 text-sm text-slate-400">
                <li className="flex items-center gap-3"><i className="fab fa-whatsapp text-green-400"></i> <a href="https://wa.me/5842422433946" target="_blank" rel="noopener" className="hover:text-white transition-colors">+58 424 22433946</a></li>
                <li className="flex items-center gap-3"><i className="far fa-envelope text-blue-400"></i> <a href="mailto:comercial@nexusbpo.space" className="hover:text-white transition-colors">comercial@nexusbpo.space</a></li>
                <li className="flex items-center gap-3"><i className="fas fa-map-marker-alt text-blue-400"></i> Venezuela · Operaciones Globales</li>
              </ul>
              <div className="flex gap-4 mt-6">
                {["instagram", "facebook-f", "linkedin-in", "tiktok"].map((icon, i) => (
                  <a key={i} href="#" className="w-10 h-10 bg-white/5 rounded-full flex items-center justify-center hover:bg-white/20 transition-colors"><i className={`fab fa-${icon}`}></i></a>
                ))}
              </div>
            </div>
          </div>
          <div className="border-t border-white/10 pt-10 text-center">
            <p className="text-sm font-bold text-white/80 tracking-wide">BEST VISION VENEZUELA, C.A.</p>
            <p className="text-xs text-slate-500 mt-1">RIF / Registro Mercantil — Operaciones Autorizadas</p>
            <p className="text-xs text-slate-500 mt-4">&copy; 2026 NEXUS Contact Center. Todos los derechos reservados.</p>
          </div>
        </div>
      </footer>

      {/* Modal */}
      <div className="modal-overlay" id="formModal">
        <div className="modal-content bg-white rounded-[32px] w-full max-w-xl p-8 md:p-12 relative shadow-2xl">
          <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-[#1A237E] via-[#6A1B9A] to-[#D81B60] rounded-t-[32px]"></div>
          <button onClick={closeModal} className="absolute top-6 right-6 w-10 h-10 bg-slate-100 rounded-full flex items-center justify-center text-slate-400 hover:bg-slate-200 hover:text-slate-600 transition-all text-xl">
            <i className="fas fa-times"></i>
          </button>
          <div className="text-center mb-10 mt-2">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#1A237E] to-[#6A1B9A] flex items-center justify-center text-white font-extrabold text-xl font-jakarta mx-auto mb-5 shadow-xl">N</div>
            <h3 className="text-3xl font-jakarta font-bold text-slate-900 mb-2">Empieza ahora</h3>
            <p className="text-slate-500 text-sm">Completa tus datos y te contactaremos en menos de 24 horas.</p>
          </div>
          <form id="nexusForm" className="space-y-5" onSubmit={(e) => {
            e.preventDefault()
            const toast = document.getElementById("demoToast")
            if (toast) { toast.classList.add("show"); setTimeout(() => toast.classList.remove("show"), 3500) }
            closeModal()
          }}>
            <div className="grid grid-cols-2 gap-4">
              <div><label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-1.5">Nombre</label>
                <input required className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 text-sm text-slate-800 focus:outline-none focus:border-[#1A237E]" placeholder="Tu nombre" /></div>
              <div><label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-1.5">Apellido</label>
                <input required className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 text-sm text-slate-800 focus:outline-none focus:border-[#1A237E]" placeholder="Tu apellido" /></div>
            </div>
            <div><label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-1.5">Correo electrónico</label>
              <input type="email" required className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 text-sm text-slate-800 focus:outline-none focus:border-[#1A237E]" placeholder="tu@correo.com" /></div>
            <div><label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-1.5">Teléfono</label>
              <input type="tel" required className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 text-sm text-slate-800 focus:outline-none focus:border-[#1A237E]" placeholder="+58 412 1234567" /></div>
            <div><label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-1.5">Empresa</label>
              <input className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 text-sm text-slate-800 focus:outline-none focus:border-[#1A237E]" placeholder="Nombre de tu empresa" /></div>
            <div><label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-1.5">Mensaje</label>
              <textarea rows={3} className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 text-sm text-slate-800 focus:outline-none focus:border-[#1A237E] resize-none" placeholder="Cuéntanos sobre tu proyecto..."></textarea></div>
            <button type="submit" className="w-full py-5 bg-gradient-to-r from-[#1A237E] to-[#6A1B9A] text-white rounded-2xl font-bold text-base hover:shadow-xl hover:shadow-[#1A237E]/30 transition-all hover:scale-[1.01]">
              <i className="fas fa-paper-plane mr-2"></i> Enviar Solicitud
            </button>
          </form>
        </div>
      </div>

      {/* Toast */}
      <div id="demoToast" className="toast">
        <i className="fas fa-check-circle mr-2"></i> ¡Gracias! Te contactaremos pronto.
      </div>
    </>
  )
}

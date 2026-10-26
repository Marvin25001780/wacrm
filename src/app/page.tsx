import type { Metadata } from "next";
import { Landing } from "@/components/marketing/landing";

export const metadata: Metadata = {
  title:
    "Nexus CRM — El CRM omnicanal para WhatsApp, Instagram y TikTok",
  description:
    "Centraliza WhatsApp, Instagram, Facebook Messenger y TikTok en una sola bandeja. Automatiza ventas, cobranzas y atención con IA integrada.",
  keywords: [
    "CRM",
    "WhatsApp Business",
    "Instagram",
    "TikTok",
    "omnicanal",
    "cobranza",
    "inteligencia artificial",
    "Venezuela",
  ],
  openGraph: {
    title: "Nexus CRM — CRM omnicanal para WhatsApp y redes sociales",
    description:
      "Una sola bandeja para WhatsApp, Instagram, Messenger y TikTok, con embudos, agentes de IA y cobranza.",
    type: "website",
    locale: "es_VE",
  },
};

export default function LandingPage() {
  return <Landing />;
}

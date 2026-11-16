# Contact center open source: qué integramos y por qué

> Objetivo: **CRM + CCaaS + WEM + IA** en un solo producto, apoyado en
> repositorios open source en lugar de reinventar la media, la voz o el
> BI. Regla de oro: no copiamos código GPL/AGPL dentro de la app; los
> proyectos con esas licencias se usan como **servicio externo** y se
> integran por API.

## 1. Arquitectura elegida

```
                     ┌──────────────────────────────┐
   WhatsApp / Email  │  CRM + bandeja (Next.js)     │
   Instagram / FB    │  contactos, pipeline, POS    │
                     │  IA de texto,QA,reportes     │
                     └──────────────┬───────────────┘
                                    │ API + webhooks
                     ┌──────────────▼───────────────┐
   PSTN / SIP  ─────▶│  LiveKit (Apache-2.0)        │
                     │  SFU WebRTC + SIP + Egress   │
                     └──────────────┬───────────────┘
                                    │ Agentes de voz (fase IA)
                     ┌──────────────▼───────────────┐
                     │  LiveKit Agents / Pipecat    │
                     │  STT → LLM → TTS, handoff    │
                     └──────────────────────────────┘
```

- **CCaaS (voz)**: LiveKit server + SIP + Egress. Ya integrado.
- **CRM**: el CRM existente (contacts, inbox, pipeline, POS).
- **WEM**: se construye nativo sobre `call_sessions` (reportes,
  disposiciones, wrap-up, QA). No se vendoriza un WEM completo.
- **IA**: el proveedor del negocio (OpenAI, Anthropic, Gemini, DeepSeek,
  Groq) para texto; transcripción con OpenAI/Groq/Gemini; resumen por
  llamada; y en el futuro agentes de voz sobre LiveKit Agents.

## 2. Repositorios evaluados

| Proyecto | Licencia | Rol | Decisión |
| --- | --- | --- | --- |
| [livekit/livekit](https://github.com/livekit/livekit) | Apache-2.0 | Servidor WebRTC/SFU | **Integrado** como servicio (media + SIP). |
| [livekit/sip](https://github.com/livekit/sip) | Apache-2.0 | Puerta SIP ↔ WebRTC | **Integrado** vía troncal SIP del operador. |
| [livekit/egress](https://github.com/livekit/egress) | Apache-2.0 | Grabación de salas | **Integrado** (grabación de audio). |
| [livekit/agents](https://github.com/livekit/agents) | Apache-2.0 (modelos de turno con licencia aparte) | Agentes de voz IA | **Siguiente fase**: contestador/IVR con IA. Requiere servidor LiveKit. |
| [pipecat-ai/pipecat](https://github.com/pipecat-ai/pipecat) | BSD-2-Clause | Pipeline STT→LLM→TTS | **Alternativa** si se necesita un pipeline Python propio; no se integra ahora para no duplicar la capa de agentes. |
| [chatwoot/chatwoot](https://github.com/chatwoot/chatwoot) | MIT | Bandeja omnicanal | **No se vendoriza**: el CRM ya tiene bandeja. Se estudió su modelo de canales. |
| [Metabase](https://github.com/metabase/metabase) | AGPL-3.0 | BI/dashboards | **No se integra embebido** (AGPL + peso). Reportes nativos en `/telefonia/reportes`. |
| [Apache Superset](https://github.com/apache/superset) | Apache-2.0 | BI | **Opcional a futuro** para analítica avanzada externa, no para el producto. |
| [Asterisk](https://github.com/asterisk/asterisk) | GPL-2.0 | PBX/SIP | **No se copia**. Si un operador lo exige, se usa como troncal externa. |
| [FreeSWITCH](https://github.com/signalwire/freeswitch) | MPL-2.0 | PBX/SIP | **No se copia**; misma razón que Asterisk. |
| [OMniLeads](https://github.com/omnicode/omnileads) | GPL-3.0 | Contact center completo | **No se vendoriza** (GPL + stack Python/Django separado). Se toman ideas de ACD y campañas. |

## 3. Qué está integrado hoy

1. **Softphone WebRTC** con `livekit-client` y tokens de corta duración.
2. **Salientes por SIP** con `livekit-server-sdk` (`SipClient`).
3. **Entrantes** por número marcado o metadata de regla de despacho,
   con claim atómico entre agentes.
4. **Grabación** con Egress y **transcripción** con el proveedor de IA.
5. **Resumen IA** por llamada.
6. **Supervisión** en vivo y **reportes** de operación (día/hora/agente/
   disposición) en hora de Caracas.
7. **Cierre de llamada** con disposición y notas (wrap-up).
8. **QA de llamadas** (WEM): rúbrica de cinco criterios, puntaje 0–100,
   comentarios y reporte de calidad por agente.
9. **QA automática con IA**: segunda opinión sobre la transcripción,
   con la misma rúbrica y validación del JSON en el servidor.
10. **ACD v1**: espera máxima en cola por negocio, barrido perezoso,
    timeout de la entrante y liberación de sala.
11. **Campañas salientes** (preview): lista de contactos por campaña y
    vínculo con las llamadas salientes (estado pending/called).

Nada de eso copia código de terceros: se usan SDKs Apache-2.0 y APIs.

## 4. Siguientes fases (sin credenciales externas)

| Fase | Qué se construye | Depende de |
| --- | --- | --- |
| WEM 1 | **QA de llamadas**: rúbrica fija, puntaje por agente y reporte. | Nada (datos propios). ✅ Hecho (migración 114). |
| CCaaS 1 | **ACD**: prioridad, habilidades, tiempo de timbrado y overflow. | LiveKit + troncal para probar de verdad. ✅ Parcial: espera máxima y prioridad/FIFO en cola (migraciones 116 y 118) listos; faltan prioridad por despacho avanzada, habilidades y overflow. |
| CCaaS 2 | **Campañas salientes** (preview/progresivo) con lista y ritmo. | Troncal SIP. ✅ Parcial: CRUD de campañas + vínculo con llamadas (migración 117) listos; falta fan-out automático. |
| IA 1 | **Agente de voz** (IVR/contestador) con LiveKit Agents. | Servidor LiveKit + API keys de STT/LLM/TTS. |
| WEM 2 | **Adherencia**: horarios, pausas y cumplimiento. | Datos de presencia (ya existen). |
| IA 2 | **QA automática**: puntuar la transcripción con el LLM y comparar con el humano. | Transcripciones + proveedor de IA. ✅ Hecho (migración 115); falta comparativa en reportes. |

## 5. Reglas de integración

- **Licencias**: solo Apache-2.0, MIT y BSD dentro del árbol del CRM.
  GPL/AGPL se consumen como servicio o se descartan.
- **Sin secretos en la base**: las claves de LiveKit viven en variables
  de entorno del despliegue; por negocio solo se guarda configuración
  no secreta (`telephony_config`).
- **Sin datos inventados**: si falta una credencial o un servidor, la UI
  lo dice y bloquea la acción; no hay modo demo.
- **Una fuente de verdad**: `call_sessions` + `call_events`; las
  actividades de CRM se derivan de ahí para no duplicar métricas.
- **Multi-negocio**: todo se filtra por `account_id` y RLS; los números
  entrantes no se comparten entre negocios.

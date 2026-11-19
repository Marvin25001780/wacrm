# Telefonía (contact center de voz) con LiveKit

> Módulo `/telefonia` + softphone flotante. La voz viaja por **LiveKit**
> (Apache-2.0) y la PSTN por la **troncal SIP** del operador. Este CRM
> guarda estado, historial, grabación y transcripción; no transporta audio.

## 1. Arquitectura

```
Navegador (agente)  ──WebRTC──▶  LiveKit (media)  ──SIP──▶  Troncal / PSTN
        │                              │
        │ API Next.js                  │ webhook firmado
        ▼                              ▼
   call_sessions / call_events   /api/telephony/webhook
        │                              │
        └──── activities (type='call') ┘  → /metrics/llamadas
```

- **Next.js** crea la sesión (`call_sessions`), emite un token de
  LiveKit de corta duración y ordena marcar por SIP.
- **LiveKit** hace de SFU/WebRTC y de pasarela SIP. No copiamos código
  GPL/AGPL: es un servicio externo con licencia Apache-2.0.
- Al contestar, el navegador avisa a `/answer`; al colgar (o si se cae
  la pestaña), el webhook `room_finished` cierra la sesión y escribe la
  **actividad de CRM** que alimenta Métricas → Llamadas.

### Tablas (migraciones 112–123)

| Tabla                          | Para qué                                                                                                        |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `telephony_config`             | Ajustes por negocio: activo, caller ID, troncal, números entrantes, grabación, transcripción. **Sin secretos.** |
| `call_sessions`                | Una fila por llamada: dirección, estado, tiempos, agente, contacto, grabación, transcripción, resumen IA y cierre (disposición/notas). |
| `call_events`                  | Bitácora append-only (creada, contestada, grabación lista, cerrada, disposición…).                              |
| `call_evaluations`             | QA de la llamada (migración 114): puntaje 0–100, rúbrica y comentarios del supervisor.                         |
| `call_ai_evaluations`          | QA automática con IA (migración 115): nota, rúbrica, proveedor/modelo y feedback.                               |
| `member_presence.agent_status` | Disponibilidad operativa: `available`, `busy`, `wrap_up`, `break`.                                              |
| `agent_shifts`                 | Turnos semanales recurrentes del agente (migración 120), en hora local de Venezuela.                            |
| `agent_status_log`             | Bitácora de cambios de estado con motivo y origen (migración 120); base de la adherencia.                        |
| `callback_requests`            | Devoluciones de llamadas perdidas (migración 122): cola compartida, asignación y vínculo con la saliente.        |
| `call_sessions.transfer_*`     | Transferencias internas (migración 123): origen, timbre, tope y `queued_at` para medir la espera al reencolar.   |

RLS: cualquier miembro lee; agente+ crea y cierra sus llamadas; admin+
puede cerrar cualquiera. El estado de agente se cambia solo por RPC
(`set_agent_status`), que deriva la cuenta de la sesión.

La **migración 113** añade el cierre de llamada: `disposition`, `notes` y
`wrap_up_completed_at` en `call_sessions`, con una lista fija de
resultados (`sale`, `quote`, `support`, `complaint`, `follow_up`,
`not_interested`, `wrong_number`, `other`) que vive en
`src/types/index.ts`. No es una tabla configurable por negocio.

La **migración 114** añade `call_evaluations`: una evaluación por
llamada con rúbrica fija de cinco criterios (saludo, identificación,
escucha, resolución y cierre), cada uno de 0 a 5. El puntaje 0–100 se
calcula en el servidor (`src/lib/telephony/qa.ts`) y solo admin+ puede
escribirlo.

La **migración 115** añade `call_ai_evaluations`: una segunda opinión
generada con el proveedor de IA del negocio sobre la transcripción. El
JSON del modelo se valida y se recalcula en el servidor
(`src/lib/telephony/ai-qa.ts`); no se guarda nada que el modelo no haya
devuelto por criterio.

La **migración 116** añade `telephony_config.queue_max_wait_seconds`
(espera máxima en cola, segundos; `0` = sin límite). Con ella entra el
ACD v1: el barrido (`src/lib/telephony/queue-sweep.ts`) cierra las
entrantes que exceden el máximo como `missed` con motivo `timeout` y
escribe el evento `queue_timeout`. Corre desde `/api/telephony/status`
y desde el panel de supervisión, de forma perezosa.

La **migración 118** añade `call_sessions.priority` (0–5, mayor = más
urgente) y define el orden de salida de la cola: prioridad descendente
y, dentro de la misma prioridad, orden de llegada (FIFO). El webhook
toloca la prioridad desde el metadata de la sala
(`{"account_id":"…","priority":5}`); las salientes arrancan en 0.

La **migración 119** añade `account_members.agent_skills` (habilidades
del agente en el negocio) y `telephony_config.required_skills` /
`skill_overflow_seconds`. El requisito se copia a
`call_sessions.required_skills` al entrar la llamada y el desbordamiento
queda marcado en `call_sessions.overflowed_at`.

La **migración 120** añade `agent_shifts` (turnos semanales) y
`agent_status_log` (bitácora de estados con motivo). Amplía
`set_agent_status` a `(p_status, p_reason, p_source)`; las llamadas
antiguas con un solo argumento siguen funcionando por los valores por
defecto. Solo se registra un evento cuando el estado **cambia**: repetir
el mismo estado es heartbeat y no abre un intervalo nuevo.

La **migración 121** añade `break_start`, `break_end` y `break_label` a
`agent_shifts`: la pausa programada del turno. Ambas horas van juntas o
no van; la etiqueta es libre (máx. 60 caracteres).

La **migración 122** añade `callback_requests`: la cola de devoluciones
de llamadas perdidas. Una entrante que no se contesta deja una fila
`pending`; el agente la reclama y la cierra. Un índice único por
`source_call_id` impide duplicados (las altas manuales llevan NULL).

La **migración 123** añade las transferencias internas: `transfer_from_user_id`,
`transfer_at`, `transfer_timeout_seconds`, `transfer_count` y `queued_at`
en `call_sessions`; `transfer_ring_timeout_seconds` y
`max_transfers_per_call` en `telephony_config`; y la RPC
`release_expired_transfers`, que devuelve a la cola las transferencias
que nadie contestó.

## 2. Variables de entorno

Solo en el servidor. Si faltan, la UI muestra la lista y **no permite
marcar** (no hay modo demo).

```env
LIVEKIT_URL=wss://tu-proyecto.livekit.cloud
LIVEKIT_API_KEY=...
LIVEKIT_API_SECRET=...
# Troncal saliente por defecto (se puede sobrescribir por negocio)
LIVEKIT_SIP_TRUNK_ID=ST_...
# Grabación (Egress). Requiere almacenamiento configurado en LiveKit.
LIVEKIT_RECORDING_ENABLED=false
# Base pública para descargar/transcribir la grabación
TELEPHONY_RECORDINGS_PUBLIC_BASE_URL=https://.../storage/v1/object/public/recordings
# Espera máxima en cola del despliegue (por negocio se puede sobrescribir; 0 = sin límite)
TELEPHONY_QUEUE_MAX_WAIT_SECONDS=60
```

`LIVEKIT_URL` acepta `https://` (se normaliza a `wss://`) o `wss://`.
El API secret nunca se envía al navegador ni se guarda en Supabase.

## 3. Puesta en marcha (una vez por despliegue)

### 3.1 Levantar LiveKit

- **LiveKit Cloud**: crea un proyecto y copia URL + API key/secret.
- **Self-hosted**: sigue `livekit-server` (Docker o binario). Para
  probar en local: `livekit-server --dev` (claves de desarrollo).

### 3.2 Crear la troncal SIP saliente

En el panel de LiveKit o por API (`SipClient.createSipOutboundTrunk`).
Necesitas los datos del operador: host SIP, usuario/contraseña o IP
autorizada, y el número saliente (DID). Copia el ID (`ST_…`) a
`LIVEKIT_SIP_TRUNK_ID` o al campo de Configuración → Telefonía.

### 3.3 Webhook

Configura el webhook de LiveKit en:

```
https://TU-DOMINIO/api/telephony/webhook
```

La ruta verifica la firma con `LIVEKIT_API_SECRET`. Sin webhook, una
pestaña cerrada no cierra la llamada (queda “activa” hasta que el
agente vuelva a entrar y el softphone la cierre como `agent_left`).

Eventos usados: `participant_joined`, `participant_left`,
`room_finished`, `egress_ended`. Las salas que no empiezan por
`crm-call-` se ignoran.

### 3.4 Llamadas entrantes

Dos formas de asignar la llamada a un negocio:

1. **Por número marcado** (recomendado): guarda el DID en
   Configuración → Telefonía → “Números entrantes”. El webhook busca
   ese número en `telephony_config.inbound_numbers` y etiqueta la
   sesión con el `account_id` del negocio.
2. **Por metadata de la regla de despacho**: crea una regla
   `individual` con `roomPrefix: "crm-call-"` y
   `metadata: {"account_id":"<uuid>"}`. El prefijo es obligatorio:
   el webhook ignora las salas que no empiezan por `crm-call-`.

Un número entrante pertenece a **un solo negocio** (la app rechaza
duplicados al guardar). Si no se resuelve el negocio, la llamada no se
registra y se deja un aviso en el log del servidor.

Cuando entra una llamada:

1. El webhook crea la sesión (`ringing`, sin agente).
2. El softphone de los agentes **disponibles** consulta el estado cada
   5 s y muestra el aviso de **Llamada entrante** con el
   número/contacto. En pausa, cierre u ocupado la cola no suena.
3. El primero que pulsa **Contestar** la reclama
   (`POST /calls/[id]/claim`, gana quien actualice primero) y entra a
   la sala; LiveKit contesta la troncal y la sesión pasa a `active`.
   Si el agente no está `available`, el claim responde 409.
4. **Rechazar** la cierra como `cancelled` sin asignarla. Si nadie
   contesta, queda como `missed` cuando el cliente cuelga.

### 3.5 Espera máxima en cola (ACD v1)

- Configuración → Telefonía → “Espera máxima en cola (segundos)” (por
  negocio: `telephony_config.queue_max_wait_seconds`, rango 0–3600,
  default 60; `0` = sin límite). El despliegue puede forzar el default
  con `TELEPHONY_QUEUE_MAX_WAIT_SECONDS`.
- El softphone muestra la espera en cola con cronómetro
  (“En cola · 0:45”); al agotarse el máximo, la barrido retira la
  entrante.
- El barrido es **perezoso**: corre desde `GET /api/telephony/status`
  y desde el panel de supervisión (admin+), no desde un cron. Busca
  llamadas entrantes `ringing` sin agente asignado cuyo
  `started_at` ya excedió el máximo y las cierra con motivo `timeout`
  (estado `missed`, evento `queue_timeout` en la bitácora, sala de
  LiveKit liberada).
- Solo retira entrantes sin agente; una reclamación atómica de un agente
  siempre gana al cierre (guard `ringing` + `agent_user_id IS NULL`).

### 3.6 Habilidades y desbordamiento (ACD v2)

**Habilidades requeridas** (Configuración → Telefonía): lista separada
por comas, máx. 8, guardada en `telephony_config.required_skills`.
Al entrar una llamada, el requisito se **copia** en
`call_sessions.required_skills`: cambiarlo después no altera la cola en
curso. La regla de despacho puede fijar otro requisito por sala con
`{"account_id":"…","required_skills":["ventas"]}`; si no lo trae, manda
el del negocio.

**Habilidades del agente**: se asignan en el panel de supervisión
(lápiz en la columna Habilidades) y viven en
`account_members.agent_skills` (minúsculas, sin duplicados, máx. 8).
Solo admin+ las edita; un admin no puede tocar las de otro admin ni las
del dueño (RPC `set_member_agent_skills`).

Cómo se reparte la cola:

| Situación | Quién la ve |
| --- | --- |
| `required_skills` vacío | Cualquier agente disponible |
| Exige habilidades | Solo quien las tenga **todas** |
| Ya desbordada (`overflowed_at`) | Cualquier agente disponible |

**Desbordamiento por habilidad** (`skill_overflow_seconds`, 0–3600,
0 = desactivado): si nadie con las habilidades la toma en ese tiempo,
el barrido perezoso levanta el requisito (`call_sessions.overflowed_at`,
evento `skill_overflow`) y la llamada pasa a cualquier agente
disponible. No asigna agente ni cierra la llamada: solo quita la
restricción. El `UPDATE` exige `ringing`, sin agente y sin desbordar,
así que una reclamación simultánea siempre gana.

El softphone muestra “Requiere: …” (o “Desbordada: cualquier agente
disponible puede tomarla”) y el `claim` responde 409 con las
habilidades que faltan si el agente no cumple. Un agente sin
habilidades solo recibe las llamadas sin requisito o ya desbordadas.

> El desbordamiento actual es **por habilidad** (local, sin troncal).
> Desviar a otro número externo exigiría una transferencia SIP y queda
> pendiente hasta tener LiveKit + troncal.

### 3.7 WEM: turnos, pausas y adherencia (migración 120)

**Turnos** (`/telefonia/adherencia` → Turnos): cada agente tiene turnos
semanales recurrentes (`agent_shifts`), con día (0 = domingo … 6 =
sábado), entrada, salida y etiqueta opcional. Se guardan en hora local
de Venezuela; un turno cuyo fin es menor que el inicio cruza medianoche
(22:00–06:00). Solo admin+ los crea y borra; todo el negocio los lee.

**Pausa programada** (migración 121): cada turno puede llevar una ventana
de pausa (`break_start` / `break_end` / `break_label`), por ejemplo
12:00–13:00 “Almuerzo”. Es opcional y se repite con el turno. Si el
agente no tiene pausa programada, el cumplimiento de pausa queda en `—`
(no se inventa un 100 %).

**Pausas**: al pulsar Pausa en el softphone se elige un motivo de la
lista fija (`src/lib/telephony/adherence.ts`): almuerzo, descanso,
capacitación, reunión, personal, falla técnica u otro. El motivo viaja
a `set_agent_status` y queda en `agent_status_log.reason`; los cambios
automáticos (marcar, reclamar, pasar a cierre) se registran con
`source = 'system'`.

**Definiciones v1** de la ventana consultada (máx. 31 días):

| Indicador   | Cálculo                                                              |
| ----------- | -------------------------------------------------------------------- |
| Programado  | suma de los turnos que caen dentro de la ventana                     |
| Conectado   | cualquier estado de agente registrado en la bitácora                 |
| Disponible  | tiempo en `available`                                                |
| Pausa       | tiempo en `break`; el número entre paréntesis son las pausas        |
| Pausa prog. | tiempo de las ventanas de pausa planificadas                        |
| Cumple pausa| pausa real dentro de la ventana programada ÷ pausa programada        |
| Hablado     | llamadas contestadas (`answered_at` → `ended_at`)                    |
| Adherencia  | trabajo dentro del turno ÷ programado                                |
| Ocupación   | hablado ÷ trabajo (`available` + `busy` + `wrap_up`)                 |

Sin turno, la adherencia es `—` (no se inventa un 100 %) pero la
ocupación sí se calcula. La API lee 7 días antes del inicio para saber
con qué estado arrancaba la ventana; si no hay evento previo, el primer
intervalo empieza en el primer cambio real.

La lógica pura vive en `src/lib/telephony/adherence.ts` (con pruebas) y
la API en `GET /api/telephony/adherence?from=ISO&to=ISO` (admin+). Igual
que los reportes, la lectura tiene tope de 20 000 filas y avisa con
`truncated` si se alcanzó.

### 3.8 Devoluciones de llamadas perdidas (migración 122)

**Cuándo se crea sola.** Al cerrar una entrante que nunca se contestó y
terminó `missed` (cuelgue del cliente, timeout de cola) o `cancelled`
(rechazo del agente), `finalizeCall` deja una fila `pending` en
`callback_requests` con el número, el contacto si se pudo casar y el
motivo (`timeout`, `declined` o `missed`). Un fallo de transporte
(`failed`) no genera devolución. El índice único por `source_call_id`
hace la creación idempotente si el webhook y el navegador cierran a la
vez.

**Cola compartida** (`/telefonia/devoluciones`, agente+): las
pendientes se ven por orden de llegada y se refrescan cada 20 s. Al
pulsar **Llamar**:

1. el `UPDATE` atómico reclama la fila (`status = pending` → el primero
   gana; el segundo recibe 409);
2. se marca con el softphone y la llamada queda vinculada en
   `call_session_id`;
3. la devolución pasa a `done` con `completed_at` y `completed_by`.

Un agente no puede tener dos devoluciones en curso a la vez. Si la
llamada no se puede iniciar (sin LiveKit/troncal), la fila queda en
curso y se puede **Liberar**. También se puede **Completar** sin llamada
(si se atendió por fuera) y **Cancelar** (admin+). Las altas manuales
(`reason = manual`) sirven para “el cliente pidió que lo llamen”.

> Reclamar y completar funcionan sin telefonía; marcar requiere LiveKit
> y troncal, igual que el resto del softphone.

### 3.9 Transferencias internas (migración 123)

Un agente que está en llamada puede pasarla a otro agente del negocio
o devolverla a la cola. **La sala de LiveKit no se cierra**: el cliente
nunca pierde el audio y solo cambia quién lo atiende.

**Transferir a un agente.** Desde el softphone, con la llamada activa,
el botón de transferencia abre el equipo con el estado de cada persona.
Solo se puede elegir a un agente `available` y sin otra llamada; el
servidor lo revalida (no se confía en la UI). Al confirmar:

1. la sesión pasa a `ringing` con `agent_user_id` del destino,
   `transfer_at = now()` y `transfer_timeout_seconds` del negocio;
2. el agente que transfiere sale de la sala (`removeParticipant`) y
   queda **Disponible** (no entra en cierre: no terminó la
   conversación);
3. el destino ve “Llamada transferida por …” y **Contesta** o
   **Rechaza**.

Si rechaza, la llamada vuelve a la cola con `queued_at = now()` (el
timeout de espera se mide desde ese momento, no desde el alta). Si no
contesta en `transfer_ring_timeout_seconds` (5–300 s, por defecto 25),
la RPC `release_expired_transfers` la devuelve a la cola igual que un
rechazo. El cliente sigue en la sala todo el tiempo.

**Devolver a la cola.** Mismo mecanismo sin destino: la llamada queda
`ringing` sin agente y `queued_at = now()`. El barrido de cola la
cierra si supera la espera máxima; como ya estaba contestada, se cierra
como `ended` (no como perdida) y **no** genera devolución (122).

**Tope de rebotes.** `max_transfers_per_call` (0–10, por defecto 3;
`0` = sin límite) impide que una llamada rebote entre agentes. Al
llegar al tope, la API responde 409 y solo queda devolverla a la cola o
terminarla.

**Webhook.** Al salir de la sala el agente que transfiere, LiveKit manda
`participant_left`. El webhook ya no cierra la llamada en ese caso:
solo termina si se va el cliente (SIP), si se va el agente dueño actual
o si la sala se destruye. Una llamada sin agente (en cola) tampoco se
cierra por la salida de un agente.

> Todo esto se prueba de punta a punta con LiveKit y troncal. Sin ellos
> la UI no ofrece transferir (no hay llamada real que mover).

### 3.10 Operación en vivo con SLA (bloque 124)

`/telefonia/operacion` (admin+) es un panel de solo lectura que se
refresca cada 5 segundos. **No requiere migración**: lee la cola, la
presencia, la bitácora de estados (120) y las transferencias (123).

Antes de responder hace el mismo barrido perezoso que el softphone
(timeout de cola, desbordamiento por habilidad y transferencias
vencidas), así los números coinciden con lo que ve el agente.

**Muestra:**

- **Cola en vivo** con la espera real de cada llamada (desde
  `queued_at` si volvió a la cola, si no desde el alta), su prioridad y
  sus habilidades.
- **SLA**: la espera máxima del negocio (`queue_max_wait_seconds`) es
  el objetivo. `0` = sin límite, así que no hay alertas. Se marca
  **por vencer** al 80 % del máximo y **vencida** al llegar al máximo
  (la cola la retira en el siguiente barrido).
- **Transferencias sin aceptar**: de quién a quién, cuántos segundos
  le quedan al timbre y el número de intento.
- **Agentes**: estado operativo, tiempo en ese estado (desde el último
  cambio en `agent_status_log`), presencia, habilidades, llamada en
  curso y si están recibiendo una transferencia.
- **Alertas**: llamadas fuera de SLA o por vencer, transferencias a
  punto de vencer, pausas de más de 20 minutos, cierres de más de 5
  minutos y agentes marcados Disponible pero desconectados.

Los umbrales de pausa y cierre son fijos en el código
(`src/lib/telephony/operations.ts`); no son configurables porque
todavía no hay una razón operativa distinta por negocio. Si el último
cambio de estado es anterior a la ventana de 7 días que lee la API, el
tiempo en estado se muestra como desconocido en vez de inventar una
cifra.

> El panel no contesta ni despacha llamadas: eso sigue siendo el
> softphone y su claim atómico.

## 4. Grabación y transcripción

### Grabación (opcional)

1. Configura un destino de Egress en LiveKit (S3, GCS, Azure o disco).
2. Define `LIVEKIT_RECORDING_ENABLED=true`.
3. En Configuración → Telefonía activa “Grabar llamadas”.

La grabación arranca al contestar (`/answer`) y se detiene al colgar.
Egress deja el archivo en el almacenamiento; con
`TELEPHONY_RECORDINGS_PUBLIC_BASE_URL` la app construye una URL
descargable. Sin esa base la grabación se guarda, pero no se puede
transcribir desde la UI.

### Transcripción

Usa el proveedor de **Ajustes → Asistente de IA** (OpenAI, Groq o
Gemini). Anthropic y DeepSeek no ofrecen endpoint de audio. El botón
“Transcribir” del historial descarga la grabación (máx. 24 MB) y la
manda al proveedor; el texto queda en `call_sessions.transcript`.

Con **Transcribir grabaciones** activo y
`TELEPHONY_RECORDINGS_PUBLIC_BASE_URL` definida, la transcripción es
automática: el webhook `egress_ended` la lanza en segundo plano
(después de responder a LiveKit) y el historial la muestra al
refrescarse. El botón manual queda como reintento si el proveedor
falló. Si el interruptor está apagado, no se transcribe nada solo.

### Resumen con IA

Con la llamada transcrita, **Ver → Resumir** pide al proveedor de IA
del negocio un resumen corto en cuatro líneas (resumen, motivo,
acuerdos y siguiente paso) y lo guarda en `call_sessions.ai_summary`.
El prompt prohíbe inventar datos: lo que no está en la transcripción
se marca como “No se indicó”. Es idempotente — una llamada se resume
una sola vez — y consume tokens del mismo proveedor que el asistente;
requiere el interruptor maestro de **Ajustes → Asistente de IA**.

## 5. Operación diaria

- El botón de teléfono del encabezado abre el softphone; también hay
  botón de llamada en la ficha del contacto y en la cabecera del hilo.
- Estados del agente: **Disponible**, **Ocupado**, **Cierre** y
  **Pausa**. Al marcar pasa a Ocupado; al colgar pasa a Cierre
  (wrap-up) y queda bloqueado para nuevas llamadas hasta que guarda la
  disposición u omite el cierre; entonces vuelve a Disponible.
- **Cierre (wrap-up)**: al colgar el softphone pide una disposición
  (venta, cotización, soporte, reclamo, seguimiento, no interesado,
  número equivocado u otro) y notas opcionales. Se guarda con
  `PATCH /api/telephony/calls/[id]`; `wrap_up_completed_at` es lo que
  permite medir el tiempo de cierre. Omitir vuelve a Disponible sin
  clasificar la llamada.
- Solo los agentes `available` reciben y pueden reclamar entrantes; el
  resto sigue viendo el historial y puede marcar salientes.
- Cada llamada cerrada crea una actividad `type='call'` con dirección,
  resultado y duración. Por eso `/metrics/llamadas` sigue funcionando
  sin cambios.
- El botón **Detalle** del historial abre la llamada con reproductor
  de la grabación, resumen IA, transcripción y bitácora de eventos
  (`call_events`) en orden cronológico.
- Las llamadas entrantes sin agente no crean actividad (no hay a quién
  asignarlas); sí quedan en `call_sessions` como `missed`.
- **Supervisión** (admin+): el panel de `/telefonia` muestra cada
  agente con su presencia (heartbeat), su estado operativo, la llamada
  que tiene en curso con cronómetro y la cola de entrantes sin
  reclamar con su tiempo de espera. Se refresca cada 5 s; es solo
  lectura.
- **Reportes** (admin+): `/telefonia/reportes` con ventana de 7, 30 o
  90 días. Muestra volumen, contestadas, perdidas/nivel de servicio,
  abandono, espera media, duración media, tiempo de cierre,
  grabaciones/transcripciones, barras por día y por hora (hora de
  Caracas), tabla por agente y resultados por disposición. La API
  (`GET /api/telephony/reports?days=N`) devuelve como máximo 5 000
  llamadas y avisa cuando la ventana se truncó.
- **Calidad (QA)** (admin+): en el detalle de una llamada contestada y
  cerrada, el supervisor puntúa cinco criterios de 0 a 5 y deja
  comentarios. El puntaje 0–100 aparece en el detalle, en la bitácora
  (`evaluated`) y en la columna QA de los reportes, junto con la
  cobertura (evaluadas / contestadas).
- **QA automática con IA** (admin+): con la llamada transcrita, el
  botón **Evaluar con IA** pide al proveedor del negocio una nota por
  criterio y un feedback corto. Se guarda aparte de la nota humana, se
  puede regenerar y deja un evento `ai_evaluated`. Sirve para priorizar
  qué llamadas revisar, no para sustituir al supervisor. Los reportes
  incluyen **ambas**: promedio humano, promedio de IA por agente y
  evaluaciones IA del periodo (`call_ai_evaluations`).

- **Campañas salientes** (admin+): `/telefonia/campanas` arma campañas
  (migración 117) con una lista de contactos. V1 es *preview*: el CRM no
  hace fan-out automático; cada contacto se marca con el flujo normal de
  llamadas desde el botón **Marcar** (softphone → claim → answer →
  disposition). Al colgar, el contacto pasa a `called` y la campaña
  registra el estado. Las campañas sin llamada no consumen contactos.

### Permisos

| Rol           | Puede                                                                                          |
| ------------- | ---------------------------------------------------------------------------------------------- |
| Viewer        | Ver historial y configuración (solo lectura).                                                  |
| Agent         | Marcar, contestar/cerrar sus llamadas, transcribir, resumir y cambiar su estado.                |
| Admin / Owner | Todo lo anterior + cerrar llamadas ajenas + supervisión + reportes + evaluar calidad + configuración. |

## 6. Límites y aspectos legales (Venezuela)

- **Consentimiento de grabación**: avisa al cliente (“esta llamada
  puede ser grabada”) y revisa con un abogado local la base legal y el
  tiempo de conservación. La app no reproduce el aviso por ti.
- **Numeración y portabilidad**: la habilitación de DID, numeración
  local y portabilidad depende de tu operador; no es algo que la app
  pueda resolver.
- **STIR/SHAKEN** no aplica a la PSTN venezolana; el “Caller ID” puede
  mostrarse distinto según el operador.
- **Conectividad variable**: si el agente pierde internet, la llamada
  SIP puede seguir viva del lado de la troncal. Define con tu operador
  el fallback (callback/PSTN) y revisa el costo por minuto.
- **Datos personales**: la grabación y la transcripción son datos del
  cliente. Aplica la misma política de retención que el resto del CRM.
- **WhatsApp sigue mandando** en Venezuela: la voz es un canal
  complementario, no el principal.

## 7. Diagnóstico

| Síntoma                                          | Causa probable                                                                         |
| ------------------------------------------------ | -------------------------------------------------------------------------------------- |
| “El servidor no tiene LiveKit configurado”       | Faltan `LIVEKIT_URL`, `LIVEKIT_API_KEY` o `LIVEKIT_API_SECRET`.                        |
| “Falta la troncal SIP saliente”                  | No hay `LIVEKIT_SIP_TRUNK_ID` ni troncal por negocio.                                  |
| “Falta aplicar la migración 112”                 | Ejecuta `PROD_UPDATE_112.sql` en Supabase.                                             |
| Marca pero no suena                              | Troncal mal configurada, número no permitido o firewall SIP. Revisa el log de LiveKit. |
| La llamada queda “activa” tras cerrar la pestaña | Webhook no configurado o apuntando a otro dominio.                                     |
| “No se pudo descargar la grabación”              | Egress sin almacenamiento o `TELEPHONY_RECORDINGS_PUBLIC_BASE_URL` incorrecta.         |
| “El negocio no tiene proveedor de transcripción” | Configura OpenAI/Groq/Gemini en Ajustes → Asistente de IA.                             |
| “El asistente de IA no está configurado”         | El interruptor maestro del Asistente de IA está apagado o no hay API key guardada.     |
| “Ponte Disponible para contestar llamadas”       | El agente está en pausa/cierre/ocupado; cambia de estado en el softphone.              |
| “Solo se evalúan llamadas contestadas y cerradas” | La llamada sigue sonando/activa o nunca se contestó.                                  |
| La entrante suena mucho tiempo y nadie la contesta | Espera máxima configurada (`queue_max_wait_seconds`) o agente sin estado `available`. |

## 8. API

| Método    | Ruta                                   | Uso                                  |
| --------- | -------------------------------------- | ------------------------------------ |
| GET       | `/api/telephony/status`                | Estado del softphone (sin secretos). |
| GET/POST  | `/api/telephony/calls`                 | Historial / iniciar saliente.        |
| GET       | `/api/telephony/calls/[id]`            | Detalle + bitácora de eventos.       |
| PATCH     | `/api/telephony/calls/[id]`            | Disposición y notas del cierre.      |
| POST      | `/api/telephony/calls/[id]/answer`     | Contestada (arranca grabación).      |
| POST      | `/api/telephony/calls/[id]/claim`      | Reclamar una entrante que suena.     |
| POST      | `/api/telephony/calls/[id]/transfer`   | Transferir a un agente o a la cola (123). |
| POST      | `/api/telephony/calls/[id]/transfer/accept` | Aceptar una transferencia (123). |
| POST      | `/api/telephony/calls/[id]/transfer/decline` | Rechazarla; vuelve a la cola (123). |
| GET       | `/api/telephony/transfer-targets`      | Agentes disponibles para transferir (123). |
| POST      | `/api/telephony/calls/[id]/end`        | Colgar / rechazar (crea actividad).  |
| POST      | `/api/telephony/calls/[id]/transcribe` | Transcribir grabación.               |
| POST      | `/api/telephony/calls/[id]/summary`    | Resumen IA de una llamada transcrita. |
| GET       | `/api/telephony/agents`                | Supervisión del equipo (admin+).     |
| GET       | `/api/telephony/operations`            | Operación en vivo: cola, SLA, agentes y transferencias (admin+, 124). |
| GET       | `/api/telephony/reports`               | Reportes de operación (admin+).      |
| GET/POST  | `/api/telephony/evaluations`           | QA de llamadas (POST admin+).        |
| GET/POST  | `/api/telephony/calls/[id]/ai-evaluate` | QA automática con IA (POST admin+). |
| GET       | `/api/telephony/campaigns`              | Campañas salientes con contactos (admin+). |
| DELETE    | `/api/telephony/campaigns/[id]`        | Eliminar una campaña (admin+).      |
| GET       | `/api/telephony/campaigns/contacts`    | Contactos para armar campañas (admin+). |
| GET/POST  | `/api/telephony/callbacks`             | Devoluciones de llamadas perdidas (agente+, 122). |
| POST      | `/api/telephony/callbacks/[id]/claim`  | Reclamar una devolución (atómico).   |
| POST      | `/api/telephony/callbacks/[id]/release` | Devolverla a la cola.               |
| POST      | `/api/telephony/callbacks/[id]/complete` | Cerrarla como atendida (vincula la llamada). |
| POST      | `/api/telephony/callbacks/[id]/cancel` | Cancelarla (admin+).                 |
| GET       | `/api/telephony/adherence`             | Adherencia y ocupación por agente (admin+, 120). |
| GET/POST  | `/api/telephony/shifts`                | Turnos semanales del negocio (admin+, 120). |
| DELETE    | `/api/telephony/shifts/[id]`           | Borrar un turno (admin+, 120).       |
| GET/PATCH | `/api/telephony/config`                | Configuración por negocio (admin+).  |
| PATCH     | `/api/account/members/[userId]`        | Alias, rol y habilidades (`agentSkills`, 119; admin+). |
| POST      | `/api/telephony/presence`              | Estado del agente (`status` + `reason` opcional en pausa, 120). |
| POST      | `/api/telephony/webhook`               | Eventos de LiveKit (firma).          |

`PATCH /api/telephony/config` acepta `requiredSkills` (array o texto
separado por comas, máx. 8) y `skillOverflowSeconds` (0–3600; 0 =
desactivado), además de los campos de troncal, números, grabación y
espera en cola. Desde la 123 también acepta
`transferRingTimeoutSeconds` (5–300) y `maxTransfersPerCall` (0–10;
0 = sin límite).

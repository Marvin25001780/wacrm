# Consola del agente de cobranza

> Migración 125 · implementada en `/cobranza/consola` · complementa
> `docs/plan-tecnico-cobranza.md` §7.3.

## 1. Qué resuelve

El módulo de cobranza (migraciones 073–079) ya tenía deudores, créditos,
cuotas, pagos, promesas y reportes. Lo que faltaba era la **mesa de
trabajo del gestor**: una pantalla donde tomar un caso, ver el saldo y
las cuotas, llamar y dejar la tipificación sin saltar entre páginas.

La consola no inventa datos ni botones decorativos:

- La cola la calcula la base (`collection_agent_queue`), no el
  navegador.
- Las tipificaciones salen de `collection_outcomes`, que el admin puede
  editar en la base.
- El guión sale de `collection_policies.script_template` del tramo.
- La llamada se vincula a la sesión real del softphone cuando existe.
- Si falta la migración 125, la pantalla lo dice y no simula la cola.

## 2. Disposición

```
┌──────────────┬──────────────────────────────┬────────────────┐
│ Cola         │ Ficha del deudor             │ Llamada        │
│ · ámbito     │ · saldo / vencido / PTP      │ · marcar       │
│ · búsqueda   │ · créditos y cuotas          │ · vínculo      │
│ · prioridad  │ · promesas y gestiones       │ · gestión      │
└──────────────┴──────────────────────────────┴────────────────┘
```

En móvil las tres columnas se apilan. En escritorio cada columna tiene
su propio scroll para que la cola no desaparezca al bajar por la ficha.

## 3. Orden de la cola

`collection_agent_queue()` agrupa por urgencia real:

| `queue_rank` | Significado |
|---|---|
| 0 | PTP rota en los últimos 30 días o PTP que vence hoy |
| 1 | PTP abierta que vence después |
| 2 | Mora (cuota vencida sin pagar) |
| 3 | Al día |

Antes de `queue_rank`, la cola pone a quien **espera respuesta por
WhatsApp** (`awaiting_reply`, migración 128): el último mensaje del
deudor es más nuevo que el último del negocio. Así una respuesta real
no se queda enterrada detrás de la cartera del día.

Dentro de cada grupo: prioridad de la 076 → saldo vencido → días de
mora → nunca contactado primero → nombre.

No hay “puntaje de propensión” ni machine learning: el orden es una
regla explicable. La pantalla muestra la razón (`priority_reason`) y la
etiqueta del grupo.

### Ámbitos

- **Mis deudores**: `collection_debtors.assigned_to` es tu perfil.
- **Sin asignar**: `assigned_to IS NULL`.
- **Toda la cartera**: útil para un admin o un gestor que va a tomar
  un caso nuevo.

La función es `SECURITY DEFINER` porque necesita resolver el nombre del
gestor (la RLS de `profiles` solo deja ver el perfil propio). Antes de
leer valida `is_account_member(account_id, 'agent')`.

## 4. Tomar y soltar

`collection_claim_debtor(p_debtor_id)`:

1. Bloquea la fila del deudor con `FOR UPDATE`.
2. Si ya lo tiene otro gestor y quien llama no es admin, falla con un
   mensaje que incluye el nombre del otro gestor.
3. Cierra la asignación activa anterior y crea una nueva en
   `collection_assignments`.
4. Actualiza `collection_debtors.assigned_to`.

`collection_release_debtor(p_debtor_id)` hace lo inverso y solo lo
puede ejecutar el gestor asignado o un admin.

Tomar es **explícito**: abrir una ficha no asigna el deudor. Así dos
agentes no se pisan por accidente.

## 5. Registrar la gestión

`POST /api/cobranza/actions` valida en TypeScript (mensajes legibles) y
luego llama a `collection_record_action(...)`, que hace todo en una
transacción:

1. Comprueba que el deudor, el crédito, la cuota y la llamada son del
   negocio (y la llamada, del propio agente salvo admin).
2. Inserta `collection_actions`.
3. Si la tipificación es `ptp`, inserta `collection_promises` y enlaza
   `collection_actions.promise_id`.
4. Actualiza el estado del deudor si el agente lo cambió.

Si el segundo paso falla, no queda una promesa huérfana. El agente no
puede borrar filas por RLS, así que la atomicidad importa.

### Estados manuales

- Agente: `contactado`, `negociacion`, `acuerdo`, `ilocalizable`.
- Admin/owner: además `juridico`.
- `pagado` **nunca** se fija a mano: lo deriva el pago.

La lista se valida en `src/lib/collections/desk.ts` y se repite en SQL
como última barrera.

## 6. Llamada vinculada

- `call_sessions.collection_debtor_id` (125) guarda el deudor.
- `collection_actions.call_session_id` (125) guarda la llamada de la
  gestión.

El botón **Llamar** usa el softphone (`startCall` con
`collectionDebtorId`). `POST /api/telephony/calls` valida que el deudor
sea del negocio y guarda el vínculo. Si la columna aún no existe, la
llamada se crea sin vínculo en vez de fallar.

Cuando la llamada termina, el cierre (`wrapUp`) trae la duración real y
la consola la conserva para que la gestión la registre aunque el agente
cierre el diálogo.

## 7. Docmost y la base de conocimiento

`collection_settings.knowledge_base_url` (125) guarda la URL de la wiki
de guiones y procedimientos. Se configura en
`/cobranza/configuracion` → **Base de conocimiento** y aparece como
botón **Guiones** en la consola.

Decisión: Docmost se integra como **servicio aparte y enlace externo**.
Es AGPL-3.0 con una edición Enterprise; copiar su código al CRM
mezclaría licencias y obligaría a mantener un fork. El CRM no embebe ni
indexa su contenido: solo abre la URL en otra pestaña. Cualquier wiki
con URL sirve igual.

## 8. Qué se tomó de Vaani y de sistema-prestamos

Ninguno de los dos se vendoriza; son referencias de producto y flujo.

### Vaani (`vasu-devs/Vaani`, MIT)

Se adoptaron ideas, no su stack (Python/FastAPI + LiveKit + Groq +
Deepgram):

- Guión por tramo con variables (`{{nombre}}`, `{{saldo}}`, `{{mora}}`).
- Tipificación en dos niveles y motivo obligatorio en la negativa.
- PTP inmediata al cerrar la gestión.
- Priorización por riesgo y por promesa incumplida.

El softphone y la transcripción del CRM siguen siendo los de las
migraciones 112–116; Vaani no se ejecuta en producción.

### sistema-prestamos (`leifermendez/sistema-prestamos`, Apache-2.0)

Referencia de rutas de cobro, bóvedas, cierres de caja y roles. El CRM
ya tiene su propio modelo de cartera y pagos; no se copió PHP/Laravel.
Las ideas útiles fueron:

- Separar la ficha del deudor de la pantalla de gestión.
- Registrar el pago desde la cuota, no desde un formulario suelto.
- Cerrar la gestión con una tipificación obligatoria.

## 9. API

| Método | Ruta | Uso |
|---|---|---|
| GET | `/api/cobranza/desk?scope=&q=&segment=&limit=&offset=` | Cola paginada con total |
| POST | `/api/cobranza/debtors/[id]/claim` | `{ action: "claim" \| "release" }` |
| POST | `/api/cobranza/actions` | Gestión + PTP atómica |
| POST | `/api/telephony/calls` | Acepta `collectionDebtorId` |

La cola devuelve `{ rows, total, limit, offset, hasMore }`. Sin
migración 125 responde `409` con `migration: "125"`.

## 10. Lógica pura y pruebas

`src/lib/collections/desk.ts` contiene lo testeable sin base ni red:

- ámbitos y etiquetas de la cola;
- validación de la gestión y de la PTP contra la política del tramo;
- estados permitidos por rol;
- sustitución de variables del guión;
- fechas de vencimiento y tramos.

`src/lib/collections/desk.test.ts` cubre 17 casos. El formulario
(`src/components/collections/action-form.tsx`) usa esa misma validación
antes de llamar a la API.

## 11. Migración 125

`supabase/migrations/125_collection_agent_desk.sql`:

1. `collection_settings.knowledge_base_url`.
2. `collection_actions.call_session_id`.
3. `call_sessions.collection_debtor_id`.
4. Corrección de `v_collection_debtor_summary`: la versión de 076 unía
   cuotas y gestiones en el mismo `FROM`, así que con N gestiones el
   saldo salía multiplicado por N. Ahora cada agregado va en su propio
   `LATERAL`.
5. `collection_agent_queue()`.
6. `collection_claim_debtor()` / `collection_release_debtor()`.
7. `collection_record_action()`.

Es idempotente y termina con `NOTIFY pgrst, 'reload schema'`.

## 12. Bloque 128 — cuando el deudor responde

La 127 dejó el envío de WhatsApp en la consola. El hueco inverso era la
respuesta: el mensaje entra a `messages` y la cola no se enteraba.

`collection_agent_queue()` ahora devuelve:

- `awaiting_reply`: el último mensaje `customer` del hilo es más nuevo
  que el último mensaje del negocio (`agent` o `bot`).
- `last_inbound_at`: la fecha de ese entrante.

La señal se calcula sobre el hilo real, no sobre
`conversations.unread_count` (el inbox lo limpia al abrir y la consola
no, así que mentiría en ambos sentidos). Responder desde la consola
apaga la alerta sola, sin tablas de estado nuevas.

En pantalla:

- la cola muestra el chip **Respondió** y ordena primero esos casos;
- la ficha muestra **Respondió por WhatsApp** con la fecha del mensaje;
- el supervisor ve el KPI **Esperan respuesta**, la columna **Esperan**
  por gestor y un aviso si hay casos esperando sin asignar.

Reglas:

- solo cuentan hilos de WhatsApp del contacto vinculado al deudor
  (`collection_debtors.contact_id`);
- un mensaje del bot también cierra la espera;
- un deudor sin contacto o sin mensajes nunca aparece como “esperando”;
- los deudores `pagado` quedan fuera de la cola y del conteo.

Rollback al final de `supabase/migrations/128_collection_reactive_queue.sql`.

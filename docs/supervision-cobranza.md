# Supervisión de cobranza

Pantalla `/cobranza/supervision` + migración `126_collection_supervision.sql`.

La consola (125) es la mesa del gestor. La supervisión es la mesa del
coordinador: quién está trabajando, cuánto lleva, qué promesas están en
riesgo y cómo se reparte la cartera que nadie tiene. Todo número sale de
una consulta; no hay métricas simuladas.

## Qué resuelve

| Antes | Ahora |
|---|---|
| El admin no sabía cuántos casos tenía cada gestor sin abrir la cartera uno por uno. | Tablero con cartera, gestiones del día, contactos, PTP y promesas vencidas por gestor. |
| Repartir la cartera era editar deudor por deudor. | Reparto automático por carga, con tope por gestor y filtro por segmento. |
| Reasignar un caso concreto no tenía interfaz. | Selector “Asignar” en la ficha del deudor (solo admin/owner). |
| Las promesas que vencían hoy quedaban enterradas en la ficha. | Panel de promesas de los próximos N días, incluidas las vencidas y rotas. |
| Los reportes mostraban “Usuario” para casi todo el equipo. | Los nombres se resuelven por `account_member_roster()` (109/110). |

## Pantalla

### Cabecera

- Título, hora de la última lectura (zona horaria de Venezuela).
- **Actualizar**: lectura manual.
- **Repartir cartera**: abre la confirmación de reparto.
- Refresco automático cada 30 s solo con la pestaña visible.

### KPIs

1. **Esperan respuesta** — casos con un mensaje de WhatsApp del deudor
   sin contestar (migración 128) y cuántos de ellos no tienen gestor.
2. **Gestiones de hoy** — gestiones registradas y contactos efectivos.
3. **PTP de hoy** — promesas creadas hoy y cuántas vencen hoy.
4. **Promesas vencidas** — abiertas con fecha pasada y rotas en 30 días.
5. **Sin asignar** — deudores y saldo pendientes de reparto.

“Hoy” lo decide el servidor con `collection_settings.timezone`
(`America/Caracas` por defecto). No se usa el reloj del navegador: un
equipo con otra zona no debe cortar el día en otro momento.

### Equipo

Una fila por miembro operativo (agente, admin u owner). Los viewers se
excluyen porque no pueden gestionar cartera.

- Presencia del softphone: disponible, en llamada, after-call, pausa.
- Cartera asignada: cantidad de deudores y saldo.
- **Esperan**: respuestas de WhatsApp pendientes de ese gestor, en
  ámbar/índigo cuando hay alguna (128).
- Gestiones de hoy y tasa de contacto (`contacts / actions`).
- PTP creadas hoy, promesas que vencen hoy, vencidas y rotas en 30 días.
- Clic en una fila filtra el panel de promesas de ese gestor. Otro clic
  quita el filtro.

Si hay respuestas pendientes en deudores sin asignar, aparece un aviso
sobre el tablero con enlace a la consola: el reparto no debe esperar a
que alguien abra la cartera por casualidad.

### Promesas por vencer

Promesas `pending`/`partial` con vencimiento dentro de la ventana
elegida (7/14/30 días); las vencidas entran siempre. Muestra deudor,
teléfono, gestor, monto, fecha, estado y folio del crédito. El deudor
abre su ficha 360.

### Reparto

- Solo actúa sobre deudores con `assigned_to IS NULL`.
- Solo reparte entre miembros con rol `agent`.
- Ordena gestores por carga actual (menos cartera primero).
- Entrega hasta N casos por gestor (1–50; 10 por defecto), con filtro
  opcional por segmento.
- `FOR UPDATE SKIP LOCKED`: dos supervisores repartiendo a la vez no se
  pisan.
- Nunca mueve un caso ya asignado. Correrlo dos veces es inofensivo.
- Si no hay gestores con rol agente, explica qué hacer en vez de fallar
  en silencio.

## APIs

| Método | Ruta | Rol | Uso |
|---|---|---|---|
| GET | `/api/cobranza/supervision?days=7` | admin | Tablero, promesas, totales, presencia y respuestas pendientes. |
| POST | `/api/cobranza/distribute` | admin | Reparto `{ perAgent, segment }`. |
| POST | `/api/cobranza/debtors/[id]/assign` | admin | `{ userId }` o `null` para devolver a la cola. |

Si falta la migración, las rutas responden `409` con `migration: "126"` y
un mensaje que dice qué aplicar.

## RPC (migración 126)

| Función | Devuelve |
|---|---|
| `collection_supervisor_board(account_id)` | Una fila por gestor: carga, saldo, gestiones/contactos/PTP de hoy, promesas del día, vencidas y rotas. |
| `collection_supervisor_promises(account_id, days, limit)` | Promesas abiertas hasta N días, con `days_left` calculado en el servidor. |
| `collection_supervisor_totals(account_id)` | Tamaño y saldo de cartera, sin asignar, asignado y gestores. |
| `collection_assign_debtor(debtor_id, user_id)` | Reasigna un deudor y cierra la asignación activa anterior. |
| `collection_distribute_unassigned(account_id, per_agent, segment)` | Reparte la cartera libre y devuelve `assigned`, `agents`, `breakdown`. |
| `collection_debtor_assignee(debtor_id)` | Nombre del gestor de un deudor (cualquier agente). |

Migración 128 añade, sin tocar las firmas anteriores:

| Función | Devuelve |
|---|---|
| `collection_awaiting_replies(account_id)` | Casos con respuesta de WhatsApp sin contestar, contados por gestor, más una fila “Sin asignar”. Solo admin. |

La API mezcla ese conteo en `board[].awaiting_replies` y lo devuelve
también en `awaiting`; si la 128 no está aplicada, el tablero sigue
funcionando con el valor en cero.

Todas son `SECURITY DEFINER` porque necesitan nombres de `profiles` y
`account_members` (la RLS solo deja ver el perfil propio). La pertenencia
al negocio se valida antes de leer o escribir.

## Asignación desde la ficha

En `/cobranza/cartera/[id]`, un admin/owner ve:

- **Gestor:** nombre del asignado (vía `collection_debtor_assignee`).
- Selector con los miembros operativos del negocio.
- **Sin asignar** devuelve el caso a la cola (`collection_release_debtor`).
- **Asignar** llama a `collection_assign_debtor`, que resuelve el
  `profiles.id` del destino y actualiza `collection_debtors` +
  `collection_assignments` en una transacción.

Un agente sigue viendo el nombre del gestor, pero no el selector.

## Nombres del equipo

`src/lib/account/members.ts` centraliza la lectura:

1. `account_member_roster()` → `display_name` del negocio → `full_name`.
2. Si la RPC no existe (109 sin aplicar), cae a `profiles` y conserva lo
   que se veía antes.

Se usa en reportes, ficha del deudor y selector de asignación. También
corrige el historial de gestiones, que antes intentaba cruzar el
`user_id` de la acción contra el `id` del perfil y casi siempre fallaba.

## Permisos

- `/cobranza/supervision`: `admin` u `owner`. Un agente ve un aviso con
  enlace a su consola; no se ejecuta ninguna consulta del tablero.
- Las RPC administrativas repiten la validación en SQL: la UI no es la
  única barrera.
- El reparto y la reasignación quedan registrados en
  `collection_assignments` (`reason`), no en `audit_logs` (las
  asignaciones ya tienen su historial propio).

## Prueba real sugerida

1. Aplicar `PROD_UPDATE_126.sql`.
2. Entrar como admin/owner a `/cobranza/supervision`.
3. Verificar que aparecen los gestores con su carga real y que “Hoy”
   coincide con las gestiones registradas en la consola.
4. Tomar un deudor desde la consola con un gestor y comprobar que sube
   en el tablero.
5. Crear una PTP para hoy desde la consola y verla en “Promesas por
   vencer” con “Vence hoy”.
6. En la ficha del deudor, reasignarlo a otro gestor y confirmar el
   cambio en el tablero y en `collection_assignments`.
7. Con deudores sin asignar, usar **Repartir cartera** con 5 casos por
   gestor y verificar que nadie recibe más de 5 en esa corrida y que los
   ya asignados no se movieron.
8. Repetir el reparto: debe devolver 0 si ya no queda cartera libre.
9. Bloque 128: escribir desde un WhatsApp vinculado a un deudor y
   comprobar que sube al inicio de la cola con **Respondió**, que el KPI
   **Esperan respuesta** cuenta el caso y que la columna **Esperan** del
   gestor lo refleja.
10. Responder desde el panel de WhatsApp de la consola y actualizar: el
    caso pierde el chip y el contador baja. Si se responde desde el
    inbox, el resultado es el mismo (se mira `messages`, no
    `unread_count`).
11. Si el deudor que escribió no tiene gestor, aparece el aviso de
    pendientes sin asignar sobre el tablero.

## Rollback

El bloque de rollback está al final de
`supabase/migrations/126_collection_supervision.sql`. Las tablas no
cambian; solo se eliminan funciones e índice.

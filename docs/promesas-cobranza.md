# Ciclo de vida de las PTP (bloque 131)

## Qué resuelve

La consola crea promesas de pago (PTP) y la supervisión las lista, pero
hasta la 130 ninguna pantalla las cerraba. El resultado: una PTP vencida
seguía "pendiente" para siempre, el KPI de promesas rotas nunca subía y
la cola seguía tratando al deudor como si tuviera un acuerdo vivo.

La 131 cierra ese hueco con tres piezas:

1. cierre manual desde la consola del gestor y desde supervisión;
2. cierre masivo de vencidas con la fecha local del negocio;
3. permisos explícitos: no cualquier agente puede cerrar la PTP de otro.

## Estados

| Estado | Significado | Quién lo pone |
|---|---|---|
| `pending` | acuerdo abierto | el gestor al registrarlo |
| `partial` | pagó una parte (lo calcula el trigger de pagos) | trigger 074 |
| `kept` | pagó lo prometido | trigger 074 o cierre manual |
| `broken` | no pagó / venció | cierre manual, cierre masivo o cron |
| `cancelled` | el acuerdo se anuló (no cuenta como rota) | cierre manual |

Un pago cubre la PTP solo si entra dentro de la ventana
`created_at … due_date` del mismo crédito; eso lo decide el trigger de la
074. El cierre manual no mueve dinero: solo tipifica el acuerdo.

## Dónde se cierra

**Consola del agente** (`/cobranza/consola`), panel *Promesas de pago*:
cada PTP abierta muestra **Cumplida**, **Rota** y **Cancelar**. Al
cerrar se recargan la ficha y la cola, porque una PTP rota cambia el
orden del deudor. Un admin/owner además ve **Reabrir** en las cerradas.

**Supervisión** (`/cobranza/supervision`), panel *Promesas por vencer*:
la columna **Acciones** ofrece **Cumplida**, **Rota** y **Cancelar**
para las PTP abiertas del equipo. (Las cerradas no aparecen en esa
lista, así que reabrir se hace desde la ficha del deudor en la consola.)
El botón **Cerrar vencidas (N)** aparece solo cuando hay PTP abiertas con
fecha pasada; abre una confirmación y luego informa cuántas se marcaron
rotas.

## Reglas del servidor

`collection_resolve_promise(p_promise_id, p_status)` (131):

- solo estados `pending`, `kept`, `broken`, `cancelled`;
- cierre únicamente desde `pending` o `partial`;
- puede cerrar un admin/owner, el gestor asignado al deudor o quien creó
  la PTP; el resto recibe `42501`;
- reabrir (`pending`) es solo de supervisión y limpia `resolved_at`;
- una PTP cerrada no se vuelve a cerrar con otro estado: el historial no
  se reescribe.

`collection_expire_promises(account_id)` (131):

- exige admin/owner, o `service_role` para un cron;
- usa `collection_settings.timezone` (America/Caracas por defecto) para
  decidir qué está vencido;
- solo marca `pending`/`partial` con `paid_amount < amount` y
  `due_date < hoy local`;
- devuelve `{ closed, today, timezone }` para que la UI diga la verdad;
- es idempotente.

`collection_mark_broken_promises(account_id)` (076) se conserva y ahora
delega en la anterior. Si producción ya tenía un cron con ese nombre,
sigue funcionando, pero con la zona correcta.

## API

| Ruta | Rol | Qué hace |
|---|---|---|
| `POST /api/cobranza/promises/[id]/resolve` | agent+ | cierra o reabre una PTP |
| `POST /api/cobranza/promises/expire` | admin+ | marca rotas las vencidas |

Errores: `403` si el rol no alcanza, `404` si la PTP no existe, `409` si
ya está cerrada, `400` si el estado es inválido. Si falta la migración, la
ruta de vencidas responde `409` con `migration: "131"`.

## Lógica pura y pruebas

`src/lib/collections/promise-actions.ts` decide qué botones se ven:

- `isPromiseOpen(status)`: `pending` o `partial`;
- `availablePromiseResolutions(status, canReopen)`: cierre para abiertas,
  reabrir solo para cerradas y solo con permiso;
- `resolutionMessage(status, debtorName)`: texto del toast;
- `overduePromiseCount(rows)`: cuántas vencidas hay en la lista.

`src/lib/collections/promise-actions.test.ts` cubre apertura, cierre,
reapertura por rol, estados desconocidos, mensajes y conteo de vencidas.

## Prueba real sugerida

1. En la consola, crear una PTP con fecha de mañana para un deudor de
   prueba.
2. Cerrarla como **Rota** y comprobar que el chip cambia, que la cola
   sube al deudor (PTP rota) y que en Supervisión aparece en "rotas 30d".
3. Reabrirla como admin y verificar que vuelve a `pending` sin cambiar el
   monto.
4. Crear una PTP con fecha de ayer, sin pagos. En Supervisión debe
   aparecer como vencida y habilitar **Cerrar vencidas (1)**.
5. Confirmar: el toast debe decir "Se marcaron 1 PTP como rota" y la
   promesa debe salir de la lista de abiertas.
6. Repetir el paso 5: debe decir que no había vencidas (idempotencia).
7. Con un usuario `agent` que no sea el dueño del caso, intentar cerrar
   por API: debe responder `403`.

## Migración

`supabase/migrations/131_collection_promise_lifecycle.sql`. Idempotente:
reemplaza dos funciones existentes, agrega una nueva y un índice parcial.
No toca tablas, datos ni las funciones de cola/supervisión.

## Rollback

Restaurar el bloque 4 de `076_collection_reporting.sql` para volver a la
versión sin permisos por dueño, y luego:

```sql
DROP FUNCTION IF EXISTS public.collection_expire_promises(UUID);
DROP INDEX IF EXISTS public.idx_collection_promises_open_due;
NOTIFY pgrst, 'reload schema';
```

# Contactabilidad por hora (bloque 130)

## Qué resuelve

La supervisión (126) dice cuánto trabajó cada gestor. Los reportes dicen
cuánto se recuperó. Faltaba la pregunta del turno: **¿a qué hora
contesta la gente?** En cobranza telefónica, mover la misma lista dos
horas puede duplicar los contactos, y hasta ahora esa decisión se tomaba
por intuición.

El bloque 130 agrega una lectura agregada de las gestiones de llamada y
la convierte en un mapa de calor y en una lista de mejores franjas, sin
inventar nada: si no hay llamadas, no hay recomendación.

## Qué devuelve

RPC `collection_contactability(p_account_id UUID, p_days INT DEFAULT 30)`:

| Columna | Significado |
|---|---|
| `weekday` | día ISO: 1 = lunes … 7 = domingo |
| `hour_of_day` | hora local del negocio, 0–23 |
| `attempts` | gestiones de llamada en esa franja |
| `contacts` | intentos con `level1_code IN ('contacted','third_party')` |
| `debtors` | deudores distintos tocados en esa franja |
| `agents` | gestores distintos que llamaron en esa franja |

Reglas:

- solo canal `call`; WhatsApp ya se mide en la supervisión con su SLA;
- "contacto" usa el mismo criterio que el tablero (126) y el rendimiento
  por gestor (076), para que los números cuenten la misma historia;
- ventana de 7–90 días, 30 por defecto, para que la consulta no recorra
  años de historial;
- `America/Caracas` por defecto; si `collection_settings.timezone` cambia,
  la hora se calcula con esa zona;
- la tasa de contacto (`contacts / attempts`) se calcula en el cliente.

La función es `SECURITY DEFINER` porque necesita leer nombres y actividad
del negocio, pero valida `is_account_member(..., 'agent')` antes de
devolver una fila. Es agregada por hora: no expone la actividad de una
persona concreta.

## Dónde se ve

En `/cobranza/reportes`, panel **Contactabilidad por hora**, después de
**Recuperación diaria**:

- cabecera con llamadas, contactos y tasa global de los últimos 30 días;
- chips con las **mejores franjas** (máximo 3), exigiendo al menos 5
  intentos para no recomendar una hora por un solo caso;
- mapa de calor 7 días × horas (6–21 por defecto, ampliado si hay
  llamadas fuera de ese rango), con intensidad relativa a la mejor tasa;
- cada celda muestra la tasa y, al pasar el mouse, contactos e intentos;
- empty state honesto: "Sin llamadas en los últimos 30 días".

Si la migración no está aplicada, el panel queda vacío y el resto de los
reportes sigue cargando (la RPC se pide en paralelo y se ignoran
`42883`/`PGRST202`).

## Lógica pura y pruebas

`src/lib/collections/contactability.ts`:

- `contactRate(contacts, attempts)` — porcentaje 0–100, 0 sin intentos;
- `contactabilityHours(rows)` — rango de horas a pintar;
- `buildContactabilityGrid(rows, hours)` — matriz 7 × horas;
- `contactabilityTotals(rows)` — totales del período;
- `bestContactSlots(rows, minAttempts, limit)` — mejores franjas por tasa,
  desempatando por contactos y volumen;
- `slotLabel(weekday, hour)` — "Martes 10:00–11:00".

`src/lib/collections/contactability.test.ts` cubre el cálculo de tasa, el
recorte 0–100, el rango de horas, la matriz, los totales, el mínimo de
intentos y el orden de las mejores franjas.

## Cómo probarlo con datos reales

1. Registrar al menos 10 gestiones con canal **llamada** en dos franjas
   distintas (por ejemplo, 9:00 y 15:00), tipificando algunas como
   `contacted`.
2. Abrir `/cobranza/reportes` y bajar hasta **Contactabilidad por hora**.
3. La cabecera debe sumar exactamente esas gestiones; las celdas de las
   franjas usadas deben pintarse y el resto quedar en `·`.
4. Los chips de mejores franjas solo deben aparecer cuando una franja
   tenga 5 o más intentos; si todas tienen menos, debe decir que aún no
   se recomienda ninguna.
5. Borrar o anular las gestiones de prueba y comprobar que el panel
   vuelve al empty state.

Comprobación SQL (en el editor, con un admin real):

```sql
begin;

select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', (select user_id from profiles
             where account_role in ('owner','admin')
             order by created_at limit 1),
    'role', 'authenticated'
  )::text,
  true
);

select account_id as id from collection_debtors
order by created_at desc limit 1 \gset

select * from collection_contactability(:'id', 30);

rollback;
```

Esperado: 0 filas si aún no hay llamadas; si hay, `weekday` 1–7 y
`hour_of_day` 0–23, y la suma de `attempts` debe coincidir con las
gestiones de llamada del período.

## Rollback

```sql
DROP FUNCTION IF EXISTS public.collection_contactability(UUID, INT);
DROP INDEX IF EXISTS public.idx_collection_actions_calls_recent;
NOTIFY pgrst, 'reload schema';
```

El panel se vuelve inofensivo sin la función: muestra el empty state y no
rompe el resto de los reportes.

## Migración

`supabase/migrations/130_collection_contactability.sql`. Es idempotente y
solo agrega la función y un índice parcial
(`idx_collection_actions_calls_recent`). No toca tablas, colas ni las
funciones de la 125/126/128/129.

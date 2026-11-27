# Recordatorios preventivos por cuota

> Bloque 134. Avisa por WhatsApp y/o correo **antes**, **el día** y **después**
> del vencimiento de cada cuota, sin que un agente gaste minutos de llamada.
> Reutiliza la cartera, el WhatsApp y el correo que ya estaban desplegados.

## Qué resuelve

| Momento | Cuándo se envía | Ejemplo por defecto |
|---|---|---|
| Antes | `due_date = hoy + days_before` | 3 días antes |
| Vencimiento | `due_date = hoy` | El mismo día |
| Mora | `due_date = hoy − days_after` | Día 5 de mora |

Cada negocio decide los días, la hora local, los canales, la plantilla y el
tope por corrida. “Hoy” es la fecha de la zona horaria del negocio
(`collection_settings.timezone`, por defecto `America/Caracas`).

## Piezas

| Pieza | Rol |
|---|---|
| `collection_reminder_settings` | Una regla por negocio (migración 134). |
| `collection_reminder_log` | Bitácora por cuota + peldaño + canal, con índice único. |
| `collection_reminder_candidates(account, date, limit)` | Devuelve las cuotas que tocan, con saldo real, contacto y si ya se avisó. |
| `collection_reminder_claim(...)` | Reserva atómica antes de enviar; evita duplicados entre cron y envío manual. |
| `collection_reminder_finish(...)` | Marca `sent` / `failed` y guarda el id externo. |
| `src/lib/collections/reminders-shared.ts` | Reglas, textos y normalización (también usable en el navegador). |
| `src/lib/collections/reminders.ts` | Ejecución server-side: candidatos, plantilla, WhatsApp y correo. |
| `src/components/collections/reminder-settings.tsx` | Panel en **Cobranza → Configuración**. |

## Reglas de envío

1. **WhatsApp siempre es plantilla aprobada.** El recordatorio suele ser el
   primer mensaje (o estar fuera de la ventana de 24 h), y Meta rechaza texto
   libre en ese caso. La plantilla se busca por nombre y estado `APPROVED`.
2. **Orden de variables de la plantilla:**
   `{{1}}` deudor · `{{2}}` negocio · `{{3}}` monto · `{{4}}` vencimiento.
   Se envían solo las que la plantilla pide. Si pide más de cuatro, o usa
   saltos (`{{1}}` y `{{3}}`), no se envía y queda el motivo en la bitácora.
3. **Correo** usa el asunto y cuerpo del negocio con marcadores
   `{{deudor}}`, `{{negocio}}`, `{{cuota}}`, `{{monto}}`, `{{vencimiento}}`,
   `{{estado}}`. Sale por Mailflare (`Ajustes → Correo`).
4. **Idempotencia:** una cuota recibe como máximo un aviso por peldaño y canal.
   Si el envío falla, la siguiente corrida lo reintenta y suma `attempts`.
   Una reserva colgada más de 15 minutos se puede recuperar.
5. **Se excluyen** cuotas pagadas/canceladas o sin saldo, créditos no activos
   y deudores `pagado`, `ilocalizable` o `juridico`.
6. **Sin contacto no se inventa nada:** si falta teléfono o correo, la fila
   aparece en el resultado como omitida con su motivo.

## Configuración

1. Aplicar `PROD_UPDATE_134.sql` (o la migración
   `supabase/migrations/134_collection_reminders.sql`) en Supabase.
2. Ir a **Cobranza → Configuración → Recordatorios de pago**.
3. Elegir días antes/después, hora local y tope por corrida.
4. Activar WhatsApp y elegir una plantilla aprobada; y/o activar correo
   (requiere que Mailflare esté habilitado en Ajustes).
5. Guardar.
6. Usar **Ver a quién le toca** con una fecha para ensayar la escalera con
   datos reales. No envía nada.
7. **Enviar ahora** ejecuta la corrida real (solo admin/owner).

## Cron

El envío automático lo dispara un programador externo (Hostinger, cron-job.org,
Vercel Cron…). Debe llamar **cada hora**:

```bash
curl -sS -H "x-cron-secret: $COLLECTION_REMINDER_CRON_SECRET" \
  https://nexusbpo.space/api/cobranza/recordatorios/cron
```

Variable de entorno requerida:

```env
COLLECTION_REMINDER_CRON_SECRET=<cadena larga y aleatoria>
```

Comportamiento del cron:

- Toma solo negocios con `enabled = true`.
- Respeta `send_hour` en la zona del negocio.
- No repite la corrida del mismo día (`last_run_at`).
- Guarda un resumen compacto en `last_run_summary`.
- Devuelve `{ ok, accounts: [{ account_id, status, sent, failed, skipped }] }`.

Si el secreto no está configurado, responde `503` y no ejecuta nada. Con un
secreto distinto responde `401`.

## Límites conocidos

- No hay enlace de pago ni captura de comprobantes todavía (siguiente bloque).
- El correo depende de Mailflare; sin configuración el canal queda omitido.
- La plantilla de WhatsApp debe existir y estar aprobada en Meta.
- No reemplaza la gestión humana: los casos complejos siguen en la consola.

# Enlaces de pago y comprobantes

> Bloque 135. Cierra el ciclo del recordatorio: el deudor recibe el aviso,
> abre un enlace con su saldo real, ve cómo pagar y reporta la transferencia.
> El equipo la revisa y, al aprobarla, el pago entra a la cartera con los
> triggers existentes.

## Qué resuelve

| Antes | Ahora |
|---|---|
| El recordatorio decía “paga tu cuota” sin decir cómo. | El mensaje puede incluir un enlace personal con el saldo y los datos bancarios. |
| El deudor transfería y avisaba por WhatsApp o llamada. | Reporta la referencia desde el enlace; queda pendiente de revisión. |
| El agente cargaba el pago a mano. | Aprobar el comprobante lo aplica a las cuotas abiertas del deudor. |
| Dos personas podían cargar la misma transferencia. | Índice único por referencia + monto mientras el comprobante siga pendiente o aprobado. |

## Piezas

| Pieza | Rol |
|---|---|
| `collection_payment_settings` | Datos bancarios, pago móvil, soporte y vigencia del enlace por negocio. |
| `collection_payment_links` | Token público por deudor. Uno activo a la vez; se reutiliza. |
| `collection_receipts` | Comprobantes reportados, con estado `pending/approved/rejected`. |
| `collection_payment_link_for_debtor(...)` | Crea o reutiliza el enlace activo del deudor. |
| `collection_payment_link_public(token)` | Consulta pública: negocio, deudor, saldo, cuotas e instrucciones. |
| `collection_receipt_submit(...)` | Registra el comprobante desde el enlace (sin sesión). |
| `collection_receipt_review(...)` | Aprueba/rechaza; aprobar inserta en `collection_payments`. |
| `src/lib/collections/payment-links-shared.ts` | Tipos, normalización, etiquetas y URL (también en el navegador). |
| `src/lib/collections/payment-links.ts` | `getSiteBaseUrl`, `ensurePaymentLink`, búsqueda de enlace activo. |
| `src/app/pagar/[token]` | Página pública que ve el deudor. |
| `src/app/(dashboard)/cobranza/comprobantes` | Bandeja de revisión, generador de enlaces y datos de pago. |

## Flujo

1. El admin carga los datos en **Cobranza → Comprobantes → Datos para pagar**
   y activa el enlace.
2. En **Generar enlace de pago** busca al deudor con saldo y copia la URL.
3. Envía la URL por WhatsApp, correo o cualquier canal. También puede salir
   automáticamente en los recordatorios (ver abajo).
4. El deudor abre `/pagar/<token>`, ve su saldo real y las cuotas abiertas,
   transfiere y reporta monto, fecha, referencia y banco.
5. El comprobante queda **pendiente**. En **Revisar comprobantes**, el admin
   puede aprobarlo:
   - reparto automático: cubre las cuotas abiertas de la más antigua a la
     más nueva;
   - o indicar una cuota concreta (debe alcanzar para el monto).
6. Aprobar inserta en `collection_payments` con `method = 'transfer'`,
   `source = 'link'` y la referencia. Los triggers de la 073 recalculan cuota,
   crédito y deudor. Si el deudor queda sin saldo, sus enlaces activos pasan a
   `used`.

Rechazar solo cierra el comprobante; no toca la cartera. Repetir la misma
decisión es idempotente y devuelve el estado actual.

## Variables de los recordatorios

La plantilla de WhatsApp ahora admite una quinta variable:

| Variable | Contenido |
|---|---|
| `{{1}}` | Nombre del deudor |
| `{{2}}` | Nombre del negocio |
| `{{3}}` | Monto de la cuota |
| `{{4}}` | Fecha de vencimiento |
| `{{5}}` | Enlace de pago del deudor |

El correo acepta `{{enlace}}` (también `{{link}}` y `{{url}}`) en asunto o
cuerpo.

Reglas:

- El enlace se crea o reutiliza **solo si el mensaje lo pide**. Una plantilla
  de cuatro variables no genera enlaces.
- En el envío real, si el mensaje pide el enlace y falta
  `NEXT_PUBLIC_SITE_URL`, la fila se **omite con motivo** en vez de mandar una
  plantilla incompleta o un enlace roto.
- En la vista previa se asegura el enlace de los tres ejemplos para que el
  admin vea exactamente lo que recibirá el deudor.
- El cron no tiene request: depende de `NEXT_PUBLIC_SITE_URL`. Sin esa
  variable, los recordatorios que piden enlace se omiten y queda el motivo en
  el resumen de la corrida.

## Seguridad

- Token aleatorio de 122 bits (UUID v4 sin guiones). No revela ids internos.
- La consulta pública devuelve **solo** nombre del deudor, negocio, saldo,
  cuotas abiertas e instrucciones. Nunca documento, teléfono ni correo.
- La página fija `referrer: no-referrer` y `robots: noindex`.
- El comprobante público exige monto > 0, referencia de 3–80 caracteres y
  fecha dentro de los últimos 90 días.
- Duplicado = misma cuenta + misma referencia (sin distinguir mayúsculas) +
  mismo monto, mientras esté pendiente o aprobado.
- Aprobar exige admin/owner o `service_role`.
- El enlace vence según `link_expiry_days` (1–90, por defecto 7) y deja de
  servir cuando la deuda queda saldada.

## Configuración

1. Aplicar `PROD_UPDATE_135.sql` (o
   `supabase/migrations/135_collection_payment_links.sql`) en Supabase.
2. Confirmar que `NEXT_PUBLIC_SITE_URL` apunta al dominio público
   (por ejemplo `https://nexusbpo.space`).
3. Ir a **Cobranza → Comprobantes**.
4. Cargar banco, cuenta, titular, pago móvil y WhatsApp de soporte. Guardar.
5. Activar el interruptor de enlaces de pago.
6. Generar un enlace de prueba con un deudor real y abrirlo en el móvil.
7. Reportar un comprobante de prueba y aprobarlo desde la bandeja.

## Límites conocidos

- No hay subida de imagen del comprobante todavía: se registran monto,
  referencia, banco y fecha. La columna `file_url` queda lista para cuando se
  configure el bucket y el OCR.
- El agente de IA de WhatsApp aún no captura comprobantes solo; este bloque
  cubre el enlace y la bandeja.
- El pago aprobado usa la fecha reportada por el deudor; si el banco confirma
  otra fecha, se corrige desde la carga de pagos.
- No se aplica IGTF en ventas a crédito desde el POS (pendiente aparte).

# Captura automática de comprobantes

> Bloque 136. El deudor manda la foto del pago por WhatsApp y el CRM la
> convierte en un comprobante **pendiente** con los datos leídos por OCR.
> Nadie aprueba pagos automáticamente: un admin revisa, corrige y aprueba.

## Qué resuelve

| Antes | Ahora |
|---|---|
| El deudor mandaba la foto y nadie la registraba hasta abrir el chat. | La imagen entra a la bandeja de comprobantes con monto, referencia, banco y fecha leídos. |
| El equipo copiaba los datos a mano y se equivocaba. | El OCR propone los datos; el admin los corrige antes de aprobar. |
| Un comprobante en bolívares se podía aprobar como si fuera USD. | Los pagos en VES se dejan en el chat para que un humano aplique la tasa. |
| El deudor no sabía si su foto había llegado. | Se le puede acusar recibo una sola vez, con un texto configurable. |

## Dos entradas, una salida

1. **Imagen o documento** en el chat de WhatsApp (Meta o Evolution):
   `captureInboundReceipt` descarga el archivo, lo lee con el proveedor de IA
   con visión y registra el comprobante con `capture_source = 'ocr'`.
2. **Texto del deudor** (“transferí 50 dólares, referencia 123456”): si el
   agente tiene activa la acción **Registrar comprobantes de pago**, ejecuta
   `register_receipt` y crea el comprobante con `capture_source = 'agent'`.

En ambos casos el comprobante nace `pending` y aparece en
**Cobranza → Comprobantes**. Aprobar sigue siendo la única vía para que el pago
entre a la cartera.

## Requisitos

- Un proveedor de IA con visión configurado en **Ajustes → Asistente de IA**:
  OpenAI, Gemini, Anthropic o Groq. DeepSeek no lee imágenes.
- El teléfono del chat debe pertenecer a un deudor de cobranza. Se busca por
  `collection_debtors.contact_id` y, si no hay vínculo, por teléfono con la
  misma tolerancia de la consola (últimos 10 dígitos). Cuando coincide, el
  vínculo queda guardado.
- La migración 136 aplicada.

Si falta el proveedor, el deudor puede seguir reportando el pago desde su
enlace público (`/pagar/<token>`), que no depende de OCR.

## Flujo interno

1. El webhook recibe la imagen y llama a `captureInboundReceipt` (best-effort:
   nunca tumba el webhook).
2. Se comprueban preferencias, deudor y proveedor con visión.
3. Se descarga el archivo del bucket o de WhatsApp/Evolution y se corrige el
   MIME por firma (PNG, JPEG, WEBP, GIF).
4. `ocrReceipt` pide al modelo un JSON estricto. Si el modelo no responde o
   devuelve basura, se registra el motivo y no se crea nada.
5. Si `is_receipt` es falso, no hay monto legible o la moneda es VES, se omite.
6. `collection_receipt_capture` inserta en `pending`, con idempotencia por
   `(account_id, source_message_id)`.
7. Si el acuse está activo y el hilo **no** tiene un humano asignado, se envía
   el texto de acuse al deudor.

## Reglas de seguridad

- La IA nunca aprueba ni aplica pagos. Todo entra `pending`.
- Solo se captura si el teléfono pertenece a un deudor de la cuenta.
- Un mensaje de WhatsApp genera como máximo un comprobante.
- Solo se capturan montos en USD o sin moneda legible. Un comprobante en
  bolívares se queda en el chat para corrección humana con tasa.
- El OCR no inventa: los campos ilegibles quedan `NULL`.
- Corregir y aprobar exige admin/owner.
- La corrección solo aplica mientras el comprobante está `pending`.
- El acuse no se envía si el hilo ya fue tomado por una persona.

## Panel

En **Cobranza → Comprobantes**:

- La bandeja muestra **Origen** (`OCR de WhatsApp`, `Agente de IA`, `Enlace de
  pago`, `Manual`), la confianza del OCR y un acceso a la imagen firmada.
- El diálogo de revisión permite corregir **monto, referencia, banco y fecha**
  antes de aprobar. La corrección se guarda y se aplica en la misma acción.
- El panel **Captura automática por WhatsApp** muestra el estado real del
  proveedor (si lee imágenes o no) y permite apagar la captura, apagar el
  acuse y editar su texto.

## Variables de la captura

| Preferencia | Por defecto | Efecto |
|---|---|---|
| `receipt_capture_enabled` | `true` | Lee imágenes de deudores y registra comprobantes. |
| `receipt_ack_enabled` | `true` | Responde al deudor cuando el comprobante quedó capturado. |
| `receipt_ack_text` | Texto estándar | Admite `{{deudor}}`, `{{monto}}` y `{{referencia}}`. |

La acción del agente se activa por separado en la ficha del agente:
**Acciones → Registrar comprobantes de pago** (`ai_agents.action_receipts`).

## Cómo probarlo

1. Aplicar `PROD_UPDATE_136.sql` en Supabase.
2. Confirmar que el negocio tiene proveedor con visión.
3. Abrir el chat de un deudor real desde un número de prueba.
4. Enviar la foto de una transferencia en USD con monto y referencia legibles.
5. Verificar que aparece en **Cobranza → Comprobantes** como `OCR de WhatsApp`
   y en estado **Pendiente**.
6. Corregir cualquier dato mal leído y aprobar.
7. Confirmar que la cuota, el crédito y el saldo del deudor bajaron.
8. Repetir con una imagen que no sea comprobante: no debe crear nada.
9. Repetir con un comprobante en bolívares: debe quedar en el chat, no en la
   bandeja.

## Límites conocidos

- El OCR depende del proveedor: una foto borrosa o con brillo puede devolver
  `null` en monto o referencia. Es preferible corregir a aprobar un dato falso.
- La fecha del pago se limita a los últimos 90 días (misma regla del enlace
  público).
- Un comprobante en VES no se convierte automáticamente: falta una tasa de
  cambio confiable por negocio.
- Si el webhook reintenta el mismo mensaje sin `message_id`, la idempotencia
  por mensaje no aplica; el índice por referencia + monto sigue protegiendo
  los duplicados con referencia legible.
- El acuse es texto libre por WhatsApp; no usa plantilla aprobada porque es
  una respuesta dentro de la ventana de conversación.

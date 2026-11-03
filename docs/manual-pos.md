# Manual y curso del NEXUS POS

Guía de operación y capacitación para el punto de venta.
Versión: noviembre 2026 · Moneda base USD · Zona horaria `America/Caracas`

---

## 0. Cómo pensar el POS (5 minutos)

El POS no es una caja aparte: es un módulo dentro del mismo NEXUS CRM, con el
mismo inicio de sesión y la misma base de datos. Lo que cambia es el trabajo:
aquí se cobra, se controla el inventario y se cierra la caja del día.

Cinco ideas que ordenan todo lo demás:

1. **Dos monedas, una sola verdad.** Los precios y los totales viven en USD.
   Los bolívares se calculan con la tasa del día. La tasa se actualiza desde el
   botón de moneda en la barra superior (BCV o manual).
2. **Caja y turno son lo mismo.** Un turno abierto pertenece a una caja. Cada
   caja tiene su propio arqueo; el inventario es compartido entre todas.
3. **El stock se mueve solo, pero se corrige a mano.** Vender descuenta, comprar
   suma, devolver ajusta según lo que elijas. Los ajustes son para diferencias
   reales, no para "cuadrar" números.
4. **La utilidad no es la plata en la cuenta.** La utilidad de caja es lo que
   entró menos lo que salió. La utilidad real además descuenta los gastos fijos
   del mes que todavía no has pagado.
5. **Cada número tiene un documento detrás.** Venta, compra, ajuste, devolución,
   gasto y transferencia generan un registro. Si algo no cuadra, se corrige con
   el documento correcto, no borrando.

### Roles

| Rol | Qué puede hacer en el POS |
|---|---|
| Dueño | Todo, incluida la bitácora y los usuarios |
| Administrador | Configuración, catálogo, compras, finanzas, cierres |
| Agente | Vender, consultar, abrir y cerrar su caja |
| Visor | Solo consulta, sin modificar nada |

> Los contactos del POS son **clientes del POS** y no se mezclan con los
> contactos del CRM. Un cliente del POS no aparece en Campañas ni en la bandeja.

---

## Módulo 1 — Puesta en marcha

**Objetivo:** dejar el negocio listo para cobrar el primer ticket.

### 1.1 Ajustes → Negocio

Completa razón social, RIF, dirección, teléfono y los datos del recibo. El
título y el pie del recibo son lo que verá el cliente al imprimir.

### 1.2 Ajustes → Moneda

- Revisa la tasa del día. Puedes traerla del BCV o escribirla a mano.
- La tasa queda guardada en cada venta: si mañana cambia, los tickets de hoy no
  se recalculan.

### 1.3 Ajustes → Impuestos

| Impuesto | Valor por defecto | Cuándo aplica |
|---|---|---|
| IVA | 16 % | Por línea, solo en productos marcados como gravables |
| IGTF | 3 % | Solo sobre pagos en divisa (Efectivo USD y Zelle) |

El IVA se calcula por línea, no sobre el total. Un producto exento se marca al
crearlo en el catálogo. El IGTF no es un impuesto al producto: es al medio de
pago, por eso aparece al final y solo si cobras en dólares.

### 1.4 Ajustes → Usuarios y roles

Invita a cada cajero con su propio correo. No compartas la cuenta del dueño: la
bitácora necesita saber quién hizo cada cosa.

### 1.5 Abrir la caja

**Turnos → Abrir turno**. Elige la caja, escribe el fondo inicial (el efectivo
con el que arrancas) y, si quieres, cuenta los billetes por denominación.

> Sin turno abierto puedes vender, pero la venta no entra al arqueo. El POS te
> avisa con una franja amarilla en **Vender**.

**Ejercicio 1.** Configura el negocio, deja la tasa del día y abre la caja con
un fondo de $20 y Bs 500. Cierra sesión y vuelve a entrar: la barra superior
debe mostrar tu caja abierta.

---

## Módulo 2 — Catálogo

**Objetivo:** que cada producto tenga precio, costo y stock correctos.

Ruta: **Catálogo**, con cinco pestañas.

### 2.1 Productos

Cada producto tiene:

- Nombre, SKU y código de barras (el buscador de Vender acepta los tres).
- Categoría y unidad (unidad, kg, litro, caja…).
- **Costo** y **precio de venta** en USD.
- **Controla inventario**: si lo desactivas, el producto se vende sin descontar
  stock (servicios, por ejemplo).
- **Gravable**: si está activo, la línea lleva IVA.
- **Variantes**: tallas, colores u otra combinación. Cada variante puede tener su
  propio SKU y su propio stock.

### 2.2 Precios (listas)

Puedes tener una lista **Principal** y otra **Mayorista**, además de listas
propias. El precio de la lista manda sobre el precio del producto cuando la
seleccionas en la venta.

### 2.3 Categorías

Sirven para los informes por categoría y para ordenar el catálogo.

### 2.4 Descuentos

Se crean con un **código** (por ejemplo `VERANO10`), un tipo (porcentaje o monto
fijo) y una vigencia. En Vender se aplican escribiendo el código.

### 2.5 Recargos

Cargos adicionales que se suman al total (envío, servicio, etc.). Se eligen
durante la venta y quedan registrados en el ticket.

**Ejercicio 2.** Crea un producto gravable con costo $4 y precio $10, otro
exento, y una variante con stock propio. Crea el descuento `VERANO10` al 10 %.

---

## Módulo 3 — Vender (el corazón del POS)

**Objetivo:** cobrar rápido, sin errores, con pagos mixtos.

Ruta: **Ventas → Vender**.

### 3.1 Armar la venta

1. Busca por nombre, SKU o código de barras. Si tienes lector, el código entra
   solo.
2. Ajusta la cantidad con los botones de la línea.
3. Si aplica, cambia el precio de la línea o ponle un descuento puntual.
4. Elige el **cliente**: por defecto es **Consumidor final**. Solo hace falta
   registrarlo si quieres historial o crédito.
5. Elige la **lista de precios** y el **canal de venta** (Tienda, Delivery u
   otro) cuando corresponda.

### 3.2 Descuento y recargos

- Escribe el código de descuento y verás el monto aplicado antes del IVA.
- Marca los recargos que correspondan; se suman después del IVA.

### 3.3 Leer el resumen

| Línea | Qué significa |
|---|---|
| Subtotal | Suma de las líneas antes de impuestos |
| Descuento | Lo que quita el código aplicado |
| IVA (16 %) | Impuesto por línea gravable |
| Recargos | Cargos adicionales elegidos |
| IGTF (3 % divisas) | Solo sobre la parte cobrada en USD o Zelle |
| **Total** | Lo que debe pagar el cliente |

### 3.4 Cobrar

1. Pulsa **+ Método** para dividir el pago.
2. Elige el método: **Efectivo USD, Zelle, Efectivo Bs, Pago Móvil,
   Transferencia Bs o Punto de venta**.
3. Escribe el monto. Si es en bolívares, se convierte con la tasa del día.
4. En efectivo puedes escribir **solo lo recibido** y dejar el monto vacío: el
   POS aplica lo necesario y calcula el **vuelto**.
5. Repite hasta cubrir el total. La franja amber te dice cuánto falta.
6. Pulsa **Cobrar**. Se abre el recibo para imprimir o compartir.

Si el cliente no paga todo:

7. Elige el **cliente** en el buscador (puedes crearlo ahí mismo con
   **Crear «nombre»**).
8. Marca **Dejar saldo a crédito**. El botón cambia a **Cobrar $X y fiar $Y**
   (o **Fiar $Y** si no deja abono).
9. La venta queda con estado **A crédito** y el saldo aparece en
   **Finanzas → Pendientes** y en el recibo.

Reglas que el POS aplica y conviene explicar al cajero:

- No se puede dejar saldo sin un cliente: el POS lo exige para poder cobrarlo
  después.
- No se puede cobrar de más: usa **Cobrar exacto** y anota el recibido para el
  vuelto.
- Si cobras en bolívares, la tasa debe existir. Sin tasa, el POS no deja cobrar
  en Bs.
- El IGTF se calcula solo sobre los métodos en divisa, nunca sobre Pago Móvil o
  Punto de venta.

### 3.5 Atajos de teclado

| Tecla | Acción |
|---|---|
| `F2` | Ir al buscador de productos |
| `F3` | Ir al código de descuento |
| `F4` | Cobrar |
| `F8` | Cobrar exacto |
| `Esc` | Cerrar el buscador de clientes o limpiar la búsqueda |

**Ejercicio 3.** Cobra un ticket de $30 con IVA incluido: paga $10 en efectivo,
$10 por Zelle y el resto en Pago Móvil. Verifica en el resumen que el IGTF solo
aparece sobre los $20 en divisa.

**Ejercicio 3b.** Crea un cliente desde el buscador, cóbrale solo la mitad y
deja el resto a crédito. Verifica el saldo en **Finanzas → Pendientes** y
cóbralo después.

---

## Módulo 4 — Turnos y arqueo

**Objetivo:** cerrar la caja con números que se puedan explicar.

Ruta: **Turnos**.

### 4.1 Abrir

- Elige la caja (si tienes varias).
- Registra el fondo inicial.
- Opcional: cuenta los billetes por denominación; el POS suma solo.

### 4.2 Durante el turno

La pantalla muestra en vivo:

- Ventas del turno y número de tickets.
- Efectivo esperado en USD y en Bs.
- Cobros, devoluciones y transferencias que afectan la caja.

### 4.3 Cerrar

1. Pulsa **Cerrar turno**.
2. Cuenta el efectivo real: **dólares** y **bolívares** por separado.
3. El POS calcula la **diferencia** contra lo esperado.
4. Escribe quién entrega y las observaciones.
5. Guarda e imprime el cierre si lo necesitas.

> Una diferencia no se "arregla" con un ajuste de inventario. Se documenta en
> el cierre y se investiga: cambio mal dado, venta no registrada, retiro sin
> soporte.

**Ejercicio 4.** Haz tres ventas, una de ellas en Bs, y cierra el turno contando
el efectivo. Provoca una diferencia de $1 a propósito y explica en observaciones
por qué.

---

## Módulo 5 — Inventario

**Objetivo:** que el stock del sistema coincida con el del depósito.

Ruta: **Inventario**.

### 5.1 Lo que ves arriba

- Valor del inventario **a costo** y **a precio de venta**.
- **Margen potencial**: la ganancia si se vende todo.
- Productos **bajo el mínimo**.

### 5.2 Compras

**Compras → Nueva compra**. Registra proveedor, documentos, fecha, líneas y
costo. Puede ser:

- **De contado**: sale dinero de una cuenta.
- **A crédito**: queda un saldo por pagar con fecha de vencimiento. Aparece en
  **Finanzas → Pendientes** y en la antigüedad por pagar de Informes.

Recibir una compra **suma stock** y actualiza el costo del producto.

### 5.3 Devoluciones a proveedor

Devuelven mercancía y **restan stock**. Úsalas cuando el proveedor se lleva
producto dañado o equivocado.

### 5.4 Ajustes de inventario

Sirven para diferencias reales: conteo físico, merma, rotura, pérdida. El ajuste
deja un documento con motivo; no es un botón para "cuadrar".

**Ejercicio 5.** Registra una compra de 10 unidades a crédito, vende 3, haz un
ajuste de -1 por rotura y verifica el stock final y el saldo por pagar.

---

## Módulo 6 — Historial, devoluciones y cobros

**Objetivo:** resolver posventa sin romper la caja ni el inventario.

Ruta: **Ventas → Historial**.

### 6.1 Historial

Filtra por período y busca por número o estado. Cada venta muestra total, saldo,
devoluciones e informe fiscal. Desde aquí se abre el recibo, se devuelve, se
factura o se emite una nota de crédito.

### 6.2 Devolución al cliente

1. Abre la venta y pulsa **Devolver**.
2. Elige los productos y cantidades.
3. Escribe el **motivo** (obligatorio).
4. Decide si **repone al inventario**:
   - **Sí**: el producto vuelve a stock y su costo sale del costo de ventas.
   - **No**: el producto no vuelve (está dañado) y el costo se queda en el
     costo de ventas, para que la utilidad no se vea mejor de lo que es.
5. Elige cómo se devuelve el dinero:
   - **Cuenta**: sale dinero de una cuenta y afecta el turno.
   - **Nota de crédito**: no sale dinero; queda como saldo a favor.

> Si la venta tiene saldo pendiente, la devolución debe ser nota de crédito.

### 6.3 Cobrar un saldo

**Finanzas → Pendientes** (o el detalle de la venta): elige la venta, el monto,
el método y la cuenta. El saldo baja y el cobro entra al turno si es efectivo.

**Ejercicio 6.** Devuelve 1 unidad de una venta de 3, sin reponer stock, y
explica qué pasa con el inventario y con la utilidad.

---

## Módulo 7 — Finanzas

**Objetivo:** saber dónde está el dinero y qué se debe.

Ruta: **Finanzas**, con seis pestañas.

| Pestaña | Para qué sirve |
|---|---|
| Cuentas | Efectivo, banco, Pago Móvil, Zelle. Cada una con su moneda |
| Movimientos | Entradas y salidas de cada cuenta |
| Transferencias | Mover dinero entre cuentas de la misma moneda |
| Gastos | Gastos reales pagados |
| Gastos fijos | Presupuesto mensual: alquiler, sueldos, servicios |
| Pendientes | Ventas a crédito por cobrar y compras a crédito por pagar |

### 7.1 Gastos fijos

No son movimientos: son un **presupuesto mensual**. Cuando pagas uno, el POS
crea el gasto real y guarda la fecha. Así el informe sabe cuánto falta por pagar
del mes.

### 7.2 Punto de equilibrio

Con los gastos fijos del mes y tu margen bruto, el POS calcula cuánto necesitas
vender por día para cubrirlos. Si el ritmo actual supera esa meta, el negocio
está cubierto.

**Ejercicio 7.** Crea la cuenta "Banco" en Bs, registra el alquiler como gasto
fijo mensual y págalo. Revisa cómo cambia el punto de equilibrio.

---

## Módulo 8 — Informes

**Objetivo:** leer el negocio sin hoja de cálculo.

Ruta: **Informes**. Períodos: **Este mes**, **Mes anterior** y **Últimos 30
días**.

### 8.1 La cascada del resultado

```
Ventas netas
− Costo de lo vendido
= Utilidad bruta
− Gastos pagados
− Pérdidas de inventario
− Gastos fijos pendientes del período
= Utilidad real
```

- **Utilidad de caja**: lo que realmente pasó por caja.
- **Utilidad real**: la de caja menos los fijos del mes que aún no has pagado.
  No cuenta dos veces los que ya pagaste.

### 8.2 Bloques del informe

- Ventas por canal, lista de precios, cliente, usuario, forma de pago y
  categoría.
- Productos más y menos vendidos.
- Mapa de calor por día y hora (hora de Venezuela).
- Inventario: valor a costo y a venta, margen potencial, bajo mínimo, rotación.
- Finanzas: saldos por cuenta, por cobrar, por pagar y antigüedad.
- Resultados por mes (últimos 12 meses), independiente del período elegido.

**Ejercicio 8.** Compara este mes con el anterior. Identifica el canal que más
vende y el producto con peor rotación. Explica la diferencia entre utilidad de
caja y utilidad real con tus números.

---

## Módulo 9 — Facturación fiscal

**Objetivo:** emitir facturas y notas de crédito con numeración controlada.

Ruta: **Facturación**.

1. Activa la facturación fiscal solo si tienes máquina o proveedor autorizado.
2. Carga razón social, RIF, dirección fiscal, máquina, rango autorizado, prefijo
   y siguiente número.
3. Configura el rango de notas de crédito.
4. Desde **Historial**, factura una venta. El número se asigna dentro del rango.
5. Para anular total o parcialmente, emite una **nota de crédito**.

> Si no tienes proveedor fiscal certificado, deja la facturación desactivada. El
> POS sigue emitiendo recibos normales.

---

## Módulo 10 — Contactos del POS

Ruta: **Contactos**.

Son los clientes del punto de venta: nombre, documento/RIF, teléfono, correo,
dirección y notas. Sirven para el historial de compras y para las ventas a
crédito. **No** se mezclan con los contactos del CRM.

---

## Módulo 11 — Rutina diaria y errores comunes

### Antes de abrir

- [ ] Tasa del día revisada.
- [ ] Caja abierta con fondo contado.
- [ ] Impresora y lector probados.
- [ ] Productos del día con stock y precio correctos.

### Durante el día

- [ ] Cada venta con su método de pago real.
- [ ] El vuelto anotado cuando se paga en efectivo.
- [ ] Devoluciones con motivo y decisión de stock.
- [ ] Compras y gastos registrados el mismo día.

### Al cerrar

- [ ] Conteo de efectivo en USD y Bs por separado.
- [ ] Diferencia explicada en observaciones.
- [ ] Cierre impreso o guardado.
- [ ] Gastos fijos del mes revisados.

### Errores comunes y qué hacer

| Síntoma | Causa habitual | Solución |
|---|---|---|
| El botón Cobrar no responde | Falta cubrir el total | Revisa "Falta por cubrir" o marca "Dejar saldo a crédito" |
| No deja fiar | Falta elegir cliente | Búscalo o créalo en el mismo selector |
| "Configura la tasa del día" | Cobro en Bs sin tasa | Actualiza la tasa arriba |
| El IGTF sale en cero | Todo se cobró en Bs | Es correcto: el IGTF es solo divisa |
| El stock no coincide | Ventas sin control de inventario, merma no registrada | Ajuste con motivo |
| La utilidad real es menor | Fijos del mes aún no pagados | Es correcto, así se mide |
| No aparece el turno | Caja cerrada | Abrir turno |
| Una venta no entra al arqueo | Se cobró sin turno abierto | Registrar el turno a tiempo |

---

## Plan de capacitación (4 sesiones)

| Sesión | Duración | Contenido | Práctica |
|---|---|---|---|
| 1 | 90 min | Módulos 0, 1 y 2 | Configurar negocio, tasa, impuestos, catálogo y abrir caja |
| 2 | 90 min | Módulo 3 | 10 ventas guiadas: simple, mixta, Bs, descuento, recargo, vuelto y una venta a crédito con abono parcial |
| 3 | 90 min | Módulos 4, 5 y 6 | Turno completo, compra, ajuste, devolución con y sin stock |
| 4 | 90 min | Módulos 7, 8 y 9 | Gastos fijos, punto de equilibrio, lectura de informes, factura |

### Evaluación práctica (aprueba con 8/10)

1. Abrir caja con fondo y tasa correctos.
2. Cobrar un ticket mixto con IVA e IGTF bien calculados.
3. Dar vuelto exacto en dos monedas.
4. Cerrar turno y explicar una diferencia.
5. Registrar una compra a crédito.
6. Hacer una devolución sin reponer stock y explicar el efecto en la utilidad.
7. Aplicar un descuento por código.
8. Emitir un recibo y una factura fiscal.
9. Explicar la diferencia entre utilidad de caja y utilidad real.
10. Encontrar un producto bajo el mínimo y justificar la reposición.

### Guion para el facilitador

- Empieza por una venta real, no por la teoría. El cajero entiende el POS
  cobrando.
- Una sola idea por bloque: "primero cobramos, después ordenamos".
- Haz que el participante explique en voz alta lo que ve en el resumen antes de
  pulsar Cobrar.
- Cierra cada sesión con un error provocado a propósito y su corrección.

---

## Glosario

| Término | Significado |
|---|---|
| Turno | Período de trabajo de una caja, desde la apertura hasta el cierre |
| Arqueo | Conteo y comparación del efectivo real contra lo esperado |
| Fondo | Efectivo con el que se abre la caja |
| IGTF | Impuesto del 3 % sobre pagos en divisa |
| IVA | Impuesto del 16 % sobre productos gravables |
| Utilidad de caja | Ingresos cobrados menos gastos pagados |
| Utilidad real | Utilidad de caja menos fijos del período aún no pagados |
| Lista de precios | Conjunto de precios (Principal, Mayorista, etc.) |
| Canal de venta | Origen de la venta (Tienda, Delivery, etc.) |
| Nota de crédito | Documento que anula total o parcialmente una venta, sin sacar dinero |

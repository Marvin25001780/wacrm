# Plan técnico — Módulo de Cobranza

**Versión:** 1.0  
**Fecha:** 2026-10-22  
**Rama propuesta:** `feat/cobranza` (desde `main`)  
**Estado:** plan aprobado para iniciar Fase 1  
**Documento relacionado:** `src/app/(dashboard)/receivables/*` (módulo actual de cuentas por cobrar)

---

## 1. Objetivo

Convertir el actual grupo de navegación **Finanzas** en **Cobranza** y construir un módulo operativo de recuperación de cartera con cuatro motores:

1. **Entrada y datos:** importación masiva Excel/CSV, relación deudor → crédito → cuota, mapeo y validación.
2. **Inteligencia y enrutamiento:** priorización por reglas, segmentación por tramo, ventana horaria y cola del gestor.
3. **Estación de trabajo:** ficha 360, selección de cuotas, guion, tipificación obligatoria y acuerdos de pago (PTP).
4. **Control y seguimiento:** pipeline, políticas por tramo, reportes, comisiones y auditoría.

### Decisiones cerradas

| Tema | Decisión |
|---|---|
| Moneda | **USD** en todo el módulo. Se conserva la columna `currency` por compatibilidad, pero validada a `USD`. |
| País / zona horaria | **Venezuela** (`VE`, `America/Caracas`). Los teléfonos locales se normalizan a `+58`. |
| Telefonía | **Fuera de alcance.** No hay PBX, WebRTC, marcador automático, grabación ni detección de buzón. |
| Detección de buzón | **Fuera de alcance** hasta integrar un proveedor con AMD. |
| Motor de prioridad | **Reglas transparentes**, no ML. El ML se evalúa cuando existan 6–12 meses de datos. |
| UI | Se mantiene el tema oscuro, tokens y componentes actuales. No se copian colores, fuentes ni iconos Material del mockup. |
| Búsqueda global | **No** se agrega al header. Cada módulo tiene su filtro local. |
| Rutas | Módulo nuevo en `/cobranza/*`. `/receivables` se conserva y luego se redirige o archiva. |
| Multi-tenant | Todas las tablas llevan `account_id` + RLS por `is_account_member`. |

### Fuera de alcance (v1)

- Marcador telefónico, WebRTC, Asterisk, Twilio, AMD.
- Pasarela de pagos y links SPEI/Stripe/Conekta.
- Conciliación bancaria automática.
- Scoring con machine learning.
- Multimoneda.
- Firma digital de convenios.

---

## 2. Arquitectura de información

```
Cobranza
├── Panel de cobranza        /cobranza
├── Cartera y deudores       /cobranza/cartera
│   └── Ficha 360            /cobranza/cartera/[debtorId]
├── Pipeline                 /cobranza/pipeline
├── Consola del gestor       /cobranza/consola
├── Acuerdos de pago         /cobranza/acuerdos
├── Carga masiva             /cobranza/importar
├── Reportes                 /cobranza/reportes
└── Políticas y ajustes      /cobranza/configuracion
```

Comportamiento del botón en el sidebar:

- **Click en “Cobranza”** → abre el panel hub.
- **Click en el chevron** → despliega el submenú.
- El sidebar ya soporta submenús (`src/components/layout/sidebar.tsx`), así que solo cambia `src/lib/nav.ts`.

### Navegación propuesta

```ts
const cobranzaNav: NavItem = {
  href: "/cobranza",
  label: "Cobranza",
  icon: HandCoins,
  minRole: "admin",
  children: [
    { href: "/cobranza", label: "Panel", icon: LayoutDashboard, minRole: "admin" },
    { href: "/cobranza/cartera", label: "Cartera", icon: Users, minRole: "admin" },
    { href: "/cobranza/pipeline", label: "Pipeline", icon: Kanban, minRole: "admin" },
    { href: "/cobranza/consola", label: "Consola del gestor", icon: Headset, minRole: "agent" },
    { href: "/cobranza/acuerdos", label: "Acuerdos de pago", icon: Handshake, minRole: "admin" },
    { href: "/cobranza/importar", label: "Carga masiva", icon: Upload, minRole: "admin" },
    { href: "/cobranza/reportes", label: "Reportes", icon: BarChart3, minRole: "admin" },
    { href: "/cobranza/configuracion", label: "Políticas", icon: Settings2, minRole: "admin" },
  ],
};
```

El ítem anterior `finanzasNav` se reemplaza por este. `/receivables` queda accesible por URL directa durante la transición.

---

## 3. Modelo de datos

### Convenciones

- `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`.
- `account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE`.
- `created_at` / `updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`.
- Trigger `set_updated_at` en todas las tablas editables.
- RLS: `SELECT` con `is_account_member(account_id)`; `INSERT/UPDATE` con `is_account_member(account_id, 'agent')`; `DELETE` con `is_account_member(account_id, 'admin')`.
- `GRANT SELECT, INSERT, UPDATE, DELETE ... TO authenticated` y `GRANT ALL ... TO service_role`.

### 3.1 `collection_settings`

Configuración por cuenta.

```sql
CREATE TABLE collection_settings (
  account_id UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  country_code TEXT NOT NULL DEFAULT 'VE',   -- ISO-2; esta instalación opera en Venezuela
  timezone TEXT NOT NULL DEFAULT 'America/Caracas',
  currency TEXT NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
  business_hours_start TIME NOT NULL DEFAULT '09:00',
  business_hours_end   TIME NOT NULL DEFAULT '18:00',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Normalización de teléfonos (Venezuela):**

- Prefijo país: `+58`.
- Móviles: `412`, `414`, `415`, `416`, `424`, `426` + 7 dígitos → `+58` + 10 dígitos.
- Fijos: código de área `2xx` + 7 dígitos → `+58` + 10 dígitos.
- Se aceptan formatos `0414-1234567`, `4141234567`, `+58 414 1234567`, `0058 414...`.
- Se usa `libphonenumber-js` con región `VE`; si el número no es válido, la fila queda en advertencia y se guarda el valor crudo para corrección manual.
- Los números que ya vienen en `+E.164` se respetan.

**Seed:** `collection_seed_account_defaults(p_account_id UUID)` crea la fila de settings (si falta), las 5 políticas por tramo, las tipificaciones base y las reglas de comisión en cero. Se llama desde un trigger `AFTER INSERT ON accounts` y se ejecuta para todas las cuentas existentes en la migración 078. Para esta instalación, el seed usa `VE` / `America/Caracas`.

### 3.2 `collection_portfolios`

Agrupa una cartera cargada (ej. “Cartera agosto 2026”).

```sql
CREATE TABLE collection_portfolios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  source TEXT NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual','excel','csv','api')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('draft','active','archived')),
  currency TEXT NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_collection_portfolios_account
  ON collection_portfolios(account_id, status);
```

### 3.3 `collection_debtors`

Una fila por deudor. Nunca una fila por cuota.

```sql
CREATE TABLE collection_debtors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  portfolio_id UUID REFERENCES collection_portfolios(id) ON DELETE SET NULL,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  document_type TEXT
    CHECK (document_type IN ('dni','cedula','rfc','passport','other')),
  document_number TEXT,
  name TEXT NOT NULL,
  phone_primary TEXT,
  phone_secondary TEXT,
  email TEXT,
  address TEXT,
  city TEXT,
  country TEXT,
  segment TEXT NOT NULL DEFAULT 'preventiva'
    CHECK (segment IN ('preventiva','temprana','media','tardia','critica')),
  status TEXT NOT NULL DEFAULT 'nuevo'
    CHECK (status IN ('nuevo','contactado','negociacion','acuerdo','pagado','ilocalizable','juridico')),
  assigned_to UUID REFERENCES profiles(id) ON DELETE SET NULL,
  priority_score NUMERIC(5,2) NOT NULL DEFAULT 0
    CHECK (priority_score >= 0 AND priority_score <= 100),
  priority_reason TEXT,
  priority_updated_at TIMESTAMPTZ,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_collection_debtors_document
  ON collection_debtors(account_id, document_number)
  WHERE document_number IS NOT NULL;

CREATE INDEX idx_collection_debtors_account_status
  ON collection_debtors(account_id, status);
CREATE INDEX idx_collection_debtors_account_segment
  ON collection_debtors(account_id, segment);
CREATE INDEX idx_collection_debtors_phone
  ON collection_debtors(account_id, phone_primary);
CREATE INDEX idx_collection_debtors_assigned
  ON collection_debtors(account_id, assigned_to);
```

### 3.4 `collection_credits`

Un deudor puede tener N créditos.

```sql
CREATE TABLE collection_credits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  debtor_id UUID NOT NULL REFERENCES collection_debtors(id) ON DELETE CASCADE,
  portfolio_id UUID REFERENCES collection_portfolios(id) ON DELETE SET NULL,
  folio TEXT NOT NULL,
  product TEXT,
  currency TEXT NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
  principal NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (principal >= 0),
  interest NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (interest >= 0),
  late_fee NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (late_fee >= 0),
  total NUMERIC(14,2) GENERATED ALWAYS AS (principal + interest + late_fee) STORED,
  opened_at DATE,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','paid','restructured','legal','cancelled')),
  legacy_receivable_id UUID UNIQUE,           -- migración desde receivables
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_collection_credits_folio
  ON collection_credits(account_id, folio);

CREATE INDEX idx_collection_credits_debtor
  ON collection_credits(debtor_id, status);
```

### 3.5 `collection_installments`

Cada cuota es una fila. `paid_amount` y `status` los mantiene un trigger.

```sql
CREATE TABLE collection_installments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  credit_id UUID NOT NULL REFERENCES collection_credits(id) ON DELETE CASCADE,
  debtor_id UUID NOT NULL REFERENCES collection_debtors(id) ON DELETE CASCADE,
  number INTEGER NOT NULL CHECK (number > 0),
  due_date DATE NOT NULL,
  principal NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (principal >= 0),
  interest NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (interest >= 0),
  late_fee NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (late_fee >= 0),
  total NUMERIC(14,2) GENERATED ALWAYS AS (principal + interest + late_fee) STORED,
  paid_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','partial','paid','cancelled')),
  paid_at DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_collection_installments_number
  ON collection_installments(credit_id, number);

CREATE INDEX idx_collection_installments_due
  ON collection_installments(account_id, due_date, status);
CREATE INDEX idx_collection_installments_debtor
  ON collection_installments(debtor_id, status);
```

**Estado vencido:** no se almacena. Se deriva en vistas y consultas:

```sql
status IN ('pending','partial') AND due_date < CURRENT_DATE
```

**Consistencia de `debtor_id`:** está denormalizado para acelerar la cartera. Se valida con un trigger `BEFORE INSERT OR UPDATE` que copia `debtor_id` desde `collection_credits` y rechaza si no coincide. Así se evita que una cuota quede apuntando a otro deudor.

### 3.6 `collection_payments`

```sql
CREATE TABLE collection_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  installment_id UUID NOT NULL REFERENCES collection_installments(id) ON DELETE CASCADE,
  credit_id UUID NOT NULL REFERENCES collection_credits(id) ON DELETE CASCADE,
  debtor_id UUID NOT NULL REFERENCES collection_debtors(id) ON DELETE CASCADE,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  paid_at DATE NOT NULL DEFAULT CURRENT_DATE,
  method TEXT CHECK (method IN ('cash','transfer','card','check','other')),
  reference TEXT,
  source TEXT NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual','import','link','adjustment')),
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_collection_payments_installment
  ON collection_payments(installment_id);
CREATE INDEX idx_collection_payments_account_date
  ON collection_payments(account_id, paid_at);
```

**Decisión v1:** un pago aplica a una cuota. Si el cliente paga varias cuotas, la UI crea N filas con la misma `reference` dentro de una transacción. La tabla de asignaciones (`collection_payment_allocations`) queda para v2 si aparece la necesidad de prorratear un pago entre cuotas.

### 3.7 `collection_outcomes`

Catálogo de tipificaciones. Filas del sistema (`account_id IS NULL`) + overrides por cuenta.

```sql
CREATE TABLE collection_outcomes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID REFERENCES accounts(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  label TEXT NOT NULL,
  level SMALLINT NOT NULL CHECK (level IN (1,2,3)),
  parent_code TEXT,
  requires_amount BOOLEAN NOT NULL DEFAULT FALSE,
  requires_date BOOLEAN NOT NULL DEFAULT FALSE,
  requires_reason BOOLEAN NOT NULL DEFAULT FALSE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_collection_outcomes_code
  ON collection_outcomes(COALESCE(account_id, '00000000-0000-0000-0000-000000000000'::uuid), code);
```

Semilla v1:

| Nivel | code | label |
|---|---|---|
| 1 | `contacted` | Contacto titular |
| 1 | `third_party` | Contacto tercero |
| 1 | `no_contact` | Sin contacto / buzón |
| 1 | `wrong_number` | Número erróneo |
| 2 | `ptp` | Promesa de pago |
| 2 | `refusal` | Negativa de pago |
| 2 | `restructure` | Reestructuración |
| 2 | `callback` | Llamar más tarde |
| 2 | `payment` | Pago realizado |
| 3 | `ptp_detail` | Detalle de PTP (monto + fecha) |
| 3 | `refusal_reason` | Motivo de negativa |

### 3.8 `collection_actions`

Cada gestión del agente. Es la fuente de contactabilidad, historial y productividad.

```sql
CREATE TABLE collection_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  debtor_id UUID NOT NULL REFERENCES collection_debtors(id) ON DELETE CASCADE,
  credit_id UUID REFERENCES collection_credits(id) ON DELETE SET NULL,
  installment_id UUID REFERENCES collection_installments(id) ON DELETE SET NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  channel TEXT NOT NULL DEFAULT 'call'
    CHECK (channel IN ('call','whatsapp','sms','email','visit','other')),
  direction TEXT NOT NULL DEFAULT 'outbound'
    CHECK (direction IN ('outbound','inbound')),
  level1_code TEXT NOT NULL,
  level2_code TEXT,
  notes TEXT,
  call_duration_seconds INTEGER CHECK (call_duration_seconds >= 0),
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  promise_id UUID,                            -- FK se añade tras crear collection_promises
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_collection_actions_debtor
  ON collection_actions(debtor_id, created_at DESC);
CREATE INDEX idx_collection_actions_user
  ON collection_actions(account_id, user_id, created_at DESC);
CREATE INDEX idx_collection_actions_contactability
  ON collection_actions(account_id, level1_code, created_at DESC);
```

No se guarda `result_label`; el label se resuelve contra `collection_outcomes` al renderizar.

### 3.9 `collection_promises`

```sql
CREATE TABLE collection_promises (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  debtor_id UUID NOT NULL REFERENCES collection_debtors(id) ON DELETE CASCADE,
  credit_id UUID NOT NULL REFERENCES collection_credits(id) ON DELETE CASCADE,
  action_id UUID REFERENCES collection_actions(id) ON DELETE SET NULL,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  due_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','kept','partial','broken','cancelled')),
  paid_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  channel TEXT,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

ALTER TABLE collection_actions
  ADD CONSTRAINT collection_actions_promise_fk
  FOREIGN KEY (promise_id) REFERENCES collection_promises(id) ON DELETE SET NULL;

CREATE INDEX idx_collection_promises_due
  ON collection_promises(account_id, due_date, status);
CREATE INDEX idx_collection_promises_debtor
  ON collection_promises(debtor_id, status);
```

**Máquina de estados:**

```
pending ──► kept       (pago >= amount antes de due_date + gracia)
   │
   ├──────► partial   (pago > 0 pero < amount)
   ├──────► broken    (cron al vencer sin pago suficiente)
   └──────► cancelled (manual, admin)
```

La gracia se toma de `collection_policies.ptp_grace_days` (default 0).

### 3.10 `collection_assignments`

Historial de cola y asignación.

```sql
CREATE TABLE collection_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  debtor_id UUID NOT NULL REFERENCES collection_debtors(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  queue TEXT NOT NULL DEFAULT 'general'
    CHECK (queue IN ('general','senior','legal','whatsapp')),
  priority_score NUMERIC(5,2) NOT NULL DEFAULT 0,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','done','reassigned','expired')),
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX idx_collection_assignments_active
  ON collection_assignments(debtor_id)
  WHERE status = 'active';
```

### 3.11 `collection_policies`

Una fila por tramo y cuenta.

```sql
CREATE TABLE collection_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  tramo TEXT NOT NULL
    CHECK (tramo IN ('1_15','16_30','31_60','61_90','90_plus')),
  max_discount_pct NUMERIC(5,2) NOT NULL DEFAULT 0
    CHECK (max_discount_pct >= 0 AND max_discount_pct <= 100),
  max_attempts_per_day INTEGER NOT NULL DEFAULT 3
    CHECK (max_attempts_per_day > 0),
  allowed_start TIME NOT NULL DEFAULT '09:00',
  allowed_end   TIME NOT NULL DEFAULT '18:00',
  ptp_max_days INTEGER NOT NULL DEFAULT 7 CHECK (ptp_max_days > 0),
  ptp_grace_days INTEGER NOT NULL DEFAULT 0 CHECK (ptp_grace_days >= 0),
  min_down_payment_pct NUMERIC(5,2) NOT NULL DEFAULT 0
    CHECK (min_down_payment_pct >= 0 AND min_down_payment_pct <= 100),
  target_recovery_pct NUMERIC(5,2) NOT NULL DEFAULT 0
    CHECK (target_recovery_pct >= 0 AND target_recovery_pct <= 100),
  script_template TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, tramo)
);
```

**Tramos:**

| Tramo | Días de mora | Nombre |
|---|---|---|
| `1_15` | 1–15 | Preventiva |
| `16_30` | 16–30 | Mora temprana |
| `31_60` | 31–60 | Mora media |
| `61_90` | 61–90 | Mora tardía |
| `90_plus` | > 90 | Crítica / jurídica |

### 3.12 `collection_import_batches` y `collection_import_rows`

```sql
CREATE TABLE collection_import_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  portfolio_id UUID REFERENCES collection_portfolios(id) ON DELETE SET NULL,
  file_name TEXT NOT NULL,
  file_type TEXT NOT NULL CHECK (file_type IN ('xlsx','csv')),
  file_size INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'uploaded'
    CHECK (status IN ('uploaded','mapping','validated','committed','failed','cancelled')),
  mapping JSONB,
  summary JSONB,
  error_message TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  committed_at TIMESTAMPTZ
);

CREATE TABLE collection_import_rows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES collection_import_batches(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  row_number INTEGER NOT NULL,
  raw JSONB NOT NULL,
  normalized JSONB,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','valid','warning','error','imported','skipped')),
  errors JSONB,
  debtor_id UUID REFERENCES collection_debtors(id) ON DELETE SET NULL,
  credit_id UUID REFERENCES collection_credits(id) ON DELETE SET NULL,
  installment_id UUID REFERENCES collection_installments(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_collection_import_rows_batch
  ON collection_import_rows(batch_id, status);
```

### 3.13 `collection_commission_rules`

```sql
CREATE TABLE collection_commission_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  tramo TEXT NOT NULL
    CHECK (tramo IN ('1_15','16_30','31_60','61_90','90_plus')),
  percentage NUMERIC(5,2) NOT NULL DEFAULT 0
    CHECK (percentage >= 0 AND percentage <= 100),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, tramo)
);
```

Base de cálculo v1: **monto recuperado** (pagos) atribuido al gestor de la última gestión del deudor en el período. Documentar que si se quiere comisión por PTP cumplida, se agrega un campo `basis` en v2.

---

## 4. Reglas de negocio

### 4.1 Segmentación automática

Al importar o recalcular, cada deudor se segmenta por la **cuota vencida más antigua**:

```
días_mora = CURRENT_DATE - MIN(due_date) de cuotas impagas
```

| Días | Segmento |
|---|---|
| ≤ 0 | `preventiva` (sin mora, solo recordatorio) |
| 1–15 | `preventiva` |
| 16–30 | `temprana` |
| 31–60 | `media` |
| 61–90 | `tardia` |
| > 90 | `critica` |

### 4.2 Prioridad (motor de reglas)

`priority_score` de 0 a 100, calculado por `collection_recompute_priorities(account_id)`:

```
score =
  35 * urgencia(dias_mora)
+ 25 * valor(saldo_vencido / max_saldo_vencido)
+ 20 * propension(historial_pagos)
+ 15 * contactabilidad(acciones_contestadas_30d)
+  5 * ventana_horaria(hora_actual vs horas_contestadas)
```

Componentes:

- **urgencia:** 0 a 1; se satura a los 120 días.
- **valor:** normalizado contra el máximo de la cartera activa.
- **propensión:** ratio de PTP cumplidas / PTP totales; default 0.5 si no hay historial.
- **contactabilidad:** ratio de gestiones con `level1_code = 'contacted'` en 30 días.
- **ventana:** 1 si la hora actual cae en la franja con más contactos históricos; 0.5 si no hay datos.

`priority_reason` guarda una frase legible:

> “Mora 67d · saldo USD 3,420 · 2 PTP cumplidas · contestó 3 de 4 gestiones”.

**Importante:** el score no se muestra como probabilidad. Se muestra como **índice de prioridad** y siempre con su explicación.

### 4.3 Tipificación obligatoria

Para guardar una gestión:

- `channel` obligatorio.
- `level1_code` obligatorio.
- Si `level1_code = 'contacted'` → `level2_code` obligatorio.
- Si `level2_code = 'ptp'` → crear `collection_promises` con monto y fecha; validar contra política del tramo:
  - `due_date <= CURRENT_DATE + ptp_max_days`
  - `amount >= min_down_payment_pct * saldo_vencido`
- Si `level2_code = 'refusal'` → `notes` obligatorio.
- Si `level1_code IN ('no_contact','wrong_number')` → no exige nivel 2.

La validación se hace en el formulario **y** en un RPC/trigger para que no se pueda saltar desde la API.

### 4.4 Pagos

- Un pago no puede superar el saldo de la cuota.
- Al insertar/editar/borrar un pago, un trigger recalcula:
  1. `installment.paid_amount` y `installment.status`.
  2. `credit.status` (`paid` si todas las cuotas están pagadas).
  3. `debtor.status` (`pagado` si todos los créditos están pagados).
- Los pagos con `source = 'adjustment'` requieren rol admin.
- Borrar un pago requiere admin y queda en `audit_logs`.

### 4.5 PTP

- Se crea desde una gestión con `level2_code = 'ptp'`.
- Un cron diario marca `broken` las PTP vencidas sin pago suficiente.
- Al registrar un pago, se buscan PTP `pending` del mismo crédito con `due_date >= paid_at` y se actualiza `paid_amount`; si cubre el monto → `kept`, si cubre parcial → `partial`.
- Una PTP `kept` dispara (opcional) mensaje de confirmación por WhatsApp usando las plantillas existentes.

### 4.6 Políticas

- Se aplican en el servidor al crear PTP, aplicar descuento o reestructurar.
- Si el gestor intenta una quita mayor a `max_discount_pct`, se rechaza con un mensaje claro.
- `max_attempts_per_day` se valida contra `collection_actions` del día.
- El horario permitido se valida contra `collection_settings.timezone`.

### 4.7 Pipeline

Columnas derivadas del estado del deudor/crédito, no arrastrables libremente:

```
Nuevo → Contactado → Negociación → Acuerdo (PTP) → Pago → Recuperado
                                      │
                                      └→ PTP rota → Negociación
```

El drag & drop solo cambia entre estados permitidos; si no, se rechaza. El pipeline es una **vista** del estado real, no una fuente de verdad paralela.

---

## 5. Importación masiva

### 5.1 Dependencias

- `exceljs` para `.xlsx` (mantenido; evita los avisos de seguridad de `xlsx`/SheetJS).
- `csv-parse` para `.csv`.
- `libphonenumber-js` para normalización opcional de teléfonos.

### 5.2 Flujo

```
1. Subir archivo (multipart) → POST /api/cobranza/import/parse
2. Parsear encabezados + muestra de filas
3. Auto-mapear columnas (diccionario + heurística)
4. Usuario revisa/ajusta mapeo y elige modo:
   - "Actualizar saldos" (upsert por documento + folio + cuota)
   - "Reemplazar cartera" (marca como canceladas las cuotas ausentes)
5. Validar filas → preview con errores/advertencias
6. Confirmar → POST /api/cobranza/import/[id]/commit → RPC transaccional
7. Resumen: creados / actualizados / omitidos / errores
```

### 5.3 Columnas canónicas y alias

| Campo canónico | Obligatorio | Alias aceptados |
|---|---|---|
| `document_number` | Sí* | documento, dni, cedula, rfc, identificacion, id_cliente |
| `name` | Sí | nombre, cliente, deudor, nombre_completo, titular |
| `phone_primary` | No | telefono, celular, movil, whatsapp, teléfono |
| `email` | No | email, correo, correo_electronico |
| `folio` | Sí | folio, credito, id_credito, pagare, contrato |
| `product` | No | producto, tipo_credito, linea |
| `installment_number` | Sí | cuota, numero_cuota, num_cuota, no_cuota |
| `due_date` | Sí | vencimiento, fecha_vencimiento, fecha_pago, due_date |
| `principal` | Sí | capital, monto_capital, principal |
| `interest` | No | interes, intereses, rendimiento |
| `late_fee` | No | mora, recargo, interes_moratorio, late_fee |
| `total` | No | total, saldo, monto_cuota, importe |
| `assigned_to` | No | gestor, cobrador, asignado, agente |
| `segment` | No | tramo, segmento, riesgo |
| `address` | No | direccion, domicilio |
| `city` | No | ciudad, municipio |
| `notes` | No | notas, observaciones |

\* Si no hay documento, se usa `(nombre + teléfono)` como clave débil y se marca advertencia de posible duplicado.

### 5.4 Reglas de validación

- Fechas: aceptar `DD/MM/YYYY`, `YYYY-MM-DD`, `DD-MM-YYYY` y serial de Excel. Normalizar a ISO.
- Montos: quitar `$`, `USD`, comas y espacios; aceptar coma decimal si no hay punto decimal.
- Teléfonos: conservar `+` si viene; si no, aplicar `country_code` cuando exista; si no, advertencia.
- `installment_number` entero > 0.
- `due_date` válida.
- `principal >= 0`, `interest >= 0`, `late_fee >= 0`.
- Si el archivo solo trae `total` y no trae `principal`, se usa `total` como `principal` y se marca advertencia (“sin desglose de capital/interés/mora”).
- Duplicados dentro del archivo: misma `(documento, folio, cuota)` → error.
- Duplicados contra la base: se actualizan, no se duplican.
- Filas con error no bloquean el resto; se reportan y se pueden corregir.

### 5.5 Commit transaccional

RPC `collection_import_commit(p_batch_id UUID)`:

1. Verifica `is_account_member(account_id, 'agent')`.
2. Verifica que el batch esté `validated`.
3. Por cada fila válida:
   - Upsert deudor por `(account_id, document_number)` o por `(account_id, phone_primary, name)`.
   - Upsert crédito por `(account_id, folio)`.
   - Upsert cuota por `(credit_id, number)`.
   - Calcula segmento del deudor.
4. Marca filas `imported` / `skipped` / `error`.
5. Actualiza `summary` y `status = 'committed'`.
6. Recalcula prioridades del portafolio.
7. Todo en una transacción; si falla, rollback completo.

### 5.6 Anulación de lote

v1: **anulación lógica**, no borrado. El batch pasa a `cancelled` y las cuotas creadas por él se marcan `cancelled` solo si no tienen pagos ni gestiones posteriores. Si tienen, se bloquea y se explica por qué. Un “revert” destructivo queda para v2.

---

## 6. Backend y API

### 6.1 Rutas Next

| Método | Ruta | Uso |
|---|---|---|
| `POST` | `/api/cobranza/import/parse` | Subir y parsear archivo |
| `POST` | `/api/cobranza/import/[id]/validate` | Aplicar mapeo y validar |
| `POST` | `/api/cobranza/import/[id]/commit` | Confirmar importación |
| `POST` | `/api/cobranza/import/[id]/cancel` | Anular lote |
| `POST` | `/api/cobranza/priorities/recompute` | Recalcular cola |
| `POST` | `/api/cobranza/promises/[id]/resolve` | Marcar PTP cumplida/rota/cancelada |
| `POST` | `/api/cobranza/payments` | Registrar pago(s) en transacción |
| `GET` | `/api/cobranza/export` | Exportar CSV por tipo |
| `GET` | `/api/cobranza/cron` | Tareas diarias (protegido con `CRON_SECRET`) |

Las operaciones CRUD simples (deudor, crédito, cuota, política) usan Supabase directo desde el cliente con RLS, siguiendo el patrón actual del CRM.

### 6.2 RPCs

| RPC | Tipo | Uso |
|---|---|---|
| `collection_recompute_priorities(p_account_id UUID)` | `SECURITY DEFINER` | Recalcular score y razón |
| `collection_import_commit(p_batch_id UUID)` | `SECURITY DEFINER` | Importación transaccional |
| `collection_register_payments(p_account_id UUID, p_payload JSONB)` | `SECURITY DEFINER` | Varios pagos atómicos |
| `collection_resolve_promise(p_promise_id UUID, p_status TEXT)` | `SECURITY DEFINER` | Cambio de estado validado |
| `collection_apply_discount(p_credit_id UUID, p_pct NUMERIC)` | `SECURITY DEFINER` | Validar quita contra política |
| `collection_recompute_debtor(p_debtor_id UUID)` | trigger/helper | Segmento y estado |

### 6.3 Cron diario

`/api/cobranza/cron` (o reutilizar el patrón de `/api/automations/cron`):

1. Marcar PTP vencidas como `broken`.
2. Recalcular segmentos y prioridades.
3. Actualizar `debtor.status` si todos los créditos están pagados.
4. Enviar recordatorios WhatsApp de PTP que vencen mañana (opcional, usando plantillas existentes).
5. Registrar resumen en logs.

---

## 7. Frontend

### 7.1 Librerías internas

```
src/lib/collections/
  types.ts             # tipos y enums del dominio
  status.ts            # labels, colores, transiciones
  scoring.ts           # fórmula de prioridad (testeable)
  aging.ts             # buckets y días de mora
  import/
    columns.ts         # alias y normalización de encabezados
    parse.ts           # Excel/CSV → filas crudas
    map.ts             # auto-mapeo y confianza
    validate.ts        # validación por fila
    commit.ts          # llamada al RPC
  promises.ts          # máquina de estados PTP
  policies.ts          # validación de quitas, horarios y topes
  reporting.ts         # agregaciones para reportes
  commissions.ts       # cálculo de comisiones
```

### 7.2 Componentes

```
src/components/collections/
  collection-kpi.tsx
  debtor-table.tsx
  debtor-summary.tsx
  credit-card.tsx
  installment-table.tsx
  payment-dialog.tsx
  action-form.tsx
  typification-tree.tsx
  promise-form.tsx
  promise-list.tsx
  priority-badge.tsx
  policy-form.tsx
  import-wizard.tsx
  import-preview.tsx
  pipeline-board.tsx
  agent-queue.tsx
  commission-table.tsx
```

Reutilizar:

- `Panel`, `MetricCard`, `Skeleton`, `EmptyState` de `src/components/dashboard` y `src/components/metrics`.
- `Button`, `Dialog`, `Input`, `Select`, `Tabs`, `Table`, `Badge`, `Switch`.
- `toast` de `sonner`.
- `formatCurrency` de `src/lib/currency` (forzando USD).
- `exportToCsv` de `src/lib/export/csv`.

### 7.3 Páginas

| Página | Contenido |
|---|---|
| `/cobranza` | 4 KPIs reales (cartera, vencido, recuperado, PTP pendientes), aging, actividad reciente, accesos. |
| `/cobranza/cartera` | Tabla de deudores con filtros por tramo/gestor/estado, búsqueda local, selección múltiple, asignación. |
| `/cobranza/cartera/[id]` | Ficha 360: datos, créditos, cuotas, pagos, gestiones, PTP, timeline. |
| `/cobranza/pipeline` | Kanban por estado, con contadores y montos; columnas no arrastrables fuera de transición válida. |
| `/cobranza/consola` | Cola a la izquierda, ficha + cuotas + guion al centro, tipificación + PTP a la derecha. Sin cronómetro ni grabación. |
| `/cobranza/acuerdos` | Lista y calendario de PTP, filtros por estado y gestor, acciones de resolver. |
| `/cobranza/importar` | Stepper: archivo → mapeo → validación → commit → resumen. |
| `/cobranza/reportes` | Aging, recuperación, PTP, canales, ranking, comisiones; export CSV. |
| `/cobranza/configuracion` | Settings de cuenta, políticas por tramo, tipificaciones, comisiones. |

### 7.4 Reglas de UI

- Sin barra de búsqueda global.
- Sin telemetría falsa (“Kafka”, “GPU”, “PBX 4 ms”).
- Sin métricas inventadas. Todo número sale de una consulta.
- El score se muestra como “Prioridad 87” + razón, no como “94% de propensión”.
- El pipeline muestra montos y contadores reales; si no hay datos, empty state.
- La consola no simula llamadas: el gestor registra el resultado. El botón “Llamar” usa `tel:` si el dispositivo lo soporta; si no, copia el número.
- Responsive: la consola colapsa a una columna en móvil; el kanban usa scroll horizontal con snap.

---

## 8. Reportes y comisiones

### 8.1 Vistas

```sql
CREATE VIEW v_collection_debtor_summary
WITH (security_invoker = true) AS
SELECT
  d.id,
  d.account_id,
  d.name,
  d.document_number,
  d.phone_primary,
  d.segment,
  d.status,
  d.assigned_to,
  d.priority_score,
  d.priority_reason,
  COUNT(i.id) FILTER (WHERE i.status IN ('pending','partial')) AS open_installments,
  COALESCE(SUM(i.total - i.paid_amount) FILTER (WHERE i.status IN ('pending','partial')), 0) AS balance,
  COALESCE(SUM(i.total - i.paid_amount) FILTER (
    WHERE i.status IN ('pending','partial') AND i.due_date < CURRENT_DATE
  ), 0) AS overdue_balance,
  MAX(CURRENT_DATE - i.due_date) FILTER (
    WHERE i.status IN ('pending','partial') AND i.due_date < CURRENT_DATE
  ) AS days_overdue_max,
  MAX(a.created_at) AS last_action_at
FROM collection_debtors d
LEFT JOIN collection_installments i ON i.debtor_id = d.id
LEFT JOIN collection_actions a ON a.debtor_id = d.id
GROUP BY d.id;
```

Otras vistas:

- `v_collection_aging`: saldo por bucket (`current`, `1_30`, `31_60`, `61_90`, `90_plus`).
- `v_collection_daily_recovery`: pagos por día y gestor.
- `v_collection_promise_stats`: PTP por estado y tramo.
- `v_collection_agent_performance`: gestiones, contactabilidad, PTP, recuperado.
- `v_collection_commissions`: recuperado × porcentaje por tramo.

### 8.2 KPIs del panel

| KPI | Fuente |
|---|---|
| Cartera total | suma de saldos de cuotas abiertas |
| Cartera vencida | saldo con `due_date < CURRENT_DATE` |
| Recuperado del mes | suma de `collection_payments` del mes |
| Tasa de recuperación | recuperado / (recuperado + cartera vencida) |
| PTP pendientes | `collection_promises.status = 'pending'` |
| PTP cumplidas | `kept / (kept + broken + partial)` |

### 8.3 Comisiones

- Regla por tramo (`collection_commission_rules`).
- Base: pagos del período atribuidos al gestor.
- Atribución: última gestión del deudor antes del pago; si no hay, `assigned_to`.
- Salida: tabla por gestor con recuperado, comisión y total.
- Export CSV.

---

## 9. Seguridad, auditoría y PII

- RLS en todas las tablas; ningún acceso cruzado entre cuentas.
- `collection_import_batches` y `collection_import_rows` contienen PII: solo `agent+` puede leerlas; los archivos originales van a un bucket privado con URL firmada y retención configurable (30/90 días).
- Adjuntar `audit_row()` a: `collection_debtors`, `collection_credits`, `collection_installments`, `collection_payments`, `collection_promises`, `collection_policies`, `collection_commission_rules`, `collection_import_batches`.
- Borrado de pagos y cambios de política: solo admin, con motivo obligatorio.
- No registrar números de tarjeta ni datos bancarios completos.
- Los logs de importación no deben imprimir filas completas en producción; solo conteos y códigos de error.

---

## 10. Migraciones y despliegue

### 10.1 Archivos

| Migración | Contenido |
|---|---|
| `073_collection_core.sql` | settings, portfolios, debtors, credits, installments, payments |
| `074_collection_operations.sql` | outcomes, actions, promises, assignments, policies |
| `075_collection_import.sql` | batches, rows, RPC de commit |
| `076_collection_reporting.sql` | vistas, triggers de recálculo, RPC de prioridades |
| `077_collection_migrate_receivables.sql` | backfill desde `receivables` (idempotente) |
| `078_collection_seed_defaults.sql` | políticas y tipificaciones por defecto para cuentas existentes |

Actualizar `supabase/dev_setup.sql` con el esquema final.

### 10.2 Orden de despliegue

1. Migraciones en dev (`uaddlupkvmnqmhzjsjjn`).
2. Validar RLS y triggers con datos de prueba.
3. Migraciones en producción (`abbrstpgvhelhiriulrh`).
4. Deploy del código.
5. Renombrar nav y activar rutas.
6. Backfill de `receivables` (opcional, controlado).

No se toca el webhook de Evolution, ni `ENCRYPTION_KEY`, ni las claves de IA.

### 10.3 Compatibilidad

- `receivables` y `receivable_payments` no se modifican en Fase 1.
- La migración 077 solo lee `receivables` y crea filas en `collection_*`.
- `/receivables` sigue funcionando hasta que el módulo nuevo esté validado; luego se redirige con un banner.

---

## 11. Testing

### Unitarios (Vitest)

- `scoring.ts`: fórmula, límites 0–100, razón legible, cartera vacía.
- `aging.ts`: buckets con fechas límite (15/30/60/90), zona horaria.
- `import/columns.ts`: alias, acentos, mayúsculas, columnas desconocidas.
- `import/validate.ts`: fechas, montos, teléfonos, duplicados.
- `promises.ts`: transiciones pending → kept/partial/broken/cancelled.
- `policies.ts`: quita máxima, intentos/día, plazo PTP, enganche mínimo.
- `commissions.ts`: cálculo por tramo y atribución.
- `reporting.ts`: agregaciones por moneda fija USD.

### Integración SQL

- RLS: viewer no escribe, agent no borra, admin sí.
- Trigger de pagos: parcial, total, sobrepago rechazado, borrado.
- Import commit: idempotencia al subir el mismo archivo dos veces.
- Import commit: rollback si una fila falla a mitad.
- PTP: cron marca rota; pago marca cumplida.
- Vistas: `security_invoker` respeta RLS.

### Manual / E2E

- Importar 1,000 filas con 5% de errores.
- Reimportar el mismo archivo y verificar que no duplica.
- Registrar pago parcial y total; verificar estados.
- Crear PTP, romperla y ver el pipeline.
- Cambiar política y verificar que el formulario bloquea una quita mayor.
- Probar con rol viewer, agent y admin.

### Gate de calidad

- `npm run typecheck`
- `npm run test`
- `npm run build`
- `npm run lint` (solo archivos nuevos; el lint global tiene errores preexistentes)

---

## 12. Fases y entregables

### Fase 1 — Núcleo de datos y carga (prioridad máxima)

**Entregables**

- Migraciones 073, 075, 076 (parte de vistas/triggers).
- Tipos y librerías base.
- Import wizard completo (parse, mapeo, validación, commit, resumen).
- Cartera: tabla de deudores, filtros, ficha 360 con créditos/cuotas/pagos.
- Empty states y skeletons.
- Tests unitarios y de integración del núcleo.

**Criterio de aceptación**

- Se puede cargar un Excel real de 1,000 filas, corregir errores y ver la cartera sin duplicados.
- Un deudor con 3 créditos y 12 cuotas aparece una sola vez.
- Los saldos y estados cuadran con el archivo.

### Fase 2 — Operación diaria

**Entregables**

- Migración 074 (outcomes, actions, promises, assignments, policies) y 078 (seed).
- Pipeline por estado.
- Tipificación obligatoria y guion por tramo.
- PTP con validación de política y cron de vencimiento.
- Priorización por reglas y cola.
- Confirmación/recordatorio por WhatsApp (plantillas existentes).

**Criterio de aceptación**

- El gestor completa una gestión de principio a fin y no puede avanzar sin tipificar.
- Una PTP mal parametrizada se rechaza con mensaje claro.
- La cola se reordena al recalcular y la razón es legible.

### Fase 3 — Consola, reportes y comisiones

**Entregables**

- Consola del gestor (sin telefonía).
- Reportes: aging, recuperación, PTP, canales, ranking.
- Comisiones y export CSV.
- Auditoría visible para admin.

**Criterio de aceptación**

- El supervisor ve recuperado, PTP cumplidas y ranking con datos reales.
- La comisión calculada coincide con el reporte exportado.

### Fase 4 — Migración y limpieza

**Entregables**

- Migración 077 desde `receivables`.
- Renombre de nav `Finanzas → Cobranza`.
- Redirección de `/receivables` y banner de transición.
- Documentación de usuario.

**Criterio de aceptación**

- Los datos históricos de `receivables` aparecen en la cartera nueva.
- No hay enlaces rotos ni duplicados.

### Fase 5 — Futuro (no comprometido)

- Telefonía (Twilio/Vonage/Asterisk) con click-to-call y AMD.
- Links de pago (Stripe/MercadoPago/Conekta).
- Conciliación bancaria.
- Scoring con ML.
- Multimoneda.

---

## 13. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Archivos Excel heterogéneos | Diccionario de alias + presets por cuenta + preview obligatorio. |
| Teléfonos sin país | `country_code` configurable; advertencia si no se puede normalizar. |
| Duplicados de deudores | Clave por documento; fallback nombre + teléfono con advertencia. |
| Importaciones enormes | Procesar por lotes de 500 filas; límite de 10 MB por archivo. |
| PII en logs | No loggear filas completas; solo conteos y códigos. |
| Baja adopción por falta de marcador | Consola simple, un clic para registrar; `tel:` como apoyo. |
| Políticas mal configuradas | Validación en servidor + valores por defecto conservadores. |
| Dos módulos de cobranza | Fase 4 migra y redirige; `receivables` queda solo como legado. |

---

## 14. Decisiones pendientes

1. ~~**País y zona horaria** por cuenta.~~ **Resuelto:** Venezuela (`VE`, `America/Caracas`), teléfonos a `+58`.
2. **Base de comisión:** recuperado (v1 propuesto) vs PTP cumplida.
3. **Plantillas de WhatsApp** para confirmación de PTP y recordatorios: ¿se crean nuevas o se reutilizan las existentes?
4. **Retención de archivos de importación:** 30, 90 o 365 días.
5. **¿Se conserva `/receivables`** como “cuentas por cobrar simples” o se archiva tras la migración?

---

## 15. Definición de “terminado” (Fase 1)

- [ ] Migraciones aplicadas en dev y producción.
- [ ] RLS verificada con los tres roles.
- [ ] Importación real probada con un archivo del cliente.
- [ ] Deudor 1:N créditos y 1:N cuotas sin duplicados.
- [ ] Ficha 360 muestra saldos correctos.
- [ ] `typecheck`, `test` y `build` en verde.
- [ ] Documento de usuario con el flujo de carga.
- [ ] Sin datos falsos ni métricas simuladas en la UI.

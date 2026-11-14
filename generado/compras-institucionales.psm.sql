-- Esquema Relacional SQL (PSM) generado automáticamente por MDA Studio
-- Aplicación: Compras institucionales (compras-institucionales)
-- Plataforma destino: HTML5 / JavaScript ES2022 / IndexedDB + File System Access API + SQL DDL

-- Tabla principal de casos de proceso para Compra
CREATE TABLE IF NOT EXISTS compra (
  id VARCHAR(64) PRIMARY KEY NOT NULL,
  estado_actual VARCHAR(48) NOT NULL DEFAULT 'solicitada',
  referencia VARCHAR(300) NOT NULL,
  unidad VARCHAR(300) NOT NULL,
  objeto VARCHAR(300) NOT NULL,
  justificacion VARCHAR(300) NOT NULL,
  monto INTEGER NOT NULL,
  cantidad INTEGER NOT NULL,
  cotizaciones INTEGER NOT NULL,
  plazo INTEGER NOT NULL,
  proveedor VARCHAR(300) NULL,
  partida VARCHAR(300) NOT NULL,
  prioridad VARCHAR(64) CHECK (prioridad IN ('normal', 'urgente', 'critica')),
  fecha_necesaria DATE NULL,
  documentacion BOOLEAN NULL,
  CONSTRAINT chk_compra_estado CHECK (estado_actual IN ('solicitada', 'observada', 'presupuesto', 'modalidad', 'juridica', 'comite', 'adjudicada', 'ordenada', 'incidencia', 'recibida', 'contabilidad', 'pago', 'pagada', 'cerrada', 'rechazada', 'cancelada')),
  CONSTRAINT chk_montovalido CHECK (monto >= 1 AND monto <= 250000),
  CONSTRAINT chk_cantidadvalida CHECK (cantidad >= 1 AND cantidad <= 10000),
  CONSTRAINT chk_plazovalido CHECK (plazo >= 1 AND plazo <= 180),
  CONSTRAINT chk_cotizacionesvalidas CHECK (cotizaciones >= 0 AND cotizaciones <= 30),
  CONSTRAINT chk_referenciavalida CHECK (CHAR_LENGTH(referencia) >= 4)
);

-- Bitácora inmutable de auditoría de transiciones por rol
CREATE TABLE IF NOT EXISTS compra_historial (
  id_evento INTEGER PRIMARY KEY AUTOINCREMENT,
  caso_id VARCHAR(64) NOT NULL REFERENCES compra(id) ON DELETE CASCADE,
  accion VARCHAR(120) NOT NULL,
  rol_actor VARCHAR(64) NOT NULL,
  fecha_hora TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

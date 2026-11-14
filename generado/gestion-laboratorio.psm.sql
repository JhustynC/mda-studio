-- Esquema Relacional SQL (PSM) generado automáticamente por MDA Studio
-- Aplicación: Gestión de laboratorio (gestion-laboratorio)
-- Plataforma destino: HTML5 / JavaScript ES2022 / IndexedDB + File System Access API + SQL DDL

-- Tabla de catálogo CRUD para Producto
CREATE TABLE IF NOT EXISTS producto (
  id VARCHAR(64) PRIMARY KEY NOT NULL,
  nombre VARCHAR(300) NOT NULL,
  sku VARCHAR(300) NOT NULL UNIQUE,
  categoria VARCHAR(64) NOT NULL CHECK (categoria IN ('equipos', 'consumibles', 'repuestos')),
  stock INTEGER NOT NULL,
  ubicacion VARCHAR(300) NULL,
  reposicion DATE NULL,
  activo BOOLEAN NULL,
  CONSTRAINT chk_stocknonegativo CHECK (stock >= 0)
);

-- Tabla principal de casos de proceso para Prestamo
CREATE TABLE IF NOT EXISTS prestamo (
  id VARCHAR(64) PRIMARY KEY NOT NULL,
  estado_actual VARCHAR(48) NOT NULL DEFAULT 'solicitado',
  solicitante VARCHAR(300) NOT NULL,
  equipo VARCHAR(300) NOT NULL REFERENCES producto(id),
  cantidad INTEGER NOT NULL,
  dias INTEGER NOT NULL,
  motivo VARCHAR(300) NOT NULL,
  CONSTRAINT chk_prestamo_estado CHECK (estado_actual IN ('solicitado', 'aprobado', 'entregado', 'devuelto', 'rechazado')),
  CONSTRAINT chk_cantidadvalida CHECK (cantidad >= 1 AND cantidad <= 5),
  CONSTRAINT chk_plazovalido CHECK (dias >= 1 AND dias <= 30)
);

-- Bitácora inmutable de auditoría de transiciones por rol
CREATE TABLE IF NOT EXISTS prestamo_historial (
  id_evento INTEGER PRIMARY KEY AUTOINCREMENT,
  caso_id VARCHAR(64) NOT NULL REFERENCES prestamo(id) ON DELETE CASCADE,
  accion VARCHAR(120) NOT NULL,
  rol_actor VARCHAR(64) NOT NULL,
  fecha_hora TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Kardex de entradas y salidas vinculadas entre Prestamo y Producto
CREATE TABLE IF NOT EXISTS prestamo_movimientos_stock (
  id_movimiento INTEGER PRIMARY KEY AUTOINCREMENT,
  caso_id VARCHAR(64) NOT NULL REFERENCES prestamo(id),
  producto_sku VARCHAR(120) NOT NULL REFERENCES producto(sku),
  transicion VARCHAR(64) NOT NULL,
  unidades INTEGER NOT NULL,
  saldo_resultante INTEGER NOT NULL CHECK (saldo_resultante >= 0),
  fecha_hora TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

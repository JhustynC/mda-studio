-- Esquema Relacional SQL (PSM) generado automáticamente por MDA Studio
-- Aplicación: Inventario de laboratorio (inventario)
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

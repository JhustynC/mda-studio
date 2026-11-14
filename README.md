# MDA Studio

Proyecto de interciclo de Nuevos Paradigmas de Programación. Genera aplicaciones web autónomas desde modelos. Puedes crear procesos con formularios y transiciones por rol, o catálogos CRUD con altas, consulta, edición y eliminación. Incluye Gestión de laboratorio, Préstamos de laboratorio, Compras institucionales e Inventario de laboratorio.

## Abrir la demostración

Clona el repositorio o descárgalo como ZIP y extráelo. Abre [generado/index.html](generado/index.html) con Edge o Chrome desde tu equipo. El HTML ya incluye el compilador y las plantillas, así que puedes probar el Studio sin instalar dependencias ni iniciar un servidor. Para ver la integración completa, abre [Gestión de laboratorio](generado/gestion-laboratorio.html). También puedes ejecutar los ejemplos de [Inventario](generado/inventario.html), [Préstamos](generado/prestamos-lab.html) y [Compras](generado/compras-institucionales.html).

Para regenerar desde PowerShell en la carpeta del proyecto, usa Node.js 22 o posterior. Instala las dependencias de compilación con `npm ci` la primera vez. El HTML que se entrega ya incluye CodeMirror y se puede abrir sin conexión.

~~~powershell
npm ci
node generar.mjs
node generar.mjs models/prestamos.cim.json generado
~~~

El último comando permite indicar un modelo CIM y un directorio de salida. Si el modelo es inválido, la generación aborta antes de escribir archivos. Los generados se pueden borrar y volver a crear con los modelos y el código fuente.

## Trabajar con varios proyectos

Usa **Oscuro** o **Claro** en la barra superior para cambiar el tema. El Studio sigue la preferencia del sistema hasta que elijas un tema y recuerda tu elección en el navegador. La vista previa y la pestaña nueva adoptan el tema del Studio.

Desde **Proyectos**, abre **Recursos del Studio** para consultar la **Guía de inicio** o explorar el **Metamodelo base**. La guía acompaña la creación de un primer proceso. El explorador muestra las estructuras de CIM, PIM y PSM y permite descargar el metamodelo en JSON.

La pantalla **Proyectos** reúne tus proyectos locales y los ejemplos. Busca por nombre, descripción o tipo. Usa **Volver a proyectos** desde el editor para regresar a la biblioteca.

En **Nuevo proyecto** puedes partir de tres estructuras editables.

| Plantilla | Qué genera |
| --- | --- |
| **Proceso** | Solicitudes con estados, responsables y transiciones. |
| **Catálogo CRUD** | Formulario y tabla para crear, buscar, editar y eliminar registros. |
| **Proceso con catálogo** | Solicitudes vinculadas a un inventario, con salidas al entregar y entradas al devolver. |

Las plantillas generan un CIM inicial con el nombre que ingreses y la aplicación arranca con tus tablas vacías. Los ejemplos se abren desde sus propias tarjetas. Para reutilizar un flujo como el de laboratorio en otro contexto, elige **Proceso con catálogo**, adapta los roles y pasos y configura el catálogo en `integracion.catalogo` dentro del JSON. Después de generar la aplicación puedes registrar tus artículos en **Inventario**.

El Studio guarda cada borrador en el navegador, incluso mientras el JSON está incompleto. Para trasladar el proyecto, descarga su CIM, crea un proyecto en el otro navegador y usa **Archivos y trazabilidad → Importar CIM (.json)**. El CIM lleva la definición del negocio. Los casos y registros de la aplicación se trasladan con una [copia JSON de sus datos](#persistencia-de-la-aplicación-web).

## Recorrer el flujo MDA

En el editor, sigue **Validar y ver PIM → Ver PSM → Generar aplicación**. Usa los pasos superiores o los botones para volver al modelo anterior. El compilador verifica el CIM y genera el PIM y el PSM a partir de la versión que pasa la validación.

1. **CIM · Modelo de negocio.** En **Campos** puedes añadir y editar los datos de la entidad principal. Los campos del inventario se identifican con **Catálogo vinculado** y se editan en **Editar JSON**, en `integracion.catalogo`. Despliega **Proceso de negocio** y **Restricciones OCL** para trabajar con el flujo y sus reglas.
2. **Diagrama y DSL del CIM.** En **Diagrama** puedes consultar y editar actores, datos, estados, transiciones y reglas. Usa la rueda para acercar o alejar, arrastra el fondo para desplazarte o pulsa **Ajustar**. En **Editar JSON**, CodeMirror ofrece búsqueda, formato y diagnósticos. Pulsa `Ctrl+Enter` para validar y avanzar al PIM.
3. **PIM · Modelo lógico.** Empieza en **Campos y tipos** para comprobar las propiedades de negocio, sus tipos y multiplicidades. En **Clases** puedes desplegar atributos, operaciones y consultar relaciones. En **Reglas OCL** puedes revisar las expresiones que interpretó el compilador.
4. **PSM · Modelo web.** En **Interfaz** puedes elegir entre **Lista de casos** y **Tablero por estado** y ver el boceto. **Mapeo** relaciona cada campo con su control web, su validación y su columna SQL. **Datos y SQL** reúne el almacenamiento previsto y el esquema SQLite. Los catálogos CRUD se muestran como una tabla.
5. **Aplicación.** Prueba el flujo en el Studio o usa **Abrir en otra pestaña**. Desde **Gestionar datos** puedes guardar y restaurar copias JSON, consultar el SQL y descargarlo.

PIM y PSM incluyen una vista **JSON** de solo lectura. Los cambios de negocio se realizan en el CIM.

### Archivos y trazabilidad

Abre **Archivos y trazabilidad** en la etapa que quieras revisar. Los formatos de salida son:

| Etapa | Archivos |
| --- | --- |
| CIM | `.cim.json`, diagrama `.cim.svg` y Mermaid `.cim.mmd`. |
| PIM | `.pim.json`, representación `.pim.ecore` y reglas `.pim.ocl`. Puedes inspeccionar Ecore y OCL en el mismo panel. |
| PSM | `.psm.json`, esquema SQLite `.psm.sql` y `.psm.schema.json`. |
| Aplicación | HTML autónomo con la interfaz, las operaciones y los validadores. |

En la pestaña **Trazabilidad**, busca por elemento, filtra por tipo y recorre los resultados por páginas. Por ejemplo, busca `cantidad` para seguir el dato del CIM al tipo `EInt` del PIM y al control `number` del PSM. Puedes descargar la matriz completa en CSV o JSON.

## Las ocho etapas del proyecto

MDA Studio implementa el recorrido **CIM → PIM → PSM → aplicación** con un DSL, un metamodelo y un compilador propios. La propuesta de clase orienta las etapas. Esta implementación usa JavaScript y genera una aplicación web autónoma.

| Etapa | Implementación en MDA Studio | Evidencia y Entregables |
| --- | --- | --- |
| 01 · Análisis del problema (CIM) | El CIM describe el objetivo, los actores, los datos y el flujo de negocio. Permite añadir/editar campos, actores, estados, transiciones y reglas OCL directamente desde la vista estructurada o desde el diagrama interactivo. | [CIM de Préstamos](models/prestamos.cim.json) · [Flujo Mermaid](generado/prestamos-lab.cim.mmd) · Exportación `.cim.svg` |
| 02 · Diseño del metamodelo | Un metamodelo formal define las estructuras, tipos Ecore/UML, multiplicidades, firmas lógicas y esquemas SQL de CIM, PIM y PSM. El compilador verifica la conformidad de los tres niveles. | [Metamodelo](models/metamodelo.json) |
| 03 · Construcción del PIM | La transformación M2M (`CIM → PIM`) abstrae el dominio en clases UML/Ecore (`EString`, `EInt`, `EDate`, `EEnum`, `EBoolean`) con atributos de ciclo de vida sintetizados (`id «PK»`, `estado-actual`, `historial`), multiplicidades, relaciones y firmas de operaciones con guardas y efectos. | [PIM Ecore (XMI)](generado/prestamos-lab.pim.ecore) · [PIM JSON](generado/prestamos-lab.pim.json) |
| 04 · Validación OCL | El motor OCL soporta invariantes (`inv`), precondiciones (`pre`) y postcondiciones (`post`) sobre `Entero`, `Texto`, `Seleccion`, `Booleano` y `Fecha`, comparación entre atributos (`self.a >= self.b`) y conectores `and`, `or` e `implies`, con constructor visual asistido. | [Reglas OCL formales](generado/prestamos-lab.pim.ocl) · [Compilador OCL](src/compiler.mjs) |
| 05 · Diseño del PSM | La vista de arquitectura PSM explica y visualiza con un wireframe en vivo el patrón de interfaz (`Bandeja Maestro-Detalle` vs `Tablero Kanban por estado`), los atributos DOM derivados de OCL, el adaptador de persistencia y el esquema relacional SQL. | [Esquema SQL DDL](generado/prestamos-lab.psm.sql) · [JSON Schema](generado/prestamos-lab.psm.schema.json) |
| 06 · Transformación M2M | Dos transformaciones automáticas convierten `CIM → PIM (Ecore/UML)` y `PIM → PSM (HTML5 + SQL DDL)`. El compilador transforma las reglas en validadores JS. Las invariantes compatibles también se reflejan en atributos DOM (`min`, `max`, `minlength`) y restricciones `CHECK` de SQL. | [PSM de Préstamos](generado/prestamos-lab.psm.json) · [DDL de Laboratorio](generado/gestion-laboratorio.psm.sql) |
| 07 · Generación M2T | El PSM alimenta la plantilla ejecutable generando HTML5, CSS, validadores JS ES2022, esquema SQL embebido y persistencia local mediante IndexedDB y localStorage. | [Plantilla](src/generated.html) · [HTML de Préstamos](generado/prestamos-lab.html) |
| 08 · Ejecución y pruebas | La vista previa permite comprobar el flujo. La aplicación autónoma conserva los cambios en el navegador. Desde **Gestionar datos** puedes restaurar copias JSON o descargar un volcado SQL para SQLite. | [Trazabilidad CSV](generado/prestamos-lab.traza.csv) · [Guion para exponer](#guion-para-exponer) |

### Persistencia de la aplicación web

La aplicación abierta por separado usa **IndexedDB** y **localStorage** para conservar sus registros en ese navegador. La vista previa del Studio tiene una sesión aislada. Cambiar la presentación, volver a abrir el proyecto o recargar el Studio puede reiniciar sus datos de prueba.

- **Guardar copia JSON** descarga los datos de la sesión en un archivo `.db.json`. **Restaurar copia JSON** reemplaza los datos de esa aplicación con una copia compatible. Usa estas opciones para pasar los registros de la vista previa a la aplicación abierta por separado.
- **Guardar en archivo automáticamente**, cuando está disponible en una pestaña independiente, vincula una copia JSON que el navegador actualiza durante esa sesión.
- **Descargar SQL** exporta el esquema y los registros como sentencias para ejecutar en un motor SQLite externo. El esquema que se obtiene en el **PSM** contiene la estructura de las tablas. La aplicación web ejecutable guarda sus datos en el navegador.

Los roles del proceso son simulados y las sesiones funcionan por navegador. El alcance actual es local, con un proceso y un catálogo vinculado por modelo integrado.

### Posible extensión para el equipo

Podemos añadir un segundo destino de generación que transforme el mismo PIM en un **PSM de servidor**. Ese módulo generaría una aplicación Spring Boot con una API y persistencia en PostgreSQL. La autorización de usuarios y la validación de transiciones se ejecutarían en el servidor. Las pruebas JUnit podrían cubrir reglas, permisos y persistencia. Esta extensión queda abierta para que el equipo decida su alcance. La versión web local ya se puede ejecutar y presentar.

### DSL y restricciones

- Un CIM de proceso declara `version`, `id`, `nombre`, `objetivo`, `entidad`, `actores`, `datos`, `inicio`, `estados`, `transiciones` y `ocl`. Un catálogo usa `tipo: "crud"`, `datos` y, opcionalmente, `unicos`, además de su identificación y sus reglas.
- Los tipos de campo son `Texto`, `Entero`, `Fecha`, `Seleccion` y `Booleano`. En `Seleccion`, declara `opciones` con `id` y `nombre`. Las fechas se representan como `AAAA-MM-DD`. Cada transición indica el actor, el estado de origen y el estado de destino.
- Para vincular un catálogo, declara `integracion.catalogo`, el campo de solicitud `referencia`, la `clave` única del catálogo, `existencias`, `cantidad` y `movimientos`. Cada movimiento apunta a una transición y declara `salida` o `entrada`.
- El compilador admite un subconjunto de OCL con invariantes `context Clase inv Nombre: ...` y condiciones de operación `context Clase::operacion() pre Nombre: ...` y `post`. Admite comparaciones con literales o entre campos del mismo tipo, `size()` en texto o fecha y los conectores `and`, `or` e `implies`. La aplicación evalúa las invariantes al guardar y las reglas de una transición sobre los datos del caso antes de confirmar el cambio.

Abre la **Guía de inicio** para consultar ejemplos de reglas y **Metamodelo base** para ver qué estructuras comprueba el compilador.

## Generar un CRUD

Desde **Proyectos**, abre **Inventario de laboratorio** o crea un **Catálogo CRUD**. Añade o edita campos en **CIM → Campos**, despliega **Restricciones OCL** para editar las reglas o consulta el modelo fuente en **Editar JSON**.

El [CIM de inventario](models/inventario.cim.json) declara `tipo: "crud"`, la entidad `Producto`, sus datos, la unicidad de SKU y la invariante de stock no negativo. El [PIM](generado/inventario.pim.json) contiene las cuatro operaciones lógicas y el [PSM](generado/inventario.psm.json) incorpora la tabla web, los controles y el almacenamiento. La [aplicación generada](generado/inventario.html) permite buscar, crear, editar y eliminar registros. El stock se actualiza editando el registro y las reglas se comprueban al guardar.

Los datos pertenecen al navegador que abre el HTML. La vista previa del Studio conserva registros durante su ejecución. El ejemplo representa un catálogo con una entidad y existencias editables.

## Gestión de laboratorio integrada

Abre **Gestión de laboratorio** desde Proyectos o la [aplicación generada](generado/gestion-laboratorio.html). El [CIM](models/laboratorio.cim.json) vincula `Prestamo.equipo` con el catálogo de `Producto`. En `integracion` se declaran la clave del catálogo, el campo de existencias, la cantidad y las transiciones de entrada y salida. El [PIM](generado/gestion-laboratorio.pim.json) conserva esa relación y las operaciones. El [PSM](generado/gestion-laboratorio.psm.json) la convierte en un selector de inventario. En [Trazabilidad](generado/gestion-laboratorio.traza.json) puedes seguir los cambios de stock hasta las transiciones.

La demostración abre con cuatro artículos, cinco solicitudes en distintos estados y tres movimientos precargados desde [laboratorio.demo.json](models/laboratorio.demo.json). En **Solicitudes**, abre el caso de Diego Rojas como Estudiante y devuelve los dos microscopios. En **Inventario**, el artículo con código `MIC-DEMO-01` pasa de 4 a 6 unidades, y en **Movimientos** aparece la nueva entrada. Como Responsable, puedes intentar entregar el kit del caso aprobado de Mateo Silva para comprobar el aviso de existencias insuficientes.

Para probar el caso de dos solicitudes que compiten por las mismas unidades:

1. En **Inventario**, crea un microscopio con SKU `MIC-01`, categoría Equipos y stock de **3**.
2. En **Solicitudes**, como **Estudiante**, registra dos préstamos de **2** unidades para ese microscopio, uno a nombre de Ana y otro de Luis. Usa **3 días** y el motivo **Práctica de laboratorio** en ambos. Cambia a **Responsable** y aprueba los dos casos.
3. Entrega el primero. El inventario queda en **1**. Intenta entregar el segundo. La aplicación indica que solo queda una unidad y mantiene el caso **Aprobado**. El stock se descuenta al entregar.
4. Devuelve el primero como **Estudiante**. El inventario vuelve a **3** y en **Movimientos** puedes consultar el descuento y la reposición. En el Studio abre **Archivos y trazabilidad → Trazabilidad** y elige **Integración** para ver cómo se generaron el selector y ambos movimientos.

El compilador comprueba que las transiciones de entrada y salida estén correctamente ordenadas y que ningún camino termine con unidades pendientes de devolver. La aplicación guarda solicitudes, productos y movimientos juntos en el almacenamiento local de un navegador.
## Guion para exponer

1. Abre **Gestión de laboratorio**. En el CIM muestra los actores y las ramas de aprobación y rechazo en **Diagrama**.
2. En **PIM → Campos y tipos** localiza `cantidad` y su tipo `EInt`. En **PSM → Mapeo** muestra el control `number`. En **Archivos y trazabilidad → Trazabilidad** busca `cantidad` para conectar ambas vistas.
3. Pulsa **Generar aplicación**. Como **Estudiante**, selecciona un artículo y prueba el límite de `CantidadValida` con seis unidades. Luego registra una solicitud válida de dos unidades, cinco días y el motivo **Práctica de óptica**.
4. Como **Responsable**, aprueba el caso y registra la entrega. Vuelve a **Estudiante** para registrar su devolución. Comprueba el historial y los saldos en **Movimientos**.
5. Vuelve al CIM y añade un campo `curso` de tipo `Texto`. Genera de nuevo y comprueba el cambio en el formulario. Descarga el HTML desde **Archivos y trazabilidad** o usa **Abrir en otra pestaña**. Si editas el CIM original del ejemplo, crea un artículo en el inventario de la nueva vista previa para hacer otra solicitud.

El Studio usa una vista previa aislada cuyos casos se mantienen durante esa ejecución. El HTML autónomo guarda casos en el almacenamiento del navegador cuando está disponible. El selector de rol simula actores para la exposición. El alcance es un proceso por modelo en una aplicación web local, sin cuentas de usuario ni base de datos compartida.

## Demo avanzada de compras institucionales

El [CIM de compras](models/compras.cim.json) genera un [PIM](generado/compras-institucionales.pim.json), un [PSM](generado/compras-institucionales.psm.json), una [traza](generado/compras-institucionales.traza.json) y una [aplicación autónoma](generado/compras-institucionales.html). El modelo tiene nueve roles, 13 campos, 16 estados, 25 transiciones, cinco invariantes y siete precondiciones. Prioridad, fecha en que se necesita y disponibilidad de documentación demuestran los controles nuevos y son opcionales.

1. Genera la aplicación y registra una compra como **Solicitante**. Usa referencia `OC-2026-014`, unidad `Laboratorio`, objeto `Microscopios`, justificación `Reposición de equipos para prácticas`, monto `18000`, unidades `5`, cotizaciones `3`, plazo `30`, proveedor `Óptica Andina` y partida `5308`.
2. Como **Jefatura**, envía a presupuesto. Como **Presupuesto**, certifica disponibilidad. Como **Compras**, intenta adjudicar directamente para ver el bloqueo OCL. Envía a revisión jurídica, emite dictamen como **Jurídico** y adjudica como **Comité**.
3. Como **Compras**, emite la orden. Como **Bodega**, registra una recepción no conforme. Vuelve a **Compras** para registrar la subsanación y luego a **Bodega** para confirmar la recepción conforme.
4. Envía el expediente a contabilidad como **Compras**, autoriza la contabilización como **Contabilidad**, registra el pago como **Tesorería** y cierra como **Compras**. Revisa el historial del caso.

Con un monto de `4500` y una cotización puedes recorrer la compra directa. Las devoluciones reabren etapas y las acciones de ampliación o subsanación representan trabajo realizado fuera de la aplicación. Los valores se capturan en el formulario inicial. Los umbrales son reglas ficticias del ejemplo académico.

## Material de clase

**01** y **02** cubren programación dirigida por modelos, DSL y metamodelado. **Transformación de modelos** cubre las transformaciones M2M y M2T. **Introducción a MDA y OCL** cubre los niveles CIM/PIM/PSM y las invariantes y precondiciones usadas en el proyecto.


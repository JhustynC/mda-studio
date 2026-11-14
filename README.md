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

El segundo comando permite indicar otro modelo y otro directorio de salida. Si el modelo es inválido, la generación aborta antes de escribir archivos. Los generados se pueden borrar y volver a crear con los modelos y el código fuente.

## Trabajar con varios proyectos

Usa **Oscuro** o **Claro** en la barra superior para cambiar el tema. El Studio sigue la preferencia del sistema hasta que elijas un tema y recuerda tu elección en el navegador. La vista previa y la pestaña nueva adoptan el tema del Studio.

Desde **Proyectos**, abre **Recursos del Studio** para consultar la **Guía de inicio** o explorar el **Metamodelo base**. La guía acompaña la creación de un primer proceso. El explorador muestra las estructuras de CIM, PIM y PSM y permite descargar el metamodelo en JSON.

La pantalla **Proyectos** reúne los ejemplos y los proyectos locales que crees. El buscador encuentra proyectos por nombre, descripción o tipo. Las tarjetas identifican si se trata de un proceso, un catálogo CRUD o una integración de proceso e inventario. Abre uno para entrar al editor. Usa **Volver a proyectos** para regresar a la biblioteca. **Nuevo proyecto** permite partir de un proceso básico, un CRUD básico, una copia del último proyecto abierto o un ejemplo. El título de la aplicación se define en `nombre` dentro del CIM.

El Studio guarda cada borrador, incluso mientras el JSON está incompleto, en el almacenamiento de este navegador. Al cambiar de proyecto, restaura su CIM y calcula sus propias salidas. Desde la barra **Entregables MDA de esta fase** puedes descargar los artefactos formales de cada etapa (`.cim.json`, `.cim.svg`, `.cim.mmd`, `.pim.ecore`, `.pim.ocl`, `.psm.sql`, `.psm.schema.json`, `.traza.csv` o `.html`).

En el editor, **Proceso de negocio** y **Restricciones OCL** permiten agregar y editar actores, estados, transiciones y reglas OCL (`inv`, `pre`, `post`) directamente desde la vista estructurada. Las tablas de **Campos y negocio** agrupan los datos por entidad cuando el proyecto vincula un catálogo a un proceso y permiten añadir o editar campos con un clic.

**CIM → Editar JSON** usa CodeMirror 6 con colores de sintaxis, números de línea, bloques plegables, búsqueda y diagnósticos de sintaxis. Usa `Ctrl+Enter` para validar el CIM y ver el PIM desde el editor. **PIM** y **PSM** ofrecen sus propias vistas de arquitectura (clases UML/Ecore y wireframe + esquema SQL) además de **Inspeccionar JSON**.

En **PSM**, elige cómo se mostrarán los casos entre **Lista de casos (bandeja)** y **Tablero Kanban por estado**, actualizando tanto el wireframe de arquitectura como la aplicación generada.

## Las ocho etapas del proyecto

En el editor, sigue **Validar y ver PIM → Ver PSM → Generar aplicación**. Los botones para volver y la barra de etapas permiten revisar todo el recorrido MDA.

MDA Studio implementa el recorrido **CIM → PIM → PSM → aplicación** con un DSL, un metamodelo y un compilador propios. La propuesta de clase orienta las etapas. Esta implementación usa JavaScript y genera una aplicación web autónoma.

| Etapa | Implementación en MDA Studio | Evidencia y Entregables |
| --- | --- | --- |
| 01 · Análisis del problema (CIM) | El CIM describe el objetivo, los actores, los datos y el flujo de negocio. Permite añadir/editar campos, actores, estados, transiciones y reglas OCL directamente desde la vista estructurada o desde el diagrama interactivo. | [CIM de Préstamos](models/prestamos.cim.json) · [Flujo Mermaid](generado/prestamos-lab.cim.mmd) · Exportación `.cim.svg` |
| 02 · Diseño del metamodelo | Un metamodelo formal define las estructuras, tipos Ecore/UML, multiplicidades, firmas lógicas y esquemas SQL de CIM, PIM y PSM. El compilador verifica la conformidad de los tres niveles. | [Metamodelo](models/metamodelo.json) |
| 03 · Construcción del PIM | La transformación M2M (`CIM → PIM`) abstrae el dominio en clases UML/Ecore (`EString`, `EInt`, `EDate`, `EEnum`, `EBoolean`) con atributos de ciclo de vida sintetizados (`id «PK»`, `estado-actual`, `historial`), multiplicidades, relaciones y firmas de operaciones con guardas y efectos. | [PIM Ecore (XMI)](generado/prestamos-lab.pim.ecore) · [PIM JSON](generado/prestamos-lab.pim.json) |
| 04 · Validación OCL | El motor OCL soporta invariantes (`inv`), precondiciones (`pre`) y postcondiciones (`post`) sobre `Entero`, `Texto`, `Seleccion`, `Booleano` y `Fecha`, comparación entre atributos (`self.a >= self.b`) y conectores `and`, `or` e `implies`, con constructor visual asistido. | [Reglas OCL formales](generado/prestamos-lab.pim.ocl) · [Compilador OCL](src/compiler.mjs) |
| 05 · Diseño del PSM | La vista de arquitectura PSM explica y visualiza con un wireframe en vivo el patrón de interfaz (`Bandeja Maestro-Detalle` vs `Tablero Kanban por estado`), los atributos DOM derivados de OCL, el adaptador de persistencia y el esquema relacional SQL. | [Esquema SQL DDL](generado/prestamos-lab.psm.sql) · [JSON Schema](generado/prestamos-lab.psm.schema.json) |
| 06 · Transformación M2M | Dos transformaciones automáticas convierten `CIM → PIM (Ecore/UML)` y `PIM → PSM (HTML5 + SQL DDL)`. Las invariantes OCL se transforman simultáneamente en validadores JS, atributos DOM (`min`, `max`, `minlength`) y restricciones `CHECK` en SQL. | [PSM de Préstamos](generado/prestamos-lab.psm.json) · [DDL de Laboratorio](generado/gestion-laboratorio.psm.sql) |
| 07 · Generación M2T | El PSM alimenta la plantilla ejecutable generando HTML5, CSS, validadores JS ES2022, esquema SQL embebido y adaptador de persistencia en Base de Datos (`IndexedDB`) y sincronización con archivo local (`.db.json` / `.sql`). | [Plantilla](src/generated.html) · [HTML de Préstamos](generado/prestamos-lab.html) |
| 08 · Ejecución, Pestaña Dedicada y BD | La aplicación puede abrirse en una **pestaña nueva a pantalla completa**, conectarse en vivo a un archivo físico de base de datos (`.db.json`) mediante File System Access API o exportar/importar volcados transaccionales `.sql` (`CREATE TABLE` + `INSERT INTO`) y `.db.json`. | [Trazabilidad CSV](generado/prestamos-lab.traza.csv) · [Guion para exponer](#guion-para-exponer) |

La [trazabilidad](generado/prestamos-lab.traza.json) permite seguir cada campo, transición y regla desde el CIM hasta la aplicación. Cada proyecto puede definir un flujo, una entidad CRUD o un flujo con un catálogo vinculado. Las aplicaciones guardan los datos en el navegador. Los proyectos de procesos incluyen un selector para simular actores durante la demostración.

### Posible extensión para el equipo

Podemos añadir un segundo destino de generación que transforme el mismo PIM en un **PSM de servidor**. Ese módulo generaría una aplicación Spring Boot con una API y persistencia en PostgreSQL. La autorización de usuarios y la validación de transiciones se ejecutarían en el servidor. Las pruebas JUnit podrían cubrir reglas, permisos y persistencia. Esta extensión queda abierta para que el equipo decida su alcance. La versión web local ya se puede ejecutar y presentar.

### DSL y restricciones

- El CIM es un objeto JSON con `version`, `id`, `nombre`, `objetivo`, `entidad`, `actores`, `datos`, `inicio`, `estados`, `transiciones` y `ocl`.
- Los datos se declaran con `Texto`, `Entero`, `Fecha`, `Seleccion` o `Booleano`. En `Seleccion`, declara una lista `opciones` de objetos con `id` y `nombre`. Cada transición indica quién actúa, de qué estado parte y adónde lleva. Abre **Manual** en el Studio para ver un tutorial y un ejemplo completo de campo.
- El evaluador implementa un subconjunto de OCL. Admite invariantes `context Clase inv Nombre: ...` y precondiciones `context Clase::operacion() pre Nombre: ...`. Soporta comparaciones con enteros, `self.campo.size()` en texto y conjunciones con `and`. Una comparación sobre un campo ausente no se cumple. Una expresión fuera de este subconjunto produce un error de generación.
- Las invariantes se verifican al crear el caso y antes de cada transición. La precondición `MotivoSuficiente` se comprueba al intentar aprobar. Su regla exige al menos ocho caracteres.

## Generar un CRUD

Desde **Proyectos**, abre **Inventario de laboratorio** o crea un proyecto con **CRUD básico**. En **CIM → Estructura** puedes editar los campos y las reglas. En **CIM → Editar JSON** puedes consultar o modificar el modelo fuente.

El [CIM de inventario](models/inventario.cim.json) declara `tipo: "crud"`, la entidad `Producto`, sus datos, la unicidad de SKU y la invariante de stock no negativo. El [PIM](generado/inventario.pim.json) contiene las cuatro operaciones lógicas y el [PSM](generado/inventario.psm.json) incorpora la tabla web, los controles y el almacenamiento. La [aplicación generada](generado/inventario.html) permite buscar, crear, editar y eliminar registros. El stock se actualiza editando el registro y las reglas se comprueban al guardar.

Los datos pertenecen al navegador que abre el HTML. La vista previa del Studio conserva registros durante su ejecución. El ejemplo representa un catálogo con una entidad y existencias editables.

## Gestión de laboratorio integrada

Abre **Gestión de laboratorio** desde Proyectos o la [aplicación generada](generado/gestion-laboratorio.html). El [CIM](models/laboratorio.cim.json) vincula `Prestamo.equipo` con el catálogo de `Producto`. En `integracion` se declaran la clave del catálogo, el campo de existencias, la cantidad y las transiciones de entrada y salida. El [PIM](generado/gestion-laboratorio.pim.json) conserva esa relación y las operaciones. El [PSM](generado/gestion-laboratorio.psm.json) la convierte en un selector de inventario. En [Trazabilidad](generado/gestion-laboratorio.traza.json) puedes seguir los cambios de stock hasta las transiciones.

1. En **Inventario**, crea un microscopio con SKU `MIC-01`, categoría Equipos y stock de **3**.
2. En **Solicitudes**, como **Estudiante**, registra dos préstamos de **2** unidades para ese microscopio, uno a nombre de Ana y otro de Luis. Usa **3 días** y el motivo **Práctica de laboratorio** en ambos. Cambia a **Responsable** y aprueba los dos casos.
3. Entrega el primero. El inventario queda en **1**. Intenta entregar el segundo. La aplicación indica que solo queda una unidad y mantiene el caso **Aprobado**. El stock se descuenta al entregar.
4. Devuelve el primero como **Estudiante**. El inventario vuelve a **3** y en **Movimientos** puedes consultar el descuento y la reposición. Abre **Trazabilidad** en el Studio y elige **Integración** para ver cómo se generaron el selector y ambos movimientos.

El compilador comprueba que las transiciones de entrada y salida estén correctamente ordenadas y que ningún camino termine con unidades pendientes de devolver. La aplicación guarda solicitudes, productos y movimientos juntos en el almacenamiento local de un navegador. El alcance es una demostración de una sola sesión, con roles simulados y un catálogo por flujo.

## Guion para exponer

1. Abre el Studio. Muestra el CIM, los actores y las ramas de aprobación y rechazo.
2. Abre PIM y PSM. Señala cómo `cantidad` pasa de dato de negocio a propiedad lógica, luego a control HTML de tipo `number`. Muestra la misma fila en Trazabilidad.
3. Pulsa **Generar aplicación**. Como Estudiante, intenta crear un caso con seis unidades y observa que `CantidadValida` lo bloquea. Usa dos unidades, cinco días y **Práctica de óptica** como motivo para crearlo.
4. Cambia a Responsable, aprueba el caso y registra la entrega. Vuelve a Estudiante para registrar la devolución. Muestra el historial. La rama alternativa permite rechazar un caso pendiente.
5. Vuelve al CIM y cambia el límite de unidades de `5` a `3`, o añade un campo `curso` de tipo `Texto`. Genera de nuevo y muestra el cambio en el formulario o en la validación. Descarga el HTML para demostrar que se ejecuta por separado.

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


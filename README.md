# MDA Studio

Proyecto de interciclo de Nuevos Paradigmas de Programación. Modela un proceso de negocio en JSON o desde un diagrama y genera una aplicación web autónoma con formularios, transiciones por rol, validación y registro de casos. Incluye dos ejemplos, Préstamos de laboratorio y Compras institucionales.

## Abrir la demostración

Clona el repositorio o descárgalo como ZIP y extráelo. Abre [generado/index.html](generado/index.html) con Edge o Chrome desde tu equipo. El HTML ya incluye el compilador y las plantillas, así que puedes probar el Studio sin instalar dependencias ni iniciar un servidor. También puedes abrir directamente las aplicaciones de [Préstamos](generado/prestamos-lab.html) y [Compras](generado/compras-institucionales.html).

Para regenerar desde PowerShell en la carpeta del proyecto, usa Node.js 22 o posterior. Instala las dependencias de compilación con `npm ci` la primera vez. El HTML que se entrega ya incluye CodeMirror y se puede abrir sin conexión.

~~~powershell
npm ci
node generar.mjs
node generar.mjs models/prestamos.cim.json generado
~~~

El segundo comando permite indicar otro modelo y otro directorio de salida. Si el modelo es inválido, la generación aborta antes de escribir archivos. Los generados se pueden borrar y volver a crear con los modelos y el código fuente.

## Trabajar con varios proyectos

La pantalla **Proyectos** muestra los ejemplos de préstamos y compras, junto con los proyectos locales que crees. Abre uno para entrar al editor. Usa **← Proyectos** para volver a la biblioteca. **Nuevo proyecto** permite partir de un proceso básico, copiar el último proyecto abierto o usar cualquiera de los dos ejemplos. El título de la aplicación se define en `nombre` dentro del CIM.

El Studio guarda cada borrador, incluso mientras el JSON está incompleto, en el almacenamiento de este navegador. Al cambiar de proyecto, restaura su CIM y calcula sus propias salidas. Desde **Descargar** puedes guardar el CIM, PIM, PSM o HTML del proyecto activo. Para trasladar un proyecto, descarga su CIM, crea un proyecto en el otro navegador e importa ese archivo. Los HTML generados para proyectos distintos usan claves locales de casos independientes, incluso si sus CIM tienen el mismo identificador.

En el editor, **Proceso de negocio** y **Restricciones OCL** se despliegan al seleccionarlos. El proceso puede filtrarse por actor. La trazabilidad se puede buscar por texto y filtrar por campos, transiciones o reglas. La descarga JSON incluye todas las filas.

**CIM → Editar JSON** usa CodeMirror 6 con colores de sintaxis, números de línea, bloques plegables, búsqueda y diagnósticos de sintaxis. Usa `Ctrl+Enter` para generar desde el editor. **PIM** y **PSM** ofrecen **Inspeccionar JSON**, un árbol de solo lectura con secciones plegables. Sus archivos se descargan con **Descargar**.

En **PSM** o **Aplicación**, usa **Presentación de la aplicación** para elegir entre la bandeja y el tablero agrupado por estado. El Studio recuerda la selección por proyecto. La elección entra al PSM como `presentacion` y se incluye en el HTML exportado. Compras abre en tablero y préstamos en bandeja. Cambiar la presentación vuelve a cargar la vista previa y reinicia sus casos de prueba.

## Las ocho etapas del proyecto

MDA Studio implementa el recorrido **CIM → PIM → PSM → aplicación** con un DSL, un metamodelo y un compilador propios. La propuesta de clase orienta las etapas. Esta implementación usa JavaScript y genera una aplicación web autónoma.

| Etapa | Implementación en MDA Studio | Evidencia |
| --- | --- | --- |
| 01 · Análisis del problema | El CIM describe el objetivo, los actores, los datos y el flujo de negocio. La pestaña **Diagrama** representa estados y transiciones. | [CIM de Préstamos](models/prestamos.cim.json) |
| 02 · Diseño del metamodelo | Un metamodelo JSON define la estructura, los tipos y la presencia de propiedades del CIM, PIM y PSM. El compilador verifica la conformidad de los tres. | [Metamodelo](models/metamodelo.json) |
| 03 · Construcción del PIM | El generador deriva una entidad con campos tipados, roles, estados, operaciones y restricciones. El PIM expresa relaciones del proceso, como qué actor ejecuta una transición y qué estados conecta. | [PIM de Préstamos](generado/prestamos-lab.pim.json) |
| 04 · Validación OCL | El compilador revisa los contextos y tipos de un subconjunto de OCL. La aplicación evalúa invariantes al crear o avanzar un caso y precondiciones al ejecutar su transición. | [Análisis y generación de validadores](src/compiler.mjs) |
| 05 · Diseño del PSM | La estructura del destino web define controles de formulario, acciones, presentación y almacenamiento local. | [Estructura PSM en el metamodelo](models/metamodelo.json) |
| 06 · Transformación M2M | Dos transformaciones convierten automáticamente el CIM en PIM y el PIM en una instancia del PSM. Por ejemplo, un `Entero` lógico pasa a un control web `number`. | [PSM de Préstamos](generado/prestamos-lab.psm.json) |
| 07 · Generación M2T | El PSM alimenta una plantilla que genera HTML, CSS y JavaScript con el flujo y sus validadores. | [Plantilla](src/generated.html) · [HTML de Préstamos](generado/prestamos-lab.html) |
| 08 · Ejecución y pruebas | La aplicación se ejecuta en el navegador. El guion permite verificar transiciones, historial y el rechazo de solicitudes que incumplen una regla. | [Guion para exponer](#guion-para-exponer) |

La [trazabilidad](generado/prestamos-lab.traza.json) permite seguir cada campo, transición y regla desde el CIM hasta la aplicación. En la versión actual, cada proyecto modela un tipo de caso. La aplicación usa almacenamiento local y un selector para simular los actores durante la demostración.

### Posible extensión para el equipo

Podemos añadir un segundo destino de generación que transforme el mismo PIM en un **PSM de servidor**. Ese módulo generaría una aplicación Spring Boot con una API y persistencia en PostgreSQL. La autorización de usuarios y la validación de transiciones se ejecutarían en el servidor. Las pruebas JUnit podrían cubrir reglas, permisos y persistencia. Esta extensión queda abierta para que el equipo decida su alcance. La versión web local ya se puede ejecutar y presentar.

### DSL y restricciones

- El CIM es un objeto JSON con `version`, `id`, `nombre`, `objetivo`, `entidad`, `actores`, `datos`, `inicio`, `estados`, `transiciones` y `ocl`.
- Los datos se declaran con `Texto`, `Entero`, `Fecha`, `Seleccion` o `Booleano`. En `Seleccion`, declara una lista `opciones` de objetos con `id` y `nombre`. Cada transición indica quién actúa, de qué estado parte y adónde lleva. Abre **Manual** en el Studio para ver un tutorial y un ejemplo completo de campo.
- El evaluador implementa un subconjunto de OCL. Admite invariantes `context Clase inv Nombre: ...` y precondiciones `context Clase::operacion() pre Nombre: ...`. Soporta comparaciones con enteros, `self.campo.size()` en texto y conjunciones con `and`. Una comparación sobre un campo ausente no se cumple. Una expresión fuera de este subconjunto produce un error de generación.
- Las invariantes se verifican al crear el caso y antes de cada transición. La precondición `MotivoSuficiente` se comprueba al intentar aprobar. Su regla exige al menos ocho caracteres.

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


(() => {
  const $ = selector => document.querySelector(selector);
  const make = (tag, value, className) => {
    const node = document.createElement(tag);
    if (value !== undefined) node.textContent = value;
    if (className) node.className = className;
    return node;
  };
  const source = MdaJsonEditor.createJsonEditor($('#source'), {
    onChange: saveDraft,
    onCursor: (line, column) => { $('#source-location').textContent = 'Línea ' + line + ', columna ' + column; },
    onFormat: formatSource,
    onBuild: () => build(true),
  });
  const diagram = MdaJsonEditor.createDiagram($('#editor'), {
    read: compile.readCim,
    validate: compile.validateCim,
    change: text => {
      source.load(text);
      saveDraft();
      build(false);
    },
    editJson: () => {
      modelFormat = 'json';
      view('model');
      $('#source .cm-content').focus();
    },
  });
  const assets = TEMPLATES;
  const projectDialog = $('#project-dialog');
  const demoModel = JSON.parse(DEMO);
  const storagePrefix = 'mda.studio.v1.' + demoModel.id + '.';
  const initialProject = {
    id: 'original',
    name: demoModel.nombre,
    source: DEMO,
  };
  const advancedProject = { id: 'example-compras', name: JSON.parse(ADVANCED).nombre, source: ADVANCED };
  const inventoryProject = { id: 'example-inventario', name: JSON.parse(INVENTORY).nombre, source: INVENTORY };
  const laboratoryProject = { id: 'example-laboratorio', name: JSON.parse(LABORATORY).nombre, source: LABORATORY };
  const examples = new Map([
    [initialProject.id, DEMO],
    [advancedProject.id, ADVANCED],
    [inventoryProject.id, INVENTORY],
    [laboratoryProject.id, LABORATORY],
  ]);
  const projects = new Map([laboratoryProject, initialProject, advancedProject, inventoryProject].map(project => [project.id, project]));
  let active = initialProject;
  let canSave = true;
  let result;
  let draft;
  let current = 'model';
  let modelFormat = 'fields';
  let previewResult;
  let inspectedModel;
  let tracePage = 0;
  const tracePageSize = 8;
  const views = {
    model: ['01 · Modelo Independiente de la Computación (CIM)', 'Define actores, campos de negocio, flujo del proceso y reglas OCL sin atarte a una tecnología.'],
    pim: ['02 · Modelo Independiente de la Plataforma (PIM)', 'Especificación lógica Ecore/UML con clases, tipos formales, multiplicidades, operaciones y AST OCL.'],
    psm: ['03 · Modelo Específico de la Plataforma (PSM)', 'Arquitectura Web HTML5/JS, disposición visual (Bandeja vs Tablero) y esquema relacional SQL DDL.'],
    app: ['04 · Aplicación Ejecutable (M2T) y Persistencia', 'Prueba la aplicación generada, ábrela en otra pestaña y conéctala a Base de Datos / Archivo.'],
  };
  const typeNames = {
    movementType: 'Salida o entrada de inventario',
    crudType: 'crud',
    crudOperation: 'Crear, consultar, editar o eliminar',
    table: 'tabla',
    version: 'Versión 1',
    id: 'Identificador',
    nullableId: 'Identificador o nulo',
    class: 'Nombre de clase',
    text: 'Texto',
    bool: 'Booleano',
    int: 'Entero',
    domainType: 'Texto, Entero, Fecha, Seleccion o Booleano',
    ruleType: 'inv, pre o post',
    access: 'value o size',
    operator: 'Operador de comparación',
    ruleValue: 'Entero, texto, booleano o referencia self.campo',
    logicalOperator: 'and, or o implies',
    attributeOrigin: 'sistema o dominio',
    ecoreType: 'EString, EInt, EDate, EEnum, EBoolean o EList<EventoFlujo>',
    multiplicity: '0..1, 1..1, 0..* o 1..*',
    visibility: 'public, protected o private',
    relationKind: 'asociacion, composicion, dependencia o integracion',
    control: 'text, number, date, select o checkbox',
    presentation: 'bandeja o tablero',
  };

  function tableRow(...values) {
    const row = make('tr', '');
    row.append(...values.map(value => value instanceof Node ? (() => { const td = make('td', ''); td.append(value); return td; })() : make('td', value)));
    return row;
  }

  function renderMetamodel() {
    const structure = $('#metamodel-structure').value;
    const rows = Object.entries(METAMODEL[structure]).map(([key, type]) => {
      const optional = key.endsWith('?');
      const item = Array.isArray(type) ? type[0] : type;
      const name = typeNames[item] ?? item;
      const row = tableRow(optional ? key.slice(0, -1) : key, Array.isArray(type) ? 'Lista de ' + name : name,
        optional ? 'Opcional' : 'Obligatoria');
      if (Object.hasOwn(METAMODEL, item)) {
        const link = make('button', Array.isArray(type) ? 'Lista de ' + item : item);
        link.type = 'button';
        link.className = 'type-link';
        link.onclick = () => {
          $('#metamodel-structure').value = item;
          renderMetamodel();
          $('#metamodel-structure').focus();
        };
        row.cells[1].replaceChildren(link);
      }
      return row;
    });
    $('#metamodel-rows').replaceChildren(...rows);
  }

  function renderFields() {
    const model = result?.cim;
    const rows = $('#fields-rows');
    rows.replaceChildren();
    $('#fields-type').textContent = 'Tipo de negocio (CIM)';
    $('#fields-table').hidden = !model;
    const crud = model?.tipo === 'crud';
    $('#add-transition-btn').hidden = Boolean(crud);
    if (!model) {
      $('#fields-caption').textContent = 'Corrige o genera el modelo para consultar y editar sus campos.';
      return;
    }
    const catalog = model.integracion?.catalogo;
    const fields = model.datos ?? [];
    const shared = catalog?.datos ?? [];
    const changed = source.value !== draft;
    $('#fields-caption').textContent = 'Entidad ' + model.entidad + ' · ' + fields.length + ' campos de negocio' +
      (catalog ? ' + Catálogo ' + catalog.entidad + ' (' + shared.length + ' campos)' : '') +
      (changed ? ' · Cambios pendientes' : '');

    fields.forEach((field, index) => {
      const editBtn = make('button', 'Editar campo', 'table-action-btn');
      editBtn.type = 'button';
      editBtn.onclick = () => diagram.openItem('datos', index, {}, source.value, active.id);
      const uniqueTag = model.unicos?.includes(field.id) ? ' · Único' : '';
      rows.append(tableRow(
        catalog ? model.entidad + ' · ' + field.nombre : field.nombre,
        field.id,
        field.tipo,
        (field.requerido ? 'Obligatorio' : 'Opcional') + uniqueTag,
        field.opciones?.map(option => option.nombre + ' (' + option.id + ')').join(', ') ?? '—',
        editBtn,
      ));
    });

    if (catalog) {
      for (const field of shared) {
        const badge = make('span', 'Catálogo vinculado', 'muted-badge');
        rows.append(tableRow(
          catalog.entidad + ' · ' + field.nombre,
          field.id,
          field.tipo,
          (field.requerido ? 'Obligatorio' : 'Opcional') + (catalog.unicos?.includes(field.id) ? ' · Único' : ''),
          field.opciones?.map(option => option.nombre).join(', ') ?? '—',
          badge,
        ));
      }
    }
  }

  function createUmlClassCard(entityPim) {
    const card = make('article', '', 'uml-class-card');
    const head = make('header', '', 'uml-class-head');
    head.append(
      make('span', entityPim.estereotipo + ' · ' + entityPim.paquete, 'uml-stereotype'),
      make('h3', entityPim.entidad),
      make('p', entityPim.objetivo),
    );

    const attrSection = make('div', '', 'uml-compartment');
    attrSection.append(make('h4', 'Atributos Ecore / UML (' + entityPim.atributos.length + ')'));
    const attrList = make('ul', '', 'uml-list');
    for (const attr of entityPim.atributos) {
      const li = make('li', '');
      const originBadge = make('span', attr.origen === 'sistema' ? 'Sistema' : 'Dominio',
        'uml-badge ' + (attr.origen === 'sistema' ? 'is-system' : 'is-domain'));
      const flags = [];
      if (attr.id === 'id') flags.push('PK');
      if (attr.unico) flags.push('unique');
      if (attr.soloLectura) flags.push('readOnly');
      const flagText = flags.length ? ' {' + flags.join(', ') + '}' : '';
      const enumText = attr.valoresEnum?.length ? ' [' + attr.valoresEnum.join(' | ') + ']' : '';
      const sig = make('code', (attr.soloLectura ? '🔒 ' : '+ ') + attr.id + ' : ' + attr.tipoEcore + ' [' + attr.multiplicidad + ']' + flagText + enumText);
      const label = make('small', attr.nombre + ' (CIM: ' + attr.tipoDominio + ')');
      li.append(originBadge, sig, label);
      attrList.append(li);
    }
    attrSection.append(attrList);

    const opSection = make('div', '', 'uml-compartment');
    opSection.append(make('h4', 'Operaciones y Transiciones Lógicas (' + entityPim.firmas.length + ')'));
    const opList = make('ul', '', 'uml-list');
    for (const op of entityPim.firmas) {
      const li = make('li', '');
      const transitionBadge = op.desde && op.hasta
        ? make('span', op.desde + ' → ' + op.hasta, 'uml-badge is-transition')
        : make('span', op.actor ? 'Inicio (' + op.actor + ')' : 'Operación CRUD', 'uml-badge is-op');
      const sig = make('code', '+ ' + op.id + '(' + op.parametros.join(', ') + ') : ' + op.retorno);
      const details = make('small', op.nombre +
        (op.guardas.length ? ' · Guardas OCL: [' + op.guardas.join(', ') + ']' : '') +
        (op.efectos.length ? ' · Efectos: ' + op.efectos.join(' / ') : ''));
      li.append(transitionBadge, sig, details);
      opList.append(li);
    }
    opSection.append(opList);

    card.append(head, attrSection, opSection);
    return card;
  }

  function renderPim() {
    const pim = result?.pim;
    const grid = $('#pim-uml-grid');
    const relList = $('#pim-relations-list');
    const astList = $('#pim-ocl-ast');
    grid.replaceChildren();
    relList.replaceChildren();
    astList.replaceChildren();
    if (!pim) return;

    grid.append(createUmlClassCard(pim));
    if (pim.integracion) {
      grid.append(createUmlClassCard(pim.integracion.catalogo));
    }

    if (pim.relaciones.length) {
      for (const rel of pim.relaciones) {
        const item = make('div', '', 'stage-item');
        const arrow = rel.tipo === 'composicion' ? ' *--> ' : ' --> ';
        item.append(
          make('strong', rel.origen + ' [' + rel.multiplicidadOrigen + ']' + arrow + '[' + rel.multiplicidadDestino + '] ' + rel.destino),
          make('small', 'Rol: ' + rel.rol + ' · Tipo UML: ' + rel.tipo.toUpperCase()),
        );
        relList.append(item);
      }
    } else {
      relList.append(make('p', 'Entidad autónoma sin asociaciones externas.', 'muted-note'));
    }

    const allRules = [
      ...pim.restricciones,
      ...(pim.integracion?.catalogo.restricciones ?? []),
    ];
    if (allRules.length) {
      for (const rule of allRules) {
        const item = make('div', '', 'stage-item');
        const kindMap = { inv: 'Invariante (inv)', pre: 'Precondición (pre)', post: 'Postcondición (post)' };
        const head = make('strong', rule.clase + (rule.operacion ? '::' + rule.operacion + '()' : '') + ' · ' + rule.id + ' [' + (kindMap[rule.tipo] ?? rule.tipo) + ']');
        const astDesc = rule.expresion.map((t, idx) => {
          const prefix = idx > 0 ? (t.conector ?? 'and').toUpperCase() + ' ' : '';
          const left = t.acceso === 'size' ? 'size(self.' + t.campo + ')' : 'self.' + t.campo;
          const right = t.campoDerecho ? 'self.' + t.campoDerecho : JSON.stringify(t.valor);
          return prefix + '(' + left + ' ' + t.operador + ' ' + right + ')';
        }).join(' ');
        item.append(head, make('code', 'AST: ' + astDesc), make('small', 'Fuente OCL: ' + rule.fuente));
        astList.append(item);
      }
    } else {
      astList.append(make('p', 'Sin reglas OCL declaradas. Añade una desde el panel lateral.', 'muted-note'));
    }

    const stem = exportStem();
    $('#pim-ecore-name').textContent = stem + '.pim.ecore';
    $('#pim-ocl-name').textContent = stem + '.pim.ocl';
    $('#pim-ecore-code').textContent = result.entregables.pimEcore;
    $('#pim-ocl-code').textContent = result.entregables.pimOcl;
  }

  function renderPsm() {
    const psm = result?.psm;
    const archDl = $('#psm-arch-dl');
    const wireframe = $('#psm-wireframe');
    const controlsRows = $('#psm-controls-rows');
    archDl.replaceChildren();
    wireframe.replaceChildren();
    controlsRows.replaceChildren();
    if (!psm) return;

    const archEntries = [
      ['Plataforma destino', psm.plataforma],
      ['Patrón de Interfaz (UI)', psm.arquitectura.patronUi],
      ['Disposición estructural', psm.arquitectura.disposicion],
      ['Adaptador de Base de Datos', psm.arquitectura.adaptadorDatos],
      ['Clave de almacén lógico', psm.almacen.clave],
      ['Seguridad y Validadores', psm.arquitectura.seguridad],
    ];
    for (const [dt, dd] of archEntries) {
      archDl.append(make('dt', dt), make('dd', dd));
    }

    $('#presentation-summary').textContent = psm.tipo === 'crud'
      ? 'Catálogo tabular CRUD + Persistencia SQL/IndexedDB'
      : psm.presentacion === 'tablero'
        ? 'Activo: Tablero Kanban (' + psm.estados.length + ' columnas de estado)'
        : 'Activo: Bandeja Maestro-Detalle (2 columnas)';

    $('#psm-wireframe-title').textContent = 'Disposición Visual Generada: ' + psm.arquitectura.patronUi;
    const wfHeader = make('div', '', 'wf-bar');
    wfHeader.textContent = 'Cabecera App: ' + psm.nombre + (psm.roles ? ' · Selector RBAC (' + psm.roles.length + ' roles)' : ' · Modo Catálogo CRUD');
    const wfDbBar = make('div', '', 'wf-db-bar');
    wfDbBar.textContent = 'Barra de Base de Datos: IndexedDB (' + psm.esquemaSql.tablas.length + ' tablas) + Conexión a archivo .db.json / Exportación .sql';
    wireframe.append(wfHeader, wfDbBar);

    if (psm.tipo === 'crud') {
      const grid = make('div', '', 'wf-crud');
      grid.append(
        make('div', 'Formulario Multi-columna (' + psm.campos.length + ' controles HTML5)', 'wf-box'),
        make('div', 'Tabla Filtrable CRUD (' + psm.campos.map(c => c.nombre).join(' | ') + ' | Editar / Eliminar)', 'wf-box'),
      );
      wireframe.append(grid);
    } else if (psm.presentacion === 'tablero') {
      const lanesWrap = make('div', '', 'wf-lanes');
      for (const st of psm.estados) {
        const lane = make('div', '', 'wf-lane' + (st.final ? ' is-final' : ''));
        lane.append(make('strong', st.nombre), make('small', st.final ? 'Columna Final' : 'Carril de Estado'));
        lanesWrap.append(lane);
      }
      const bottomSplit = make('div', '', 'wf-split');
      bottomSplit.append(
        make('div', 'Formulario: ' + psm.formulario.nombre + ' (Rol: ' + psm.formulario.actor + ')', 'wf-box'),
        make('div', 'Inspector de Caso + Botones de Transición + Historial', 'wf-box'),
      );
      wireframe.append(lanesWrap, bottomSplit);
    } else {
      const split = make('div', '', 'wf-split');
      const leftCol = make('div', '', 'wf-col');
      leftCol.append(
        make('div', 'Formulario: ' + psm.formulario.nombre + ' (' + psm.campos.length + ' campos)', 'wf-box'),
        make('div', 'Bandeja Vertical de Casos con Badges de Estado', 'wf-box'),
      );
      const rightCol = make('div', '', 'wf-col');
      rightCol.append(
        make('div', 'Inspector Maestro-Detalle + Disparadores por Rol + Bitácora (' + psm.acciones.length + ' acciones)', 'wf-box is-tall'),
      );
      split.append(leftCol, rightCol);
      wireframe.append(split);
    }

    const groups = [[psm.entidad, psm.campos]];
    if (psm.integracion) groups.push([psm.integracion.catalogo.entidad, psm.integracion.catalogo.campos]);
    for (const [entityName, fields] of groups) {
      for (const field of fields) {
        const tag = field.control === 'select'
          ? '<select name="' + field.id + '">'
          : '<input type="' + field.control + '" name="' + field.id + '">';
        const domAttrs = field.atributosHtml.length ? field.atributosHtml.join(' ') : 'opcional';
        const sqlCol = field.id.replace(/-/g, '_') + ' ' + field.tipoSql + (field.requerido ? ' NOT NULL' : ' NULL');
        controlsRows.append(tableRow(
          entityName + '.' + field.id + ' (' + field.nombre + ')',
          make('code', tag),
          make('code', domAttrs),
          make('code', sqlCol),
        ));
      }
    }

    $('#psm-sql-code').textContent = result.entregables.psmSql;
  }

  function renderDeliverables() {
    const bar = $('#deliverables-bar');
    bar.replaceChildren();
    const stem = exportStem();
    const label = make('span', 'Entregables MDA de esta fase:', 'deliverables-label');
    bar.append(label);

    const addBtn = (text, handler, primary = false) => {
      const btn = make('button', text, primary ? 'deliverable-btn is-primary' : 'deliverable-btn');
      btn.type = 'button';
      btn.onclick = handler;
      bar.append(btn);
    };

    if (current === 'model') {
      addBtn('Descargar CIM (.cim.json)', () => download(source.value, stem + '.cim.json', 'application/json'), true);
      if (result) {
        addBtn('Descargar Diagrama (.cim.svg)', () => {
          const svgContent = diagram.exportSvg(source.value);
          if (svgContent) download(svgContent, stem + '.cim.svg', 'image/svg+xml;charset=utf-8');
        });
        addBtn('Descargar Flujo Mermaid (.cim.mmd)', () => download(result.entregables.cimMermaid, stem + '.cim.mmd', 'text/plain;charset=utf-8'));
      }
    } else if (current === 'pim' && result) {
      addBtn('Descargar Eclipse Ecore (.pim.ecore)', () => download(result.entregables.pimEcore, stem + '.pim.ecore', 'application/xml;charset=utf-8'), true);
      addBtn('Descargar Reglas OCL (.pim.ocl)', () => download(result.entregables.pimOcl, stem + '.pim.ocl', 'text/plain;charset=utf-8'));
      addBtn('Descargar Modelo PIM (.pim.json)', () => downloadModel(result.pim, 'pim'));
    } else if (current === 'psm' && result) {
      addBtn('Descargar Esquema SQL (.psm.sql)', () => download(result.entregables.psmSql, stem + '.psm.sql', 'application/sql;charset=utf-8'), true);
      addBtn('Descargar JSON Schema (.psm.schema.json)', () => download(result.entregables.psmSchema, stem + '.psm.schema.json', 'application/schema+json;charset=utf-8'));
      addBtn('Descargar Modelo PSM (.psm.json)', () => downloadModel(result.psm, 'psm'));
    } else if (current === 'app' && result) {
      addBtn('Abrir aplicación en pestaña nueva ↗', openAppInNewTab, true);
      addBtn('Descargar Aplicación (.html)', () => download(result.html, stem + '.html', 'text/html;charset=utf-8'));
      addBtn('Descargar DDL Base de Datos (.psm.sql)', () => download(result.entregables.psmSql, stem + '.psm.sql', 'application/sql;charset=utf-8'));
      addBtn('Descargar Trazabilidad (.traza.csv)', () => download(result.entregables.traceCsv, stem + '.traza.csv', 'text/csv;charset=utf-8'));
    }
  }

  function openAppInNewTab() {
    if (!result) build(false);
    if (!result) return;
    const blob = new Blob([result.html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  function restoreProjects() {
    try {
      for (const key of Object.keys(localStorage)) {
        if (!key.startsWith(storagePrefix + 'project.')) continue;
        try {
          const project = JSON.parse(localStorage.getItem(key));
          if (project && key === storagePrefix + 'project.' + project.id &&
              typeof project.name === 'string' && typeof project.source === 'string') {
            projects.set(project.id, project);
          }
        } catch (error) {
          if (!(error instanceof SyntaxError)) throw error;
        }
      }
      active = projects.get(localStorage.getItem(storagePrefix + 'active')) ?? initialProject;
    } catch {
      canSave = false;
    }
  }

  function persistProject(saveSource) {
    if (canSave) {
      try {
        if (saveSource) localStorage.setItem(storagePrefix + 'project.' + active.id, JSON.stringify(active));
        localStorage.setItem(storagePrefix + 'active', active.id);
      } catch {
        canSave = false;
      }
    }
    const message = canSave ? 'Guardado en este navegador' :
      'Almacenamiento no disponible. Descarga el CIM antes de cerrar.';
    for (const selector of ['#project-status', '#library-status']) {
      const notice = $(selector);
      if (notice.textContent !== message) notice.textContent = message;
      notice.dataset.error = String(!canSave);
    }
  }

  function showLibrary() {
    $('#guide').hidden = true;
    $('#library').hidden = false;
    $('#editor').hidden = true;
    $('#compile').hidden = true;
    $('#open-new-tab-top').hidden = true;
    const list = $('#project-list');
    list.replaceChildren();
    for (const project of projects.values()) {
      const card = make('article', '');
      card.className = 'project-card';
      const sample = examples.has(project.id);
      let summary = 'Borrador de modelo CIM';
      try {
        const model = JSON.parse(project.source);
        if (typeof model?.objetivo === 'string') summary = model.objetivo;
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
      }
      const button = make('button', 'Abrir proyecto');
      button.type = 'button';
      button.setAttribute('aria-label', 'Abrir proyecto: ' + project.name);
      button.onclick = () => {
        openProject(project);
        $('#back-projects').focus();
      };
      const kind = make('p', sample ? 'EJEMPLO' : 'PROYECTO LOCAL');
      kind.className = 'eyebrow';
      card.append(kind, make('h2', project.name), make('p', summary), button);
      list.append(card);
    }
    window.scrollTo(0, 0);
  }

  function openProject(project) {
    $('#library').hidden = true;
    $('#editor').hidden = false;
    $('#compile').hidden = false;
    $('#open-new-tab-top').hidden = false;
    $('#project-caption').textContent = project.name;
    active = project;
    source.load(project.source);
    result = undefined;
    draft = undefined;
    previewResult = undefined;
    $('#preview').removeAttribute('srcdoc');
    $('#title').textContent = project.name;
    $('#description').textContent = '';
    $('#flow-start').textContent = '';
    for (const selector of ['#flow', '#rules', '#trace']) $(selector).replaceChildren();
    $('#trace-download').disabled = true;
    $('#trace-download-csv').disabled = true;
    $('#trace-search').value = '';
    $('#trace-kind').value = '';
    tracePage = 0;
    renderTrace();
    $('#flow-card').open = true;
    $('#rules-card').open = true;
    $('#flow-role').replaceChildren();
    $('#flow-count').textContent = '';
    $('#rules-count').textContent = '';
    $('#presentation').value = projectPresentation(project);
    persistProject(false);
    current = 'model';
    modelFormat = 'fields';
    build(false);
    window.scrollTo(0, 0);
  }

  function projectPresentation(project) {
    return project.presentation ?? (project.id === advancedProject.id ? 'tablero' : 'bandeja');
  }

  function basicModel(name, id) {
    return {
      version: 1,
      id: 'proceso-' + id,
      nombre: name,
      objetivo: 'Registrar y completar los casos de ' + name + '.',
      entidad: 'Caso',
      actores: [{ id: 'solicitante', nombre: 'Solicitante' }, { id: 'revisor', nombre: 'Revisor' }],
      datos: [{ id: 'asunto', nombre: 'Asunto', tipo: 'Texto', requerido: true }],
      inicio: { actor: 'solicitante', estado: 'pendiente', nombre: 'Nueva solicitud' },
      estados: [{ id: 'pendiente', nombre: 'Pendiente' }, { id: 'completado', nombre: 'Completado', final: true }],
      transiciones: [{ id: 'completar', nombre: 'Completar', actor: 'revisor', desde: 'pendiente', hasta: 'completado' }],
      ocl: [],
    };
  }

  function status(kind, message) {
    const badge = $('#build-status');
    badge.textContent = message;
    badge.dataset.kind = kind;
  }

  function jsonNode(key, value) {
    const name = make('span', typeof key === 'number' ? '[' + key + ']' : key);
    name.className = 'json-key';
    if (value === null || typeof value !== 'object') {
      const rendered = make('code', JSON.stringify(value));
      rendered.className = 'json-value ' + (value === null ? 'json-literal' : 'json-' + typeof value);
      const row = make('div', '');
      row.className = 'json-leaf';
      row.append(name, rendered);
      return row;
    }
    const array = Array.isArray(value);
    const entries = array ? value.map((entry, i) => [i, entry]) : Object.entries(value);
    const group = make('details', '');
    const summary = make('summary', '');
    const size = make('span', array ? '[' + entries.length + ']' : '{' + entries.length + '}');
    size.className = 'json-size';
    summary.append(name, size);
    group.append(summary);
    if (entries.length) {
      const children = make('div', '');
      children.className = 'json-children';
      for (const [childKey, childValue] of entries) children.append(jsonNode(childKey, childValue));
      group.append(children);
    }
    return group;
  }

  function renderInspector(stage) {
    const model = result?.[stage];
    $('#output-filename').textContent = (result?.cim.id ?? 'modelo') + '.' + stage + '.json';
    $('#output-hint').textContent = model
      ? (source.value === draft ? 'Salida estructurada generada desde el CIM.' : 'Última generación válida. Hay cambios pendientes en el CIM.') +
        ' Abre una sección para explorar el árbol JSON.'
      : 'Genera un CIM válido para obtener este modelo.';
    $('#output-tools').hidden = !model;
    const tree = $('#output-tree');
    tree.hidden = !model;
    if (inspectedModel === model) return;
    inspectedModel = model;
    tree.replaceChildren();
    if (!model) return;
    for (const [key, value] of Object.entries(model)) tree.append(jsonNode(key, value));
  }

  function formatSource() {
    const error = $('#source-error');
    try {
      const text = JSON.stringify(JSON.parse(source.value), null, 2);
      source.format(text);
      error.hidden = true;
    } catch (invalid) {
      error.textContent = 'Corrige la sintaxis antes de formatear. ' + invalid.message;
      error.hidden = false;
    }
  }

  function view(next) {
    if (next !== 'model' && modelFormat === 'diagram') modelFormat = 'fields';
    current = next;
    for (const button of document.querySelectorAll('[data-view]')) {
      button.setAttribute('aria-pressed', String(button.dataset.view === next));
    }
    $('#view-title').textContent = views[next][0];
    $('#view-subtitle').textContent = views[next][1];
    const structuredView = next !== 'app' && modelFormat === 'fields';
    const diagramView = next === 'model' && modelFormat === 'diagram';
    const crud = result?.cim.tipo === 'crud';

    const structuredLabels = {
      model: 'Campos y negocio',
      pim: 'Clases Ecore / UML y Reglas',
      psm: 'Arquitectura Web y Esquema SQL',
    };
    $('#show-fields').textContent = structuredLabels[next] ?? 'Vista estructurada';
    $('#show-diagram').textContent = crud ? 'Estructura visual' : 'Diagrama de flujo';
    $('#flow-card').hidden = crud;
    $('#integration-card').hidden = !result?.cim.integracion;
    $('#model-format').hidden = next === 'app';
    $('#show-fields').setAttribute('aria-pressed', String(structuredView));
    $('#show-json').setAttribute('aria-pressed', String(modelFormat === 'json'));
    $('#show-diagram').hidden = next !== 'model';
    $('#show-diagram').setAttribute('aria-pressed', String(diagramView));
    $('#show-json').textContent = next === 'model' ? 'Editar JSON (.cim)' : 'Inspeccionar JSON (.' + next + ')';

    $('#fields-panel').hidden = !(next === 'model' && structuredView);
    $('#pim-panel').hidden = !(next === 'pim' && structuredView);
    $('#psm-panel').hidden = !(next === 'psm' && structuredView);
    $('#source-panel').hidden = next !== 'model' || modelFormat !== 'json';
    $('#diagram-panel').hidden = !diagramView;

    if (!$('#source-panel').hidden) {
      $('#source-filename').textContent = (result?.cim.id ?? 'modelo') + '.cim.json';
      source.measure();
    }
    $('#load-button').hidden = next !== 'model';
    $('#reset').hidden = next !== 'model';
    $('#output').hidden = structuredView || !['pim', 'psm'].includes(next);
    $('#app-panel').hidden = next !== 'app';
    $('#model-summary').hidden = next === 'app' || diagramView;
    $('.workspace').classList.toggle('full-width', next === 'app' || diagramView);
    $('#presentation-panel').hidden = result?.cim.tipo === 'crud' || !['psm', 'app'].includes(next);
    $('#download').hidden = true;

    renderDeliverables();
    if (next === 'model' && structuredView) renderFields();
    if (next === 'pim' && structuredView) renderPim();
    if (next === 'psm' && structuredView) renderPsm();
    if (diagramView) diagram.show(source.value, active.id);
    if (!$('#output').hidden) renderInspector(next);
    if (next === 'app' && result && previewResult !== result) {
      const previous = $('#preview');
      const frame = previous.cloneNode(false);
      frame.srcdoc = result.html;
      previous.replaceWith(frame);
      previewResult = result;
    }
    if (next === 'app' && !result) {
      $('#preview').srcdoc = '<p>Genera la aplicación para abrir la vista previa.</p>';
    }
  }

  function markDraft(text) {
    source.load(text);
    saveDraft();
    build(false);
  }

  function saveDraft() {
    active.source = source.value;
    persistProject(true);
    status('dirty', 'Cambios por generar');
    $('#error').hidden = true;
    $('#source-error').hidden = true;
  }

  function renderFlow() {
    const cim = result?.cim;
    if (!cim) return;
    const states = new Map(cim.estados.map(state => [state.id, state]));
    const actors = new Map(cim.actores.map(actor => [actor.id, actor.nombre]));
    const label = id => states.get(id).nombre + (states.get(id).final ? ' (fin)' : '');
    $('#flow-start').textContent = 'Inicio: ' + cim.inicio.nombre + ' · ' + actors.get(cim.inicio.actor) + ' → ' + label(cim.inicio.estado);
    const flow = $('#flow');
    flow.replaceChildren();
    const actorFilter = $('#flow-role').value;
    cim.transiciones.forEach((edge, index) => {
      if (actorFilter && edge.actor !== actorFilter) return;
      const row = make('button', '', 'edge edge-btn');
      row.type = 'button';
      row.title = 'Clic para editar transición ' + edge.nombre;
      row.onclick = () => diagram.openItem('transiciones', index, {}, source.value, active.id);
      row.append(make('strong', label(edge.desde)), make('span', '→'), make('strong', label(edge.hasta)),
        make('small', edge.nombre + ' · ' + actors.get(edge.actor) + ' (editar)'));
      flow.append(row);
    });
    if (!flow.childElementCount) flow.append(make('p', 'Este actor no tiene transiciones.'));
  }

  function renderSummary(cim) {
    $('#title').textContent = cim.nombre;
    $('#description').textContent = cim.objetivo;
    if (cim.integracion) {
      const link = cim.integracion;
      const steps = link.movimientos.map(movement => make('li', cim.transiciones.find(edge => edge.id === movement.transicion).nombre +
        (movement.tipo === 'salida' ? ' · Descuenta existencias' : ' · Repone existencias')));
      $('#integration-link').textContent = cim.entidad + '.' + link.referencia + ' → ' + link.catalogo.entidad + '.' + link.clave;
      $('#integration-movements').replaceChildren(...steps);
    }
    if (cim.tipo !== 'crud') renderFlowSummary(cim);
    renderRuleSummary();
    renderTrace();
  }

  function renderFlowSummary(cim) {
    const roleFilter = $('#flow-role');
    const previous = roleFilter.value;
    const all = make('option', 'Todos los actores (' + cim.actores.length + ')');
    all.value = '';
    roleFilter.replaceChildren(all);
    for (const actor of cim.actores) {
      const option = make('option', actor.nombre);
      option.value = actor.id;
      roleFilter.append(option);
    }
    if (cim.actores.some(actor => actor.id === previous)) roleFilter.value = previous;
    $('#flow-count').textContent = cim.estados.length + ' estados · ' + cim.transiciones.length + ' transiciones';
    renderFlow();
  }

  function renderRuleSummary() {
    const rules = $('#rules');
    rules.replaceChildren();
    result.pim.restricciones.forEach((rule, index) => {
      const item = make('li', '', 'rule-item');
      const editBtn = make('button', '', 'rule-edit-btn');
      editBtn.type = 'button';
      editBtn.title = 'Clic para editar regla OCL ' + rule.id;
      editBtn.onclick = () => diagram.openItem('ocl', index, {}, source.value, active.id);
      const heading = make('strong', rule.id);
      const kindLabels = { inv: 'Invariante', pre: 'Precondición', post: 'Postcondición' };
      const type = make('span', kindLabels[rule.tipo] ?? rule.tipo);
      type.className = 'rule-type';
      heading.append(type);
      editBtn.append(heading, make('code', rule.fuente));
      item.append(editBtn);
      rules.append(item);
    });
    if (!rules.children.length) rules.append(make('li', 'El modelo no declara restricciones OCL.'));
    $('#rules-count').textContent = result.pim.restricciones.length + ' reglas';
  }

  function renderTrace() {
    const fold = value => value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('es');
    const query = fold($('#trace-search').value.trim());
    const kind = $('#trace-kind').value;
    const trace = result?.trace ?? [];
    const matching = trace.filter(row => (!kind || row.cim.startsWith(kind + '.')) &&
      (!query || Object.values(row).some(value => fold(value).includes(query))));
    tracePage = Math.min(tracePage, Math.max(0, Math.ceil(matching.length / tracePageSize) - 1));
    const start = tracePage * tracePageSize;
    const end = Math.min(start + tracePageSize, matching.length);
    const table = $('#trace');
    table.replaceChildren();
    for (const row of matching.slice(start, end)) {
      const entry = make('tr', '');
      entry.append(...Object.values(row).map(value => make('td', value)));
      table.append(entry);
    }
    $('#trace-download').disabled = !result;
    $('#trace-download-csv').disabled = !result;
    $('#trace-table').hidden = !matching.length;
    $('#trace-empty').hidden = matching.length > 0;
    $('#trace-empty').textContent = result ? 'No hay coincidencias con los filtros.' : 'Genera el modelo para ver su trazabilidad.';
    $('#trace-count').textContent = (matching.length ? (start + 1) + '–' + end : '0') + ' de ' + matching.length +
      (matching.length === trace.length ? ' elementos trazados' : ' resultados · ' + trace.length + ' en total');
    $('#trace-prev').disabled = tracePage === 0;
    $('#trace-next').disabled = end >= matching.length;
  }

  function build(openApp) {
    try {
      const presentation = $('#presentation').value;
      if (source.value !== draft || (result?.cim.tipo !== 'crud' && result?.psm.presentacion !== presentation)) {
        result = compile(source.value, assets, active.id === initialProject.id ? undefined : active.id, presentation);
        draft = source.value;
      }
      $('#error').hidden = true;
      status('valid', 'Flujo MDA validado y compilado');
      renderSummary(result.cim);
      view(openApp ? 'app' : current);
    } catch (error) {
      status('error', 'Modelo con errores de conformidad');
      $('#error').textContent = error.message;
      $('#error').hidden = false;
      if (modelFormat !== 'diagram') modelFormat = 'json';
      view('model');
    }
  }

  function download(body, filename, mime) {
    const url = URL.createObjectURL(new Blob([body], { type: mime }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function downloadModel(value, suffix) {
    download(JSON.stringify(value, null, 2), exportStem() + '.' + suffix + '.json', 'application/json');
  }

  function exportStem() {
    const modelId = result?.cim.id ?? 'modelo';
    return active.id === initialProject.id ? modelId : modelId + '-' + active.id.slice(0, 8);
  }

  $('#back-projects').onclick = () => {
    showLibrary();
    $('#new-project').focus();
  };
  let guideScroll = 0;
  $('#open-guide').onclick = () => {
    if (!$('#guide').hidden) return;
    guideScroll = window.scrollY;
    $('#library').hidden = true;
    $('#guide').hidden = false;
    $('#guide-title').focus();
    window.scrollTo(0, 0);
  };
  $('#close-guide').onclick = () => {
    $('#guide').hidden = true;
    $('#library').hidden = false;
    $('#open-guide').focus({ preventScroll: true });
    window.scrollTo(0, guideScroll);
  };
  $('#guide-new-project').onclick = () => {
    showLibrary();
    $('#new-project').focus();
    $('#new-project').click();
  };
  for (const link of document.querySelectorAll('.guide-index a')) {
    link.onclick = event => {
      event.preventDefault();
      const section = $(link.getAttribute('href'));
      section.focus({ preventScroll: true });
      section.scrollIntoView();
    };
  }
  $('#new-project').onclick = () => {
    $('#project-form').reset();
    $('#copy-option').textContent = 'Copiar ' + active.name;
    $('#project-name').setCustomValidity('');
    projectDialog.showModal();
  };
  $('#cancel-project').onclick = () => projectDialog.close();
  $('#project-name').oninput = event => event.target.setCustomValidity('');
  $('#project-form').onsubmit = event => {
    event.preventDefault();
    const nameInput = $('#project-name');
    const name = nameInput.value.trim();
    if (!name || [...projects.values()].some(project => project.name.toLocaleLowerCase('es') === name.toLocaleLowerCase('es'))) {
      nameInput.setCustomValidity(name ? 'Ya existe un proyecto con ese nombre.' : 'Escribe un nombre para el proyecto.');
      nameInput.reportValidity();
      return;
    }
    const id = globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
    const template = $('#project-template').value;
    let modelSource = active.source;
    if (template !== 'copy') {
      const samples = { example: EXAMPLE, advanced: ADVANCED, inventory: INVENTORY, laboratory: LABORATORY };
      const model = samples[template]
        ? { ...JSON.parse(samples[template]), id: 'modelo-' + id, nombre: name }
        : template === 'crud'
          ? { version: 1, tipo: 'crud', id: 'modelo-' + id, nombre: name, objetivo: 'Gestionar los registros de ' + name + '.',
              entidad: 'Registro', datos: [{ id: 'nombre', nombre: 'Nombre', tipo: 'Texto', requerido: true }], ocl: [] }
          : basicModel(name, id);
      modelSource = JSON.stringify(model, null, 2);
    }
    const presentation = template === 'advanced' ? 'tablero' :
      template === 'copy' ? projectPresentation(active) : 'bandeja';
    const project = { id, name, source: modelSource, presentation };
    projects.set(id, project);
    projectDialog.close();
    openProject(project);
    persistProject(true);
    $('#back-projects').focus();
  };

  for (const button of document.querySelectorAll('[data-view]')) {
    button.onclick = () => view(button.dataset.view);
  }
  $('#show-fields').onclick = () => { modelFormat = 'fields'; view(current); };
  $('#show-json').onclick = () => { modelFormat = 'json'; view(current); };
  $('#show-diagram').onclick = () => { modelFormat = 'diagram'; view('model'); };

  $('#add-field-btn').onclick = () => diagram.openItem('datos', undefined, {}, source.value, active.id);
  $('#add-transition-btn').onclick = () => diagram.openItem('transiciones', undefined, {}, source.value, active.id);
  $('#add-ocl-btn').onclick = () => diagram.openItem('ocl', undefined, {}, source.value, active.id);
  $('#side-add-actor').onclick = () => diagram.openItem('actores', undefined, {}, source.value, active.id);
  $('#side-add-state').onclick = () => diagram.openItem('estados', undefined, {}, source.value, active.id);
  $('#side-add-transition').onclick = () => diagram.openItem('transiciones', undefined, {}, source.value, active.id);
  $('#side-edit-start').onclick = () => diagram.openItem('inicio', 0, {}, source.value, active.id);
  $('#side-add-rule').onclick = () => diagram.openItem('ocl', undefined, {}, source.value, active.id);

  $('#btn-dl-ecore').onclick = () => result && download(result.entregables.pimEcore, exportStem() + '.pim.ecore', 'application/xml;charset=utf-8');
  $('#btn-dl-ocl').onclick = () => result && download(result.entregables.pimOcl, exportStem() + '.pim.ocl', 'text/plain;charset=utf-8');
  $('#btn-dl-sql').onclick = () => result && download(result.entregables.psmSql, exportStem() + '.psm.sql', 'application/sql;charset=utf-8');
  $('#open-app-tab').onclick = openAppInNewTab;
  $('#open-new-tab-top').onclick = openAppInNewTab;
  $('#download-app-html').onclick = () => result && download(result.html, exportStem() + '.html', 'text/html;charset=utf-8');

  for (const type of Object.keys(METAMODEL)) {
    if (!['CIM', 'PIM', 'PSM', 'CIMCrud', 'PIMCrud', 'PSMCrud'].includes(type)) $('#metamodel-types').append(make('option', type));
  }
  $('#open-metamodel').onclick = () => {
    $('#metamodel-structure').value = 'CIM';
    renderMetamodel();
    $('#metamodel-dialog').showModal();
  };
  $('#close-metamodel').onclick = () => $('#metamodel-dialog').close();
  $('#metamodel-structure').onchange = renderMetamodel;
  $('#metamodel-download').onclick = () => download(JSON.stringify(METAMODEL, null, 2), 'metamodelo.json', 'application/json');
  $('#compile').onclick = () => build(true);
  $('#presentation').onchange = event => {
    active.presentation = event.target.value;
    persistProject(true);
    build(false);
  };
  $('#flow-role').onchange = renderFlow;
  for (const selector of ['#trace-search', '#trace-kind']) {
    $(selector).addEventListener('input', () => {
      tracePage = 0;
      renderTrace();
    });
  }
  $('#trace-prev').onclick = () => { tracePage--; renderTrace(); };
  $('#trace-next').onclick = () => { tracePage++; renderTrace(); };
  $('#reset').onclick = () => markDraft(examples.get(active.id) ?? (result?.cim.tipo === 'crud' ? INVENTORY : EXAMPLE));
  $('#load-button').onclick = () => $('#load').click();
  $('#load').onchange = async event => {
    const file = event.target.files[0];
    if (!file) return;
    const project = active;
    try {
      const text = await file.text();
      if (active === project) markDraft(text);
    } catch {
      $('#error').textContent = 'No se pudo leer el archivo.';
      $('#error').hidden = false;
    } finally {
      event.target.value = '';
    }
  };
  $('#source-search').onclick = () => source.search();
  $('#source-format').onclick = formatSource;
  for (const [selector, open] of [['#output-expand', true], ['#output-collapse', false]]) {
    $(selector).onclick = () => {
      for (const section of document.querySelectorAll('#output-tree details')) section.open = open;
    };
  }
  $('#trace-download').onclick = () => downloadModel(result.trace, 'traza');
  $('#trace-download-csv').onclick = () => result && download(result.entregables.traceCsv, exportStem() + '.traza.csv', 'text/csv;charset=utf-8');
  $('#trace-download').disabled = true;
  $('#trace-download-csv').disabled = true;
  restoreProjects();
  persistProject(false);
  showLibrary();
})();

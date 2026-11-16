(() => {
  const $ = selector => document.querySelector(selector);
  const systemTheme = matchMedia('(prefers-color-scheme: dark)');
  const themeToggle = $('#theme-toggle');
  let preferredTheme = typeof studioTheme !== 'undefined' ? studioTheme : null;

  function currentTheme() {
    return preferredTheme ?? (systemTheme.matches ? 'dark' : 'light');
  }

  function updateTheme() {
    const theme = currentTheme();
    document.documentElement.dataset.theme = theme;
    themeToggle.setAttribute('aria-pressed', String(theme === 'dark'));
    $('#theme-label').textContent = theme === 'dark' ? 'Claro' : 'Oscuro';
    $('#preview').contentWindow?.postMessage({ type: 'mda-preview-theme', theme }, '*');
  }

  themeToggle.onclick = () => {
    const theme = currentTheme() === 'dark' ? 'light' : 'dark';
    preferredTheme = theme;
    try { localStorage.setItem('mda.studio.theme', theme); } catch {}
    updateTheme();
  };
  systemTheme.addEventListener('change', updateTheme);
  updateTheme();

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
    onBuild: () => goToStage('pim'),
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
  const previousLaboratoryModels = new Set([
    '54eac67615e3a664aca25faecc73e2bd0d8812fc6b3cac40a6e864e070c92fd0', // Ejemplo anterior a las solicitudes de corrección.
    '0c01e8bbcf518fc9283cc4d1f78e0c8655bd45cf7f4d615da2e47ac6819956f8', // Ejemplo con corrección y sin filtro de equipos activos.
  ]);
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
  const generatedFormats = { pim: 'fields', psm: 'fields' };
  const formats = {
    model: { fields: 'Campos', diagram: 'Diagrama', json: 'Editar JSON' },
    pim: { fields: 'Campos y tipos', secondary: 'Clases', tertiary: 'Reglas OCL', json: 'JSON' },
    psm: { fields: 'Interfaz', secondary: 'Mapeo', tertiary: 'Datos y SQL', json: 'JSON' },
    app: {},
  };
  let previewResult;
  let inspectedModel;
  let tracePage = 0;
  const tracePageSize = 8;
  const stages = [
    { id: 'model', name: 'CIM', next: 'Validar y ver PIM' },
    { id: 'pim', name: 'PIM', next: 'Ver PSM' },
    { id: 'psm', name: 'PSM', next: 'Generar aplicación' },
    { id: 'app', name: 'Aplicación' },
  ];
  const views = {
    model: ['Modelo de negocio', 'Edita los campos o define el flujo en el diagrama.'],
    pim: ['Modelo lógico', 'Consulta los tipos, las relaciones y las reglas del dominio.'],
    psm: ['Modelo web', 'Consulta los controles, la presentación y el almacenamiento.'],
    app: ['Aplicación generada', 'Ejecuta solicitudes y comprueba su efecto en los datos.'],
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

    if (catalog && fields.length) {
      const groupRow = make('tr', '', 'field-group');
      const heading = make('td', model.entidad + ' · ' + fields.length + ' campos');
      heading.colSpan = 6;
      groupRow.append(heading);
      rows.append(groupRow);
    }

    fields.forEach((field, index) => {
      const editBtn = make('button', 'Editar campo', 'table-action-btn');
      editBtn.type = 'button';
      editBtn.onclick = () => diagram.openItem('datos', index, {}, source.value, active.id);
      const uniqueTag = model.unicos?.includes(field.id) ? ' · Único' : '';
      const typeBadge = make('span', field.tipo, 'field-type');
      rows.append(tableRow(
        field.nombre,
        field.id,
        typeBadge,
        (field.requerido ? 'Obligatorio' : 'Opcional') + uniqueTag,
        field.opciones?.map(option => option.nombre + ' (' + option.id + ')').join(', ') ?? '—',
        editBtn,
      ));
    });

    if (catalog && shared.length) {
      const groupRow = make('tr', '', 'field-group');
      const heading = make('td', catalog.entidad + ' · ' + shared.length + ' campos');
      heading.colSpan = 6;
      groupRow.append(heading);
      rows.append(groupRow);
      for (const field of shared) {
        const typeBadge = make('span', field.tipo, 'field-type');
        rows.append(tableRow(
          field.nombre,
          field.id,
          typeBadge,
          (field.requerido ? 'Obligatorio' : 'Opcional') + (catalog.unicos?.includes(field.id) ? ' · Único' : ''),
          field.opciones?.map(option => option.nombre).join(', ') ?? '—',
          make('span', 'Catálogo vinculado', 'catalog-badge'),
        ));
      }
    }
  }

  function createUmlClassCard(entityPim) {
    const card = make('article', '', 'uml-class-card');
    const head = make('header', '', 'uml-class-head');
    head.append(make('h3', entityPim.entidad));

    const attrSection = make('details', '', 'uml-compartment');
    attrSection.append(make('summary', 'Atributos (' + entityPim.atributos.length + ')'));
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
      const sig = make('code', attr.id + ' · ' + attr.tipoEcore + ' [' + attr.multiplicidad + ']' + flagText + enumText);
      const label = make('small', attr.nombre + ' (CIM: ' + attr.tipoDominio + ')');
      li.append(originBadge, sig, label);
      attrList.append(li);
    }
    attrSection.append(attrList);

    const opSection = make('details', '', 'uml-compartment');
    opSection.append(make('summary', 'Operaciones (' + entityPim.firmas.length + ')'));
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

  function renderPimFields(pim) {
    const entities = pim.integracion ? [pim, pim.integracion.catalogo] : [pim];
    const table = $('#pim-fields-table');
    for (const body of [...table.tBodies]) body.remove();
    for (const entity of entities) {
      const body = table.createTBody();
      const group = make('tr', '', 'entity-group');
      const heading = make('th', entity.entidad);
      heading.scope = 'rowgroup';
      heading.colSpan = 4;
      group.append(heading);
      body.append(group);
      for (const attribute of entity.atributos.filter(item => item.origen === 'dominio')) {
        body.append(tableRow(attribute.nombre, make('code', attribute.id), attribute.tipoEcore, attribute.multiplicidad));
      }
    }
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
    renderPimFields(pim);

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
        const item = make('details', '', 'stage-item rule-detail');
        const kindMap = { inv: 'Invariante (inv)', pre: 'Precondición (pre)', post: 'Postcondición (post)' };
        const head = make('summary', rule.clase + (rule.operacion ? '::' + rule.operacion + '()' : '') + ' · ' + rule.id + ' [' + (kindMap[rule.tipo] ?? rule.tipo) + ']');
        const astDesc = rule.expresion.map((t, idx) => {
          const prefix = idx > 0 ? (t.conector ?? 'and').toUpperCase() + ' ' : '';
          const left = t.acceso === 'size' ? 'size(self.' + t.campo + ')' : 'self.' + t.campo;
          const right = t.campoDerecho ? 'self.' + t.campoDerecho : JSON.stringify(t.valor);
          return prefix + '(' + left + ' ' + t.operador + ' ' + right + ')';
        }).join(' ');
        item.append(head, make('code', rule.fuente), make('small', 'Expresión analizada · ' + astDesc));
        astList.append(item);
      }
    } else {
      astList.append(make('p', 'Este modelo no tiene reglas OCL. Puedes añadirlas en el CIM.', 'muted-note'));
    }
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
      ['Aplicación', 'HTML5 y JavaScript'],
      ['Almacenamiento', psm.arquitectura.adaptadorDatos],
      ['Validación', psm.arquitectura.seguridad],
    ];
    for (const [dt, dd] of archEntries) {
      archDl.append(make('dt', dt), make('dd', dd));
    }

    $('#psm-wireframe-title').textContent = psm.tipo === 'crud' ? 'Formulario y tabla' :
      psm.presentacion === 'tablero' ? 'Tablero por estado' : 'Lista de casos';
    wireframe.append(make('div', psm.nombre, 'wf-bar'));

    if (psm.tipo === 'crud') {
      const grid = make('div', '', 'wf-crud');
      grid.append(
        make('div', 'Formulario (' + psm.campos.length + ' controles HTML5)', 'wf-box'),
        make('div', 'Tabla de registros (' + psm.campos.length + ' columnas)', 'wf-box'),
      );
      wireframe.append(grid);
    } else if (psm.presentacion === 'tablero') {
      const lanesWrap = make('div', '', 'wf-lanes');
      for (const st of psm.estados) {
        const lane = make('div', '', 'wf-lane' + (st.final ? ' is-final' : ''));
        lane.append(make('strong', st.nombre));
        if (st.final) lane.append(make('small', 'Estado final'));
        lanesWrap.append(lane);
      }
      const bottomSplit = make('div', '', 'wf-split');
      bottomSplit.append(
        make('div', 'Formulario: ' + psm.formulario.nombre + ' (Rol: ' + psm.formulario.actor + ')', 'wf-box'),
        make('div', 'Detalle del caso · Acciones e historial', 'wf-box'),
      );
      wireframe.append(lanesWrap, bottomSplit);
    } else {
      const split = make('div', '', 'wf-split');
      const leftCol = make('div', '', 'wf-col');
      leftCol.append(
        make('div', 'Formulario: ' + psm.formulario.nombre + ' (' + psm.campos.length + ' campos)', 'wf-box'),
        make('div', 'Lista de casos y sus estados', 'wf-box'),
      );
      const rightCol = make('div', '', 'wf-col');
      rightCol.append(
        make('div', 'Detalle del caso · Acciones e historial', 'wf-box is-tall'),
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
    $('#exports-caption').textContent = 'Archivos de ' + stages.find(stage => stage.id === current).name;
    $('#cim-file-actions').hidden = current !== 'model';
    const pimFiles = current === 'pim' && result;
    $('#pim-file-previews').hidden = !pimFiles;
    if (pimFiles) {
      for (const panel of $('#pim-file-previews').querySelectorAll('details')) panel.open = false;
      $('#pim-ecore-code').textContent = result.entregables.pimEcore;
      $('#pim-ocl-code').textContent = result.entregables.pimOcl;
    }

    const addBtn = (text, handler) => {
      const btn = make('button', text, 'deliverable-btn');
      btn.type = 'button';
      btn.onclick = handler;
      bar.append(btn);
    };

    if (current === 'model') {
      addBtn('Descargar CIM (.cim.json)', () => download(source.value, stem + '.cim.json', 'application/json'));
      if (result && draft === source.value) {
        addBtn('Descargar Diagrama (.cim.svg)', () => {
          const svgContent = diagram.exportSvg(source.value);
          if (svgContent) download(svgContent, stem + '.cim.svg', 'image/svg+xml;charset=utf-8');
        });
        addBtn('Descargar Flujo Mermaid (.cim.mmd)', () => download(result.entregables.cimMermaid, stem + '.cim.mmd', 'text/plain;charset=utf-8'));
      }
    } else if (current === 'pim' && result) {
      addBtn('Descargar Eclipse Ecore (.pim.ecore)', () => download(result.entregables.pimEcore, stem + '.pim.ecore', 'application/xml;charset=utf-8'));
      addBtn('Descargar Reglas OCL (.pim.ocl)', () => download(result.entregables.pimOcl, stem + '.pim.ocl', 'text/plain;charset=utf-8'));
      addBtn('Descargar Modelo PIM (.pim.json)', () => downloadModel(result.pim, 'pim'));
    } else if (current === 'psm' && result) {
      addBtn('Descargar Esquema SQL (.psm.sql)', () => download(result.entregables.psmSql, stem + '.psm.sql', 'application/sql;charset=utf-8'));
      addBtn('Descargar JSON Schema (.psm.schema.json)', () => download(result.entregables.psmSchema, stem + '.psm.schema.json', 'application/schema+json;charset=utf-8'));
      addBtn('Descargar Modelo PSM (.psm.json)', () => downloadModel(result.psm, 'psm'));
    } else if (current === 'app' && result) {
      addBtn('Descargar aplicación (.html)', () => download(result.html, stem + '.html', 'text/html;charset=utf-8'));
    }
  }

  function openAppInNewTab() {
    if (!result) build();
    if (!result) return;
    const themedHtml = result.html.replace('<html lang="es">', '<html lang="es" data-theme="' + currentTheme() + '">');
    const blob = new Blob([themedHtml], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  async function isPreviousLaboratoryModel(text) {
    if (text === LABORATORY || !globalThis.crypto?.subtle) return false;
    try {
      const model = JSON.parse(text.replace(/^\uFEFF/, ''));
      const canonical = JSON.stringify(model, (_, value) => value && typeof value === 'object' && !Array.isArray(value)
        ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value);
      const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
      return previousLaboratoryModels.has(Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join(''));
    } catch {
      return false;
    }
  }

  function storeProject(project) {
    const stored = examples.get(project.id) === project.source ? { ...project, source: null } : project;
    localStorage.setItem(storagePrefix + 'project.' + project.id, JSON.stringify(stored));
  }

  async function restoreProjects() {
    try {
      for (const key of Object.keys(localStorage)) {
        if (!key.startsWith(storagePrefix + 'project.')) continue;
        try {
          const project = JSON.parse(localStorage.getItem(key));
          if (!project || key !== storagePrefix + 'project.' + project.id || typeof project.name !== 'string') continue;
          const source = project.source === null ? examples.get(project.id) : project.source;
          if (typeof source === 'string') projects.set(project.id, { ...project, source });
        } catch (error) {
          if (!(error instanceof SyntaxError)) throw error;
        }
      }
      const lab = projects.get(laboratoryProject.id);
      if (await isPreviousLaboratoryModel(lab.source)) {
        const upgraded = { ...lab, source: LABORATORY };
        projects.set(upgraded.id, upgraded);
        storeProject(upgraded);
      }
      active = projects.get(localStorage.getItem(storagePrefix + 'active')) ?? initialProject;
    } catch {
      canSave = false;
    }
  }

  function persistProject(saveSource) {
    if (canSave) {
      try {
        if (saveSource) storeProject(active);
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

  const PROJECT_ICONS = {"flow":"<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M5 19V5h14M5 12h8v6h6M16 3l3 2-3 2m0 9 3 2-3 2\"/></svg>","catalog":"<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M4 7h16v13H4zM3 4h18v3M9 11h6m-6 5h6\"/></svg>","linked":"<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M4 4h7v7H4zM13 13h7v7h-7zM11 7.5h5.5V13M7.5 11v5.5H13\"/></svg>"};

  function showLibrary() {
    $('#guide').hidden = true;
    $('#library').hidden = false;
    $('#editor').hidden = true;
    renderProjects();
    window.scrollTo(0, 0);
  }

  function renderProjects() {
    const list = $('#project-list');
    const query = searchText($('#project-search').value.trim());
    list.replaceChildren();
    for (const project of projects.values()) {
      const card = make('article', '');
      card.className = 'project-card';
      const sample = examples.has(project.id);
      let summary = 'Borrador de modelo CIM';
      let type = 'flow';
      try {
        const model = JSON.parse(project.source);
        if (typeof model?.objetivo === 'string') summary = model.objetivo;
        if (model?.integracion) type = 'linked';
        else if (model?.tipo === 'crud') type = 'catalog';
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
      }
      const label = { linked: 'Proceso + inventario', flow: 'Proceso', catalog: 'Catálogo CRUD' }[type];
      if (query && !searchText([project.name, summary, label].join(' ')).includes(query)) continue;
      card.dataset.kind = type;
      const button = make('button', 'Abrir proyecto');
      button.type = 'button';
      button.setAttribute('aria-label', 'Abrir proyecto: ' + project.name);
      button.onclick = () => {
        openProject(project);
        $('#back-projects').focus();
      };
      const header = make('div', '');
      header.className = 'project-card-meta';
      const icon = make('span', '');
      icon.className = 'project-icon';
      icon.innerHTML = PROJECT_ICONS[type];
      const kind = make('span', sample ? label : label + ' · Local');
      kind.className = 'project-kind';
      header.append(icon, kind);
      card.append(header, make('h2', project.name), make('p', summary), button);
      list.append(card);
    }
    if (!list.childElementCount) list.append(make('p', 'No hay proyectos que coincidan con la búsqueda.'));
  }

  function searchText(value) {
    return value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('es');
  }

  function openProject(project) {
    $('#library').hidden = true;
    $('#editor').hidden = false;
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
    $('#flow-card').open = false;
    $('#rules-card').open = false;
    $('#flow-role').replaceChildren();
    $('#flow-count').textContent = '';
    $('#rules-count').textContent = '';
    for (const option of document.querySelectorAll('[name=presentation]')) {
      option.checked = option.value === projectPresentation(project);
    }
    persistProject(false);
    current = 'model';
    modelFormat = 'fields';
    generatedFormats.pim = 'fields';
    generatedFormats.psm = 'fields';
    build();
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

  function catalogModel(name, id) {
    return {
      version: 1, tipo: 'crud', id: 'catalogo-' + id, nombre: name,
      objetivo: 'Gestionar los registros de ' + name + '.',
      entidad: 'Registro',
      datos: [{ id: 'nombre', nombre: 'Nombre', tipo: 'Texto', requerido: true }],
      ocl: [],
    };
  }

  function integratedModel(name, id) {
    const process = basicModel(name, id);
    return {
      ...process,
      objetivo: 'Revisar solicitudes y registrar entregas y devoluciones de artículos del catálogo.',
      entidad: 'Solicitud',
      actores: [process.actores[0], { id: 'responsable', nombre: 'Responsable' }],
      datos: [
        ...process.datos,
        { id: 'articulo', nombre: 'Artículo', tipo: 'Texto', requerido: true },
        { id: 'cantidad', nombre: 'Cantidad', tipo: 'Entero', requerido: true },
      ],
      estados: [
        process.estados[0],
        { id: 'aprobado', nombre: 'Aprobado' },
        { id: 'entregado', nombre: 'Entregado' },
        { id: 'devuelto', nombre: 'Devuelto', final: true },
        { id: 'rechazado', nombre: 'Rechazado', final: true },
      ],
      transiciones: [
        { id: 'aprobar', nombre: 'Aprobar', actor: 'responsable', desde: 'pendiente', hasta: 'aprobado' },
        { id: 'rechazar', nombre: 'Rechazar', actor: 'responsable', desde: 'pendiente', hasta: 'rechazado' },
        { id: 'entregar', nombre: 'Registrar entrega', actor: 'responsable', desde: 'aprobado', hasta: 'entregado' },
        { id: 'devolver', nombre: 'Registrar devolución', actor: 'responsable', desde: 'entregado', hasta: 'devuelto' },
      ],
      ocl: ['context Solicitud inv CantidadValida: self.cantidad >= 1'],
      integracion: {
        catalogo: {
          version: 1, tipo: 'crud', id: 'catalogo-' + id, nombre: 'Inventario',
          objetivo: 'Administrar los artículos y sus existencias.',
          entidad: 'Articulo',
          datos: [
            { id: 'nombre', nombre: 'Nombre', tipo: 'Texto', requerido: true },
            { id: 'codigo', nombre: 'Código', tipo: 'Texto', requerido: true },
            { id: 'existencias', nombre: 'Existencias', tipo: 'Entero', requerido: true },
          ],
          unicos: ['codigo'],
          ocl: ['context Articulo inv ExistenciasValidas: self.existencias >= 0'],
        },
        referencia: 'articulo', clave: 'codigo', existencias: 'existencias', cantidad: 'cantidad',
        movimientos: [
          { transicion: 'entregar', tipo: 'salida' },
          { transicion: 'devolver', tipo: 'entrada' },
        ],
      },
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
    current = next;
    $('#editor').dataset.stage = next;
    for (const button of document.querySelectorAll('[data-view]')) {
      const selected = button.dataset.view === next;
      button.setAttribute('aria-pressed', String(selected));
      if (selected) button.setAttribute('aria-current', 'step');
      else button.removeAttribute('aria-current');
    }
    renderStageNavigation(next);
    $('#view-title').textContent = views[next][0];
    $('#view-subtitle').textContent = views[next][1];
    const format = next === 'model' ? modelFormat : generatedFormats[next];
    const cimFields = next === 'model' && format === 'fields';
    const diagramView = next === 'model' && format === 'diagram';
    const crud = result?.cim.tipo === 'crud';
    $('#flow-card').hidden = crud;
    $('#integration-card').hidden = !result?.cim.integracion;
    $('#model-format').hidden = next === 'app';
    for (const button of $('#model-format').querySelectorAll('[data-format]')) {
      const label = formats[next][button.dataset.format];
      button.hidden = !label;
      button.setAttribute('aria-pressed', String(button.dataset.format === format));
      if (label) button.textContent = label;
    }
    $('#fields-panel').hidden = !cimFields;
    $('#pim-panel').hidden = next !== 'pim' || format === 'json';
    $('#psm-panel').hidden = next !== 'psm' || format === 'json';
    for (const [id, selectedFormat] of [
      ['pim-fields', 'fields'], ['pim-classes', 'secondary'], ['pim-rules', 'tertiary'],
      ['psm-layout', 'fields'], ['psm-controls', 'secondary'], ['psm-data', 'tertiary'],
    ]) $('#' + id).hidden = format !== selectedFormat;
    $('#source-panel').hidden = next !== 'model' || format !== 'json';
    $('#diagram-panel').hidden = !diagramView;

    if (!$('#source-panel').hidden) {
      $('#source-filename').textContent = (result?.cim.id ?? 'modelo') + '.cim.json';
      source.measure();
    }
    $('#reset').hidden = !examples.has(active.id);
    $('#output').hidden = !['pim', 'psm'].includes(next) || format !== 'json';
    $('#app-panel').hidden = next !== 'app';
    $('#model-summary').hidden = !cimFields;
    $('.workspace').classList.toggle('full-width', !cimFields);
    $('#presentation-panel').hidden = !result || crud || next !== 'psm' || format !== 'fields';
    $('#presentation-reset').hidden = !previewResult;

    if (cimFields) renderFields();
    if (next === 'pim' && format !== 'json') renderPim();
    if (next === 'psm' && format !== 'json') renderPsm();
    if (diagramView) diagram.show(source.value, active.id);
    if (!$('#output').hidden) renderInspector(next);
    if (next === 'app' && result && previewResult !== result) {
      const previous = $('#preview');
      const frame = previous.cloneNode(false);
      frame.addEventListener('load', updateTheme);
      frame.srcdoc = result.html.replace('<html lang="es">', '<html lang="es" data-theme="' + currentTheme() + '">');
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
    const query = searchText($('#trace-search').value.trim());
    const kind = $('#trace-kind').value;
    const trace = result?.trace ?? [];
    const matching = trace.filter(row => (!kind || row.cim.startsWith(kind + '.')) &&
      (!query || Object.values(row).some(value => searchText(value).includes(query))));
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

  function renderStageNavigation(id) {
    const index = stages.findIndex(stage => stage.id === id);
    const stage = stages[index];
    $('#stage-progress').textContent = stage.name + ' · Etapa ' + (index + 1) + ' de ' + stages.length;
    $('#stage-back').hidden = index === 0;
    $('#stage-back-label').textContent = index > 0 ? 'Volver al ' + stages[index - 1].name : '';
    $('#stage-next').hidden = !stage.next;
    $('#stage-next-label').textContent = stage.next ?? '';
  }

  function goToStage(target) {
    if (target === 'model') view(target);
    else build(target);
    const heading = current === target ? $('#view-title') : $('#error');
    heading.focus({ preventScroll: true });
  }

  function build(target = current) {
    try {
      const nextStage = target === true ? 'app' : target === false ? current : target;
      const presentation = $('input[name=presentation]:checked')?.value ?? 'bandeja';
      if (source.value !== draft || (result?.cim.tipo !== 'crud' && result?.psm.presentacion !== presentation)) {
        const projectId = active.id === initialProject.id ? undefined : active.id;
        const initialData = projectId === laboratoryProject.id && source.value.trim() === LABORATORY ? LABORATORY_DATA : undefined;
        result = compile(source.value, assets, projectId, presentation, initialData);
        draft = source.value;
      }
      $('#error').hidden = true;
      status('valid', 'Flujo MDA validado y compilado');
      renderSummary(result.cim);
      view(nextStage);
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
    const template = new FormData(event.currentTarget).get('template') ?? 'process';
    const templates = { process: basicModel, catalog: catalogModel, integrated: integratedModel };
    const model = (templates[template] ?? basicModel)(name, id);
    const project = { id, name, source: JSON.stringify(model, null, 2) };
    projects.set(id, project);
    projectDialog.close();
    openProject(project);
    persistProject(true);
    $('#back-projects').focus();
  };

  for (const button of document.querySelectorAll('[data-view]')) {
    button.onclick = () => goToStage(button.dataset.view);
  }
  for (const button of $('#model-format').querySelectorAll('[data-format]')) {
    button.onclick = () => {
      if (current === 'model') modelFormat = button.dataset.format;
      else generatedFormats[current] = button.dataset.format;
      view(current);
    };
  }

  const resources = $('#stage-resources');
  function showResources(trace) {
    $('#stage-exports').hidden = trace;
    $('#stage-trace').hidden = !trace;
    $('#show-exports').setAttribute('aria-pressed', String(!trace));
    $('#show-trace').setAttribute('aria-pressed', String(trace));
  }
  $('#open-stage-resources').onclick = () => {
    renderDeliverables();
    showResources(false);
    resources.showModal();
  };
  $('#close-stage-resources').onclick = () => resources.close();
  $('#show-exports').onclick = () => showResources(false);
  $('#show-trace').onclick = () => showResources(true);

  $('#add-field-btn').onclick = () => diagram.openItem('datos', undefined, {}, source.value, active.id);
  $('#side-add-actor').onclick = () => diagram.openItem('actores', undefined, {}, source.value, active.id);
  $('#side-add-state').onclick = () => diagram.openItem('estados', undefined, {}, source.value, active.id);
  $('#side-add-transition').onclick = () => diagram.openItem('transiciones', undefined, {}, source.value, active.id);
  $('#side-edit-start').onclick = () => diagram.openItem('inicio', 0, {}, source.value, active.id);
  $('#side-add-rule').onclick = () => diagram.openItem('ocl', undefined, {}, source.value, active.id);

  $('#open-app-tab').onclick = openAppInNewTab;

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
  $('#stage-back').onclick = () => moveStage(-1);
  $('#stage-next').onclick = () => moveStage(1);
  function moveStage(direction) {
    const index = stages.findIndex(stage => stage.id === current);
    const target = stages[index + direction];
    if (target) goToStage(target.id);
  }
  $('#presentation-panel').onchange = event => {
    active.presentation = event.target.value;
    persistProject(true);
    build();
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
  $('#reset').onclick = () => {
    const example = examples.get(active.id);
    if (example) {
      resources.close();
      markDraft(example);
    }
  };
  $('#load-button').onclick = () => {
    resources.close();
    $('#load').click();
  };
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
  $('#project-search').oninput = renderProjects;
  restoreProjects().then(() => {
    persistProject(false);
    showLibrary();
  });
})();

(() => {
  const $ = selector => document.querySelector(selector);
  const systemTheme = matchMedia('(prefers-color-scheme: dark)');
  const themeToggle = $('#theme-toggle');
  let preferredTheme = studioTheme;

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
  const make = (tag, value) => {
    const node = document.createElement(tag);
    node.textContent = value;
    return node;
  };
  const source = MdaJsonEditor.createJsonEditor($('#source'), {
    onChange: saveDraft,
    onCursor: (line, column) => { $('#source-location').textContent = 'Línea ' + line + ', columna ' + column; },
    onFormat: formatSource,
    onBuild: () => goToStage('pim'),
  });
  const diagram = MdaJsonEditor.createDiagram($('#diagram-panel'), {
    read: compile.readCim,
    validate: compile.validateCim,
    change: text => { source.load(text); saveDraft(); },
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
  const examples = new Map([[initialProject.id, DEMO], [advancedProject.id, ADVANCED], [inventoryProject.id, INVENTORY], [laboratoryProject.id, LABORATORY]]);
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
  const stages = [
    { id: 'model', name: 'CIM', next: 'Validar y ver PIM', description: 'Define el proceso, sus datos y sus reglas.' },
    { id: 'pim', name: 'PIM', next: 'Ver PSM', description: 'Revisa el modelo lógico generado, independiente de la plataforma.' },
    { id: 'psm', name: 'PSM', next: 'Generar aplicación', description: 'Revisa cómo se llevará el modelo a la plataforma web.' },
    { id: 'app', name: 'Aplicación', description: 'Prueba la aplicación generada o descarga el HTML.' },
  ];
  const views = {
    model: ['Modelo de negocio', 'Consulta los campos del proceso o edita su DSL en JSON.'],
    pim: ['Modelo lógico', 'Roles, propiedades, operaciones y restricciones independientes de plataforma.'],
    psm: ['Modelo web', 'Controles HTML, acciones, validadores y almacenamiento local.'],
    app: ['Aplicación generada', 'Prueba el proceso aquí o descarga un HTML ejecutable.'],
  };
  const typeNames = {
    movementType: 'Salida o entrada de inventario', crudType: 'crud', crudOperation: 'Crear, consultar, editar o eliminar', table: 'tabla',
    version: 'Versión 1', id: 'Identificador', nullableId: 'Identificador o nulo',
    class: 'Nombre de clase', text: 'Texto', bool: 'Booleano', int: 'Entero',
    domainType: 'Texto, Entero, Fecha, Seleccion o Booleano', ruleType: 'inv o pre', access: 'value o size',
    operator: 'Operador de comparación', control: 'text, number, date, select o checkbox', presentation: 'bandeja o tablero',
  };

  function tableRow(...values) {
    const row = make('tr', '');
    row.append(...values.map(value => make('td', value)));
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
    const stage = current === 'model' ? 'cim' : current;
    const model = result?.[stage];
    const rows = $('#fields-rows');
    rows.replaceChildren();
    $('#fields-type').textContent = stage === 'psm' ? 'Control HTML' : 'Tipo';
    $('#fields-table').hidden = !model;
    if (!model) {
      $('#fields-caption').textContent = 'Genera un modelo válido para consultar sus campos.';
      return;
    }
    const catalog = model.integracion?.catalogo;
    const fields = model.datos ?? model.propiedades ?? model.campos;
    const shared = catalog?.datos ?? catalog?.propiedades ?? catalog?.campos ?? [];
    const changed = source.value !== draft;
    $('#fields-caption').textContent = model.entidad + ' · ' + fields.length + ' campos' +
      (catalog ? ' / ' + catalog.entidad + ' · ' + shared.length + ' campos' : '') +
      (changed ? ' · Última generación válida' : '');
    for (const [entity, group] of [[model.entidad, fields], [catalog?.entidad, shared]]) {
      if (!group.length) continue;
      if (catalog) {
        const row = make('tr', '');
        row.className = 'field-group';
        const heading = make('td', entity + ' · ' + group.length + ' campos');
        heading.colSpan = 5;
        row.append(heading);
        rows.append(row);
      }
      for (const field of group) {
        const row = tableRow(field.nombre, field.id, field.tipo ?? field.control,
          field.requerido ? 'Obligatorio' : 'Opcional', field.opciones?.map(option => option.nombre).join(', ') ?? '—');
        const type = make('span', row.cells[2].textContent);
        type.className = 'field-type';
        row.cells[2].replaceChildren(type);
        rows.append(row);
      }
    }
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
      ? (source.value === draft ? 'Salida generada desde el CIM.' : 'Última generación válida. Hay cambios pendientes en el CIM.') +
        ' Abre una sección para explorar su estructura.'
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
    const fieldView = next !== 'app' && modelFormat === 'fields';
    const diagramView = next === 'model' && modelFormat === 'diagram';
    const crud = result?.cim.tipo === 'crud';
    $('#show-diagram').textContent = crud ? 'Estructura' : 'Diagrama';
    $('#flow-card').hidden = crud;
    $('#integration-card').hidden = !result?.cim.integracion;
    $('#model-format').hidden = next === 'app';
    $('#show-fields').setAttribute('aria-pressed', String(fieldView));
    $('#show-json').setAttribute('aria-pressed', String(modelFormat === 'json'));
    $('#show-diagram').hidden = next !== 'model';
    $('#show-diagram').setAttribute('aria-pressed', String(diagramView));
    $('#show-json').textContent = next === 'model' ? 'Editar JSON' : 'Inspeccionar JSON';
    $('#fields-panel').hidden = !fieldView;
    $('#source-panel').hidden = next !== 'model' || modelFormat !== 'json';
    $('#diagram-panel').hidden = !diagramView;
    if (!$('#source-panel').hidden) {
      $('#source-filename').textContent = (result?.cim.id ?? 'modelo') + '.cim.json';
      source.measure();
    }
    $('#load-button').hidden = next !== 'model';
    $('#reset').hidden = next !== 'model';
    $('#output').hidden = fieldView || !['pim', 'psm'].includes(next);
    $('#app-panel').hidden = next !== 'app';
    $('#model-summary').hidden = next === 'app' || diagramView;
    $('.workspace').classList.toggle('full-width', next === 'app' || diagramView);
    const process = result && result.cim.tipo !== 'crud';
    $('#presentation-panel').hidden = !process || next !== 'psm';
    $('#presentation-current').hidden = !process || next !== 'app';
    $('#presentation-reset').hidden = !previewResult;
    if (process && next === 'app') {
      const board = result.psm.presentacion === 'tablero';
      $('#presentation-current-name').textContent = board ? 'Vista activa · Tablero por estado' : 'Vista activa · Lista de casos';
      $('#presentation-current-description').textContent = board
        ? 'Cada grupo reúne los casos que están en el mismo estado.'
        : 'Cada caso aparece en la lista junto con su estado.';
    }
    $('#download').hidden = !result && next !== 'model';
    if (fieldView) renderFields();
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
    modelFormat = 'json';
    view('model');
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
    $('#flow-start').textContent = cim.inicio.nombre + ' · ' + actors.get(cim.inicio.actor) + ' → ' + label(cim.inicio.estado);
    const flow = $('#flow');
    flow.replaceChildren();
    const actorFilter = $('#flow-role').value;
    for (const edge of cim.transiciones) {
      if (actorFilter && edge.actor !== actorFilter) continue;
      const row = make('div', '');
      row.className = 'edge';
      row.append(make('strong', label(edge.desde)), make('span', '→'), make('strong', label(edge.hasta)),
        make('small', edge.nombre + ' · ' + actors.get(edge.actor)));
      flow.append(row);
    }
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
    const all = make('option', 'Todos los actores');
    all.value = '';
    roleFilter.replaceChildren(all);
    for (const actor of cim.actores) {
      const option = make('option', actor.nombre);
      option.value = actor.id;
      roleFilter.append(option);
    }
    if (cim.actores.some(actor => actor.id === previous)) roleFilter.value = previous;
    $('#flow-count').textContent = cim.transiciones.length + ' transiciones';
    renderFlow();
  }

  function renderRuleSummary() {
    const rules = $('#rules');
    rules.replaceChildren();
    for (const rule of result.pim.restricciones) {
      const item = make('li', '');
      const heading = make('strong', rule.id);
      const type = make('span', rule.tipo === 'inv' ? 'Invariante' : 'Precondición');
      type.className = 'rule-type';
      heading.append(type);
      item.append(heading, make('code', rule.fuente));
      rules.append(item);
    }
    if (!rules.children.length) rules.append(make('li', 'El modelo no declara restricciones.'));
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
    $('#trace-table').hidden = !matching.length;
    $('#trace-empty').hidden = matching.length > 0;
    $('#trace-empty').textContent = result ? 'No hay coincidencias con los filtros.' : 'Genera el modelo para ver su trazabilidad.';
    $('#trace-count').textContent = (matching.length ? (start + 1) + '–' + end : '0') + ' de ' + matching.length +
      (matching.length === trace.length ? ' elementos' : ' resultados · ' + trace.length + ' en total');
    $('#trace-prev').disabled = tracePage === 0;
    $('#trace-next').disabled = end >= matching.length;
  }

  function renderStageNavigation(id) {
    const index = stages.findIndex(stage => stage.id === id);
    const stage = stages[index];
    $('#stage-progress').textContent = stage.name + ' · Etapa ' + (index + 1) + ' de ' + stages.length;
    $('#stage-description').textContent = stage.description;
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
      const presentation = $('input[name=presentation]:checked').value;
      if (source.value !== draft || (result?.cim.tipo !== 'crud' && result?.psm.presentacion !== presentation)) {
        result = compile(source.value, assets, active.id === initialProject.id ? undefined : active.id, presentation);
        draft = source.value;
      }
      $('#error').hidden = true;
      status('valid', 'Generación sin errores');
      renderSummary(result.cim);
      view(target);
    } catch (error) {
      status('error', 'Modelo inválido');
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
    button.onclick = () => goToStage(button.dataset.view);
  }
  $('#show-fields').onclick = () => { modelFormat = 'fields'; view(current); };
  $('#show-json').onclick = () => { modelFormat = 'json'; view(current); };
  $('#show-diagram').onclick = () => { modelFormat = 'diagram'; view('model'); };
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
  $('#change-presentation').onclick = () => {
    goToStage('psm');
    if (current === 'psm') $('input[name=presentation]:checked').focus();
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
  $('#download').onclick = () => {
    if (current === 'model') download(source.value, exportStem() + '.cim.json', 'application/json');
    else if (current === 'app') download(result.html, exportStem() + '.html', 'text/html;charset=utf-8');
    else downloadModel(result[current], current);
  };
  $('#trace-download').onclick = () => downloadModel(result.trace, 'traza');
  $('#trace-download').disabled = true;
  $('#project-search').oninput = renderProjects;
  restoreProjects();
  persistProject(false);
  showLibrary();
})();



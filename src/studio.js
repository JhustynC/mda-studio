(() => {
  const $ = selector => document.querySelector(selector);
  const make = (tag, value) => {
    const node = document.createElement(tag);
    node.textContent = value;
    return node;
  };
  const source = MdaJsonEditor.createJsonEditor($('#source'), {
    onChange: saveDraft,
    onCursor: (line, column) => { $('#source-location').textContent = 'Línea ' + line + ', columna ' + column; },
    onFormat: formatSource,
    onBuild: () => build(true),
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
  const projects = new Map([[initialProject.id, initialProject], [advancedProject.id, advancedProject]]);
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
    model: ['Modelo de negocio', 'Consulta los campos del proceso o edita su DSL en JSON.'],
    pim: ['Modelo lógico', 'Roles, propiedades, operaciones y restricciones independientes de plataforma.'],
    psm: ['Modelo web', 'Controles HTML, acciones, validadores y almacenamiento local.'],
    app: ['Aplicación generada', 'Prueba el proceso aquí o descarga un HTML ejecutable.'],
  };
  const typeNames = {
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
    const fields = model.datos ?? model.propiedades ?? model.campos;
    const changed = source.value !== draft;
    $('#fields-caption').textContent = model.entidad + ' · ' + fields.length + ' campos' +
      (changed ? ' · Última generación válida' : '');
    for (const field of fields) {
      rows.append(tableRow(field.nombre, field.id, field.tipo ?? field.control,
        field.requerido ? 'Obligatorio' : 'Opcional', field.opciones?.map(option => option.nombre).join(', ') ?? '—'));
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

  function showLibrary() {
    $('#library').hidden = false;
    $('#editor').hidden = true;
    $('#compile').hidden = true;
    const list = $('#project-list');
    list.replaceChildren();
    for (const project of projects.values()) {
      const card = make('article', '');
      card.className = 'project-card';
      const sample = project.id === initialProject.id || project.id === advancedProject.id;
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
    for (const button of document.querySelectorAll('[data-view]')) {
      button.setAttribute('aria-pressed', String(button.dataset.view === next));
    }
    $('#view-title').textContent = views[next][0];
    $('#view-subtitle').textContent = views[next][1];
    const fieldView = next !== 'app' && modelFormat === 'fields';
    const diagramView = next === 'model' && modelFormat === 'diagram';
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
    $('#presentation-panel').hidden = !['psm', 'app'].includes(next);
    $('#download').hidden = !result && next !== 'model';
    if (fieldView) renderFields();
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
    renderTrace();
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
    $('#trace-table').hidden = !matching.length;
    $('#trace-empty').hidden = matching.length > 0;
    $('#trace-empty').textContent = result ? 'No hay coincidencias con los filtros.' : 'Genera el modelo para ver su trazabilidad.';
    $('#trace-count').textContent = (matching.length ? (start + 1) + '–' + end : '0') + ' de ' + matching.length +
      (matching.length === trace.length ? ' elementos' : ' resultados · ' + trace.length + ' en total');
    $('#trace-prev').disabled = tracePage === 0;
    $('#trace-next').disabled = end >= matching.length;
  }

  function build(openApp) {
    try {
      const presentation = $('#presentation').value;
      if (source.value !== draft || result?.psm.presentacion !== presentation) {
        result = compile(source.value, assets, active.id === initialProject.id ? undefined : active.id, presentation);
        draft = source.value;
      }
      $('#error').hidden = true;
      status('valid', 'Generación sin errores');
      renderSummary(result.cim);
      view(openApp ? 'app' : current);
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
  let guideFromEditor = false;
  let guideScroll = 0;
  $('#open-guide').onclick = () => {
    if (!$('#guide').hidden) return;
    guideFromEditor = !$('#editor').hidden;
    guideScroll = window.scrollY;
    $('#guide-origin').textContent = guideFromEditor ? 'al editor' : 'a proyectos';
    $('#library').hidden = true;
    $('#editor').hidden = true;
    $('#compile').hidden = true;
    $('#guide').hidden = false;
    $('#guide-title').focus();
    window.scrollTo(0, 0);
  };
  $('#close-guide').onclick = () => {
    $('#guide').hidden = true;
    $('#library').hidden = guideFromEditor;
    $('#editor').hidden = !guideFromEditor;
    $('#compile').hidden = !guideFromEditor;
    $('#open-guide').focus({ preventScroll: true });
    window.scrollTo(0, guideScroll);
  };
  $('#guide-new-project').onclick = () => {
    $('#guide').hidden = true;
    showLibrary();
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
      const model = template === 'example' || template === 'advanced'
        ? { ...JSON.parse(template === 'advanced' ? ADVANCED : EXAMPLE), id: 'proceso-' + id, nombre: name }
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
  for (const type of Object.keys(METAMODEL)) {
    if (!['CIM', 'PIM', 'PSM'].includes(type)) $('#metamodel-types').append(make('option', type));
  }
  $('#open-metamodel').onclick = () => {
    $('#metamodel-structure').value = current === 'model' || current === 'app' ? 'CIM' : current.toUpperCase();
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
  $('#reset').onclick = () => markDraft(active.id === advancedProject.id ? ADVANCED : EXAMPLE);
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
  restoreProjects();
  persistProject(false);
  showLibrary();
})();



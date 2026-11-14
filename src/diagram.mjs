import dagre from '@dagrejs/dagre';

const sections = {
  estados: ['Estados', 'estado'],
  transiciones: ['Transiciones', 'transición'],
  actores: ['Actores', 'actor'],
  datos: ['Datos', 'campo'],
  inicio: ['Inicio', 'inicio'],
  ocl: ['OCL', 'regla OCL'],
};
const types = ['Texto', 'Entero', 'Fecha', 'Seleccion', 'Booleano'];
const identifier = '[a-z][a-z0-9\\-]*';
const rulePattern = /^context\s+[A-Za-z]\w*(?:::([a-z][a-z0-9-]*)\(\))?\s+(inv|pre|post)\s+([A-Za-z]\w*)\s*:\s*(.+)$/;

export function createDiagram(root, { read, validate, change, editJson }) {
  const $ = selector => root.querySelector(selector) ?? document.querySelector(selector);
  const dialog = $('#diagram-dialog');
  const form = $('#diagram-form');
  const viewport = $('#diagram-viewport');
  const scene = $('#diagram-scene');
  let model, key, text, editing, lastLayoutGraph;
  let section = 'estados';
  let zoom = 1;
  let width = 0;
  let height = 0;
  let hasLayout = false;
  let needsFit = true;

  function el(tag, content, className) {
    const element = document.createElement(tag);
    if (content !== undefined) element.textContent = content;
    if (className) element.className = className;
    return element;
  }

  function button(label, handler, className) {
    const element = el('button', label, className);
    element.type = 'button';
    element.onclick = handler;
    return element;
  }

  function svg(tag, attributes) {
    const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
    return element;
  }

  function nameOf(list, id) {
    return model[list]?.find(item => item.id === id)?.nombre ?? id;
  }

  function position(element, x, y) {
    element.style.left = x + 'px';
    element.style.top = y + 'px';
  }

  function actorOptions(select, options, current, placeholder) {
    select.replaceChildren();
    if (placeholder) select.append(new Option(placeholder, ''));
    for (const { id, nombre } of options) select.append(new Option(nombre, id));
    if (current && !options.some(item => item.id === current)) select.append(new Option(current + ' (referencia pendiente)', current));
    select.value = current ?? options[0]?.id ?? '';
  }

  function renderGraph() {
    const graph = new dagre.graphlib.Graph({ multigraph: true });
    const compact = model.estados.length <= 8;
    graph.setGraph({ rankdir: 'LR', ranksep: compact ? 26 : 52, nodesep: 46, edgesep: 22, marginx: 28, marginy: 28, ranker: 'network-simplex' });
    graph.setDefaultEdgeLabel(() => ({}));
    const initial = '@inicio';
    graph.setNode(initial, { width: 138, height: 52 });
    const states = new Map(model.estados.map((state, index) => [state.id, 's' + index]));
    for (const id of states.values()) graph.setNode(id, { width: 152, height: 64 });
    if (states.has(model.inicio.estado)) graph.setEdge(initial, states.get(model.inicio.estado), { width: 0, height: 0 }, '@inicio');
    for (const [index, edge] of model.transiciones.entries()) {
      if (states.has(edge.desde) && states.has(edge.hasta)) {
        graph.setEdge(states.get(edge.desde), states.get(edge.hasta), { width: compact ? 116 : 136, height: 36, labelpos: 'c' }, String(index));
      }
    }

    dagre.layout(graph);
    lastLayoutGraph = { graph, states, initial };
    width = Math.ceil(graph.graph().width);
    height = Math.ceil(graph.graph().height);
    scene.replaceChildren();
    scene.style.width = width + 'px';
    scene.style.height = height + 'px';

    const lines = svg('svg', { width, height, 'aria-hidden': 'true', class: 'diagram-edges' });
    const defs = svg('defs', {});
    for (const [id, color] of [['arrow', '#426b63'], ['return', '#937043']]) {
      const marker = svg('marker', { id: 'diagram-' + id, orient: 'auto', markerWidth: 8, markerHeight: 8, refX: 7, refY: 4, viewBox: '0 0 8 8' });
      marker.append(svg('path', { d: 'M0 0 L8 4 L0 8 Z', fill: color }));
      defs.append(marker);
    }
    lines.append(defs);
    scene.append(lines);

    const filter = $('#diagram-actor').value;
    const emphasized = new Set(model.transiciones.filter(edge => !filter || edge.actor === filter).flatMap(edge => [edge.desde, edge.hasta]));
    if (!filter || model.inicio.actor === filter) emphasized.add(model.inicio.estado);
    for (const edgeRef of graph.edges()) {
      const route = graph.edge(edgeRef);
      const edge = model.transiciones[Number(edgeRef.name)];
      const dim = filter && (edge?.actor ?? model.inicio.actor) !== filter;
      const returns = edge && graph.node(edgeRef.v).x >= graph.node(edgeRef.w).x;
      const path = svg('polyline', {
        points: route.points.map(({ x, y }) => x + ',' + y).join(' '),
        class: 'diagram-edge' + (returns ? ' is-return' : '') + (dim ? ' is-muted' : ''),
        'marker-end': 'url(#diagram-' + (returns ? 'return' : 'arrow') + ')',
      });
      lines.append(path);
      if (!edge) continue;
      const label = button('', () => openEditor('transiciones', Number(edgeRef.name)), 'diagram-edge-label');
      label.classList.toggle('is-muted', Boolean(dim));
      const guards = model.ocl.filter(rule => rulePattern.exec(rule.trim())?.[1] === edge.id).length;
      label.append(el('strong', edge.nombre), el('small', nameOf('actores', edge.actor) + (guards ? ' · OCL' : '')));
      label.title = edge.nombre + ' · ' + nameOf('actores', edge.actor) + ' · ' + nameOf('estados', edge.desde) + ' → ' + nameOf('estados', edge.hasta);
      label.setAttribute('aria-label', 'Editar transición ' + label.title);
      position(label, route.x, route.y);
      scene.append(label);
    }

    function node(id, label, subtitle, variant, edit, dim) {
      const point = graph.node(id);
      const item = button('', edit, 'diagram-node ' + variant);
      item.style.width = point.width + 'px';
      item.style.height = point.height + 'px';
      item.classList.toggle('is-muted', Boolean(dim));
      item.append(el('small', subtitle), el('strong', label));
      item.title = label + ' · ' + subtitle;
      position(item, point.x, point.y);
      scene.append(item);
    }
    node(initial, model.inicio.nombre, 'Inicio · ' + nameOf('actores', model.inicio.actor), 'is-start',
      () => openEditor('inicio', 0), filter && model.inicio.actor !== filter);
    for (const [index, state] of model.estados.entries()) {
      if (states.get(state.id) !== 's' + index) continue;
      node('s' + index, state.nombre, state.final ? 'Estado final' : 'Estado', state.final ? 'is-end' : 'is-state',
        () => openEditor('estados', index), filter && !emphasized.has(state.id));
    }
    hasLayout = true;
    applyZoom(zoom);
    if (needsFit) {
      fit();
      if (!compact && zoom < 0.68 && viewport.clientWidth >= 560) applyZoom(0.76);
      needsFit = false;
    }
  }

  function exportSvg(sourceText) {
    if (sourceText) {
      try { model = read(sourceText); } catch { /* use current model */ }
    }
    if (!model) return '';
    const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    if (model.tipo === 'crud') {
      const h = 110 + model.datos.length * 32;
      const rows = model.datos.map((f, i) =>
        `<text x="36" y="${105 + i * 28}" font-family="Segoe UI, sans-serif" font-size="13" fill="#182c32"><tspan font-weight="700">${esc(f.nombre)}</tspan> (${esc(f.id)}: ${esc(f.tipo)}${f.requerido ? ' [1..1]' : ' [0..1]'}${model.unicos?.includes(f.id) ? ' {único}' : ''})</text>`,
      ).join('\n  ');
      return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="520" height="${h}" viewBox="0 0 520 ${h}">\n  <rect width="100%" height="100%" fill="#f6faf8"/>\n  <rect x="20" y="20" width="480" height="${h - 40}" rx="12" fill="#ffffff" stroke="#94b7aa" stroke-width="1.5"/>\n  <rect x="20" y="20" width="480" height="54" rx="12" fill="#194d43"/>\n  <text x="36" y="44" font-family="Consolas, monospace" font-size="10" fill="#ceeadd">ENTIDAD CRUD · CIM</text>\n  <text x="36" y="64" font-family="Segoe UI, sans-serif" font-size="18" font-weight="700" fill="#ffffff">${esc(model.entidad)} — ${esc(model.nombre)}</text>\n  ${rows}\n</svg>\n`;
    }
    renderGraph();
    const { graph, states, initial } = lastLayoutGraph;
    const w = Math.max(width + 40, 480);
    const h = Math.max(height + 40, 260);
    const parts = [
      `<?xml version="1.0" encoding="UTF-8"?>`,
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`,
      `  <rect width="100%" height="100%" fill="#f6faf8"/>`,
      `  <defs>`,
      `    <marker id="arrow" orient="auto" markerWidth="8" markerHeight="8" refX="7" refY="4" viewBox="0 0 8 8"><path d="M0 0 L8 4 L0 8 Z" fill="#426b63"/></marker>`,
      `    <marker id="return" orient="auto" markerWidth="8" markerHeight="8" refX="7" refY="4" viewBox="0 0 8 8"><path d="M0 0 L8 4 L0 8 Z" fill="#937043"/></marker>`,
      `  </defs>`,
    ];
    for (const edgeRef of graph.edges()) {
      const route = graph.edge(edgeRef);
      const edge = model.transiciones[Number(edgeRef.name)];
      const returns = edge && graph.node(edgeRef.v).x >= graph.node(edgeRef.w).x;
      const pts = route.points.map(({ x, y }) => `${x + 20},${y + 20}`).join(' ');
      parts.push(`  <polyline points="${pts}" fill="none" stroke="${returns ? '#937043' : '#426b63'}" stroke-width="1.8" ${returns ? 'stroke-dasharray="5 4"' : ''} marker-end="url(#${returns ? 'return' : 'arrow'})"/>`);
      if (edge) {
        const lx = route.x + 20;
        const ly = route.y + 20;
        parts.push(`  <rect x="${lx - 58}" y="${ly - 16}" width="116" height="32" rx="6" fill="#ffffff" stroke="#d4e5db"/>`);
        parts.push(`  <text x="${lx}" y="${ly - 2}" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="10" font-weight="700" fill="#224740">${esc(edge.nombre)}</text>`);
        parts.push(`  <text x="${lx}" y="${ly + 10}" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="9" fill="#466862">${esc(nameOf('actores', edge.actor))}</text>`);
      }
    }
    function drawSvgNode(id, title, sub, fill, stroke, textColor, subColor) {
      const pt = graph.node(id);
      const nx = pt.x - pt.width / 2 + 20;
      const ny = pt.y - pt.height / 2 + 20;
      parts.push(`  <rect x="${nx}" y="${ny}" width="${pt.width}" height="${pt.height}" rx="9" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`);
      parts.push(`  <text x="${nx + 12}" y="${ny + 22}" font-family="Segoe UI, sans-serif" font-size="10" fill="${subColor}">${esc(sub)}</text>`);
      parts.push(`  <text x="${nx + 12}" y="${ny + 40}" font-family="Segoe UI, sans-serif" font-size="13" font-weight="700" fill="${textColor}">${esc(title)}</text>`);
    }
    drawSvgNode(initial, model.inicio.nombre, 'Inicio · ' + nameOf('actores', model.inicio.actor), '#194d43', '#194d43', '#f7fffa', '#c4e6d8');
    for (const [index, state] of model.estados.entries()) {
      const nid = states.get(state.id);
      if (nid !== 's' + index) continue;
      drawSvgNode(nid, state.nombre, state.final ? 'Estado final' : 'Estado', state.final ? '#e0f0df' : '#ffffff', state.final ? '#92b897' : '#94b7aa', '#163c34', '#466862');
    }
    parts.push(`</svg>\n`);
    return parts.join('\n');
  }

  function applyZoom(value) {
    zoom = Math.max(0.12, Math.min(1.7, value));
    scene.style.transform = 'translate(-50%, -50%) scale(' + zoom + ')';
    $('#diagram-scroller').style.width = Math.ceil(width * zoom) + 'px';
    $('#diagram-scroller').style.height = Math.ceil(height * zoom) + 'px';
    $('#diagram-zoom').textContent = Math.round(zoom * 100) + '%';
    $('#diagram-minus').disabled = zoom <= 0.12;
    $('#diagram-plus').disabled = zoom >= 1.7;
  }

  function zoomAt(value, clientX, clientY) {
    const previous = scene.getBoundingClientRect();
    const anchorX = (clientX - previous.left) / zoom;
    const anchorY = (clientY - previous.top) / zoom;
    applyZoom(value);
    const next = scene.getBoundingClientRect();
    viewport.scrollBy(next.left + anchorX * zoom - clientX, next.top + anchorY * zoom - clientY);
  }

  function fit() {
    if (!hasLayout || !viewport.clientWidth) return;
    applyZoom(Math.min(1, (viewport.clientWidth - 16) / width, (viewport.clientHeight - 16) / height));
    viewport.scrollTo(0, 0);
  }

  function describe(item, kind) {
    switch (kind) {
      case 'inicio': return [item.nombre, nameOf('actores', item.actor) + ' → ' + nameOf('estados', item.estado)];
      case 'transiciones': return [item.nombre, nameOf('estados', item.desde) + ' → ' + nameOf('estados', item.hasta) + ' · ' + nameOf('actores', item.actor)];
      case 'datos': return [item.nombre, item.tipo + (model.unicos?.includes(item.id) ? ' · Único' : '') + (item.requerido ? ' · Obligatorio' : ' · Opcional') + (item.opciones ? ' · ' + item.opciones.length + ' opciones' : '')];
      case 'estados': return [item.nombre, item.id + (item.final ? ' · Final' : '')];
      case 'ocl': {
        const match = rulePattern.exec(item.trim());
        const kindLabel = match?.[2] === 'post' ? 'Postcondición de ' : 'Precondición de ';
        return [match?.[3] ?? 'Expresión OCL', match?.[1] ? kindLabel + nameOf('transiciones', match[1]) + ' · ' + match[4] : match?.[4] ?? item];
      }
      default: {
        const count = model.transiciones.filter(edge => edge.actor === item.id).length;
        return [item.nombre, count + ' transiciones' + (model.inicio.actor === item.id ? ' · Inicia el caso' : '')];
      }
    }
  }

  function renderList() {
    const [title, singular] = sections[section];
    $('#diagram-list-title').textContent = title;
    $('#diagram-add').hidden = section === 'inicio';
    $('#diagram-add').textContent = '+ ' + singular;
    $('#diagram-add').setAttribute('aria-label', 'Añadir ' + singular);
    for (const tab of $('#diagram-tabs').children) {
      tab.hidden = model.tipo === 'crud' && !['datos', 'ocl'].includes(tab.dataset.section);
      tab.setAttribute('aria-pressed', String(tab.dataset.section === section));
    }
    const items = section === 'inicio' ? [model.inicio] : model[section];
    const list = $('#diagram-items');
    list.replaceChildren();
    if (!items.length) list.append(el('p', 'Todavía no hay elementos.', 'diagram-empty'));
    for (const [index, data] of items.entries()) {
      const [label, detail] = describe(data, section);
      const item = button('', () => openEditor(section, index), 'diagram-item');
      item.append(el('strong', label), el('small', detail));
      item.setAttribute('aria-label', 'Editar ' + label);
      list.append(item);
    }
  }

  function show(nextText, projectKey) {
    if (key !== projectKey) {
      key = projectKey;
      text = undefined;
      needsFit = true;
      section = 'estados';
      $('#diagram-actor').replaceChildren();
    }
    if (text === nextText && model) return;
    text = nextText;
    const error = $('#diagram-error');
    try {
      model = read(text);
    } catch (invalid) {
      model = undefined;
      error.replaceChildren(el('p', 'El diagrama necesita un CIM con estructura válida. ' + invalid.message),
        button('Abrir editor JSON', editJson));
      error.hidden = false;
      $('#diagram-workbench').hidden = true;
      return;
    }
    $('#diagram-workbench').hidden = false;
    error.hidden = true;
    try {
      validate(model);
    } catch (invalid) {
      const problems = invalid.message.split('\n');
      const details = el('details');
      details.append(el('summary', problems.length + ' problemas por resolver antes de generar'));
      const list = el('ul');
      for (const problem of problems) list.append(el('li', problem));
      details.append(list);
      error.replaceChildren(details);
      error.hidden = false;
    }
    const crud = model.tipo === 'crud';
    $('#diagram-heading').textContent = crud ? 'Estructura de la entidad' : 'Flujo del proceso';
    for (const selector of ['#diagram-viewport', '#diagram-tools', '#diagram-legend']) $(selector).hidden = crud;
    $('#diagram-crud').hidden = !crud;
    if (crud) {
      if (!['datos', 'ocl'].includes(section)) section = 'datos';
      $('#diagram-stats').textContent = model.datos.length + ' campos · ' + model.ocl.length + ' reglas';
      renderEntity();
    } else {
      $('#diagram-stats').textContent = model.estados.length + ' estados · ' + model.transiciones.length + ' transiciones';
      const filter = $('#diagram-actor');
      actorOptions(filter, model.actores, model.actores.some(actor => actor.id === filter.value) ? filter.value : '', 'Todos');
      renderGraph();
    }
    renderList();
  }

  function renderEntity() {
    const card = el('div', undefined, 'diagram-entity');
    const heading = el('div', undefined, 'diagram-entity-head');
    heading.append(el('span', 'ENTIDAD'), el('h4', model.entidad),
      el('p', 'Crear · Consultar · Editar · Eliminar'));
    const fields = el('div', undefined, 'diagram-entity-fields');
    model.datos.forEach((field, index) => {
      const row = button('', () => openEditor('datos', index));
      row.append(el('strong', field.nombre), el('span', field.tipo + (model.unicos?.includes(field.id) ? ' · Único' : '')));
      fields.append(row);
    });
    card.append(heading, fields);
    $('#diagram-crud').replaceChildren(card);
  }

  function formField(key, label, value = '', options = {}) {
    const wrapper = el('label', label);
    const input = el(options.list ? 'select' : options.multiline ? 'textarea' : 'input');
    input.name = key;
    if (options.list) {
      actorOptions(input, options.list, value, options.placeholder);
    } else if (options.checkbox) {
      input.type = 'checkbox';
      input.checked = Boolean(value);
      wrapper.className = 'diagram-checkbox';
    } else {
      input.value = value;
      if (options.pattern) input.pattern = options.pattern;
      if (options.multiline) input.rows = options.multiline;
      if (options.placeholder) input.placeholder = options.placeholder;
    }
    input.required = !options.optional && !options.checkbox;
    wrapper.append(input);
    $('#diagram-form-fields').append(wrapper);
    return input;
  }

  function buildOclAssistant(expressionInput) {
    const box = el('div', undefined, 'ocl-assistant');
    const title = el('strong', 'Constructor asistido de condición OCL');
    const row = el('div', undefined, 'ocl-assistant-row');

    const connSelect = el('select');
    for (const [val, txt] of [['and', 'Y (and)'], ['or', 'O (or)'], ['implies', 'Implica (implies)']]) {
      connSelect.append(new Option(txt, val));
    }
    const fieldSelect = el('select');
    for (const f of model.datos) {
      fieldSelect.append(new Option(f.nombre + ' (' + f.tipo + ')', f.id));
    }
    const propSelect = el('select');
    propSelect.append(new Option('Valor (self.campo)', 'value'), new Option('Longitud texto (.size())', 'size'));
    const opSelect = el('select');
    for (const op of ['>=', '<=', '=', '<>', '>', '<']) opSelect.append(new Option(op, op));
    const valInput = el('input');
    valInput.placeholder = 'Ej. 5, \'urgente\', true, self.otro';

    const syncAssistant = () => {
      const f = model.datos.find(d => d.id === fieldSelect.value);
      if (!f) return;
      propSelect.disabled = !['Texto', 'Fecha'].includes(f.tipo);
      if (propSelect.disabled) propSelect.value = 'value';
      if (propSelect.value === 'size' || f.tipo === 'Entero') {
        valInput.placeholder = 'Ej. 1, 10 o self.otroCampo';
      } else if (f.tipo === 'Booleano') {
        valInput.placeholder = 'true o false';
      } else if (f.tipo === 'Seleccion') {
        valInput.placeholder = "'" + (f.opciones?.[0]?.id ?? 'opcion') + "'";
      } else if (f.tipo === 'Fecha') {
        valInput.placeholder = "'2026-12-31'";
      } else {
        valInput.placeholder = "'texto'";
      }
    };
    fieldSelect.onchange = syncAssistant;
    propSelect.onchange = syncAssistant;
    syncAssistant();

    const addClauseBtn = button('+ Insertar cláusula', () => {
      const f = model.datos.find(d => d.id === fieldSelect.value);
      if (!f) return;
      const access = propSelect.value === 'size' ? '.size()' : '';
      let rawVal = valInput.value.trim();
      if (!rawVal) {
        if (propSelect.value === 'size' || f.tipo === 'Entero') rawVal = '1';
        else if (f.tipo === 'Booleano') rawVal = 'true';
        else if (f.tipo === 'Seleccion') rawVal = "'" + (f.opciones?.[0]?.id ?? 'valor') + "'";
        else if (f.tipo === 'Fecha') rawVal = "'2026-01-01'";
        else rawVal = "'valor'";
      } else if (!rawVal.startsWith('self.') && propSelect.value !== 'size' && ['Texto', 'Seleccion', 'Fecha'].includes(f.tipo) && !/^['"].*['"]$/.test(rawVal)) {
        rawVal = "'" + rawVal + "'";
      }
      const clause = 'self.' + f.id + access + ' ' + opSelect.value + ' ' + rawVal;
      const current = expressionInput.value.trim();
      expressionInput.value = current ? current + ' ' + connSelect.value + ' ' + clause : clause;
      expressionInput.focus();
    }, 'ocl-insert-btn');

    row.append(connSelect, fieldSelect, propSelect, opSelect, valInput, addClauseBtn);
    box.append(title, row);
    $('#diagram-form-fields').append(box);
  }

  function openEditor(kind, index, defaults = {}) {
    if (!model) return;
    section = kind;
    renderList();
    editing = { kind, index };
    const existing = kind === 'inicio' ? model.inicio : model[kind][index];
    const item = existing ?? defaults;
    $('#diagram-form-fields').replaceChildren();
    $('#diagram-dialog-title').textContent = (existing ? 'Editar ' : 'Añadir ') + sections[kind][1];
    $('#diagram-dialog-context').textContent = 'Los cambios se guardan directamente en el modelo CIM del proyecto.';
    $('#diagram-form-error').hidden = true;
    $('#diagram-remove').hidden = !existing || kind === 'inicio';
    $('#diagram-connect').hidden = kind !== 'estados' || !existing || existing.final;
    if (kind === 'ocl') {
      if (typeof item === 'string' && !rulePattern.test(item.trim())) {
        formField('regla-completa', 'Expresión OCL', item, { multiline: 4 });
      } else {
        const [, operation, ruleType, name, expression] = rulePattern.exec(String(item).trim()) ?? [];
        formField('nombre', 'Nombre de la regla', name, { pattern: '[A-Za-z][A-Za-z0-9_]*', placeholder: 'Ej. PrioridadUrgenteValida' });
        const selector = formField('regla', 'Alcance de la regla', ruleType ?? 'inv', {
          list: [
            { id: 'inv', nombre: 'Invariante de ' + model.entidad + ' (inv)' },
            { id: 'pre', nombre: 'Precondición antes de transición (pre)' },
            { id: 'post', nombre: 'Postcondición tras transición (post)' },
          ],
        });
        const operations = formField('operacion', 'Transición asociada', operation ?? '', { list: model.transiciones ?? [], placeholder: 'Selecciona una transición' });
        if (model.tipo === 'crud') {
          selector.value = 'inv';
          selector.parentElement.hidden = true;
        }
        const sync = () => {
          const needsOp = selector.value === 'pre' || selector.value === 'post';
          operations.parentElement.hidden = !needsOp;
          operations.required = needsOp;
        };
        selector.onchange = sync;
        sync();
        const exprField = formField('expresion', 'Condición OCL (soporta Entero, Texto, Seleccion, Booleano, Fecha, and, or, implies)', expression, {
          multiline: 3,
          placeholder: "self.cantidad >= 1 and self.motivo.size() >= 8",
        });
        buildOclAssistant(exprField);
      }
    } else {
      formField('nombre', 'Nombre visible', item.nombre, { placeholder: kind === 'datos' ? 'Ej. Correo institucional' : 'Ej. En revisión' });
      if (kind !== 'inicio') formField('id', 'Identificador técnico (minúsculas y guiones)', item.id, { pattern: identifier, placeholder: 'ejemplo-id' });
      if (kind === 'estados') formField('final', 'Es un estado final del flujo', item.final, { checkbox: true });
      if (kind === 'inicio' || kind === 'transiciones') {
        formField('actor', 'Actor responsable', item.actor ?? '', { list: model.actores, placeholder: 'Selecciona un actor' });
      }
      if (kind === 'inicio') formField('estado', 'Estado inicial', item.estado, { list: model.estados, placeholder: 'Selecciona un estado' });
      if (kind === 'transiciones') {
        formField('desde', 'Estado de origen', item.desde ?? '', { list: model.estados, placeholder: 'Selecciona un origen' });
        formField('hasta', 'Estado de destino', item.hasta ?? '', { list: model.estados, placeholder: 'Selecciona un destino' });
      }
      if (kind === 'datos') {
        const type = formField('tipo', 'Tipo de dato de negocio', item.tipo ?? 'Texto', { list: types.map(id => ({ id, nombre: id === 'Seleccion' ? 'Selección (lista de opciones)' : id })) });
        formField('requerido', 'Campo obligatorio', item.requerido ?? true, { checkbox: true });
        if (model.tipo === 'crud') formField('unico', 'Valor único en el catálogo', model.unicos?.includes(item.id), { checkbox: true });
        const choices = formField('opciones', 'Opciones (una por línea: identificador | etiqueta)',
          item.opciones?.map(option => option.id + ' | ' + option.nombre).join('\n'), { multiline: 4, placeholder: 'normal | Normal\nurgente | Urgente' });
        const sync = () => { choices.parentElement.hidden = type.value !== 'Seleccion'; choices.required = type.value === 'Seleccion'; };
        type.onchange = sync;
        sync();
      }
    }
    if (!dialog.open) dialog.showModal();
    $('#diagram-form-fields input, #diagram-form-fields textarea')?.focus();
  }

  function openItem(kind, index, defaults = {}, sourceText, projectKey) {
    if (sourceText !== undefined) {
      try {
        model = read(sourceText);
        text = sourceText;
        if (projectKey) key = projectKey;
      } catch (err) {
        editJson();
        return;
      }
    }
    if (!model) return;
    const targetIndex = index ?? (kind === 'inicio' ? 0 : model[kind]?.length ?? 0);
    openEditor(kind, targetIndex, defaults);
  }

  function fieldOptions(text) {
    const options = text.split('\n').filter(line => line.trim()).map(line => {
      const bar = line.indexOf('|');
      const id = line.slice(0, bar).trim();
      const nombre = line.slice(bar + 1).trim();
      if (bar < 1 || !new RegExp('^' + identifier + '$').test(id) || !nombre) {
        throw new Error('Escribe cada opción como «identificador | etiqueta».');
      }
      return { id, nombre };
    });
    if (!options.length || new Set(options.map(item => item.id)).size !== options.length) {
      throw new Error('Añade opciones con identificadores únicos.');
    }
    return options;
  }

  function replaceReferences(next, kind, oldId, newId) {
    if (next.tipo !== 'crud') {
      if (kind === 'actores' && next.inicio.actor === oldId) next.inicio.actor = newId;
      if (kind === 'estados' && next.inicio.estado === oldId) next.inicio.estado = newId;
      for (const edge of next.transiciones) {
        if (kind === 'actores' && edge.actor === oldId) edge.actor = newId;
        if (kind === 'estados' && edge.desde === oldId) edge.desde = newId;
        if (kind === 'estados' && edge.hasta === oldId) edge.hasta = newId;
      }
    }
    if (next.integracion) {
      if (kind === 'transiciones') {
        for (const movement of next.integracion.movimientos) if (movement.transicion === oldId) movement.transicion = newId;
      }
      if (kind === 'datos') {
        for (const property of ['referencia', 'cantidad']) if (next.integracion[property] === oldId) next.integracion[property] = newId;
      }
    }
    if (kind === 'transiciones') next.ocl = next.ocl.map(rule => rule.replaceAll('::' + oldId + '()', '::' + newId + '()'));
    if (kind === 'datos') next.ocl = next.ocl.map(rule =>
      rule.replace(/self\.([a-z][a-z0-9-]*)/g, (reference, id) => id === oldId ? 'self.' + newId : reference));
  }

  function save(next) {
    const updated = JSON.stringify(next, null, 2);
    read(updated);
    dialog.close();
    change(updated);
    show(updated, key);
    $('#diagram-tabs').querySelector('[aria-pressed=true]')?.focus();
  }

  function showFormError(exception) {
    const issue = $('#diagram-form-error');
    issue.textContent = exception.message;
    issue.hidden = false;
  }

  form.onsubmit = event => {
    event.preventDefault();
    try {
      const { kind, index } = editing;
      const data = new FormData(form);
      const get = name => String(data.get(name) ?? '').trim();
      const next = structuredClone(model);
      if (kind === 'ocl') {
        const ruleKind = get('regla');
        const prefix = (ruleKind === 'pre' || ruleKind === 'post')
          ? '::' + get('operacion') + '() ' + ruleKind + ' '
          : ' inv ';
        const rule = get('regla-completa') || 'context ' + model.entidad + prefix + get('nombre') + ': ' + get('expresion');
        if (!rulePattern.test(rule.trim())) throw new Error('Escribe una invariante, precondición o postcondición OCL en una sola línea.');
        next.ocl[index] = rule;
      } else {
        const nombre = get('nombre');
        if (!nombre) throw new Error('Escribe un nombre.');
        const item = { nombre };
        if (kind === 'inicio') {
          Object.assign(item, { actor: get('actor'), estado: get('estado') });
          next.inicio = item;
        } else {
          item.id = get('id');
          if (next[kind].some((other, i) => i !== index && other.id === item.id)) throw new Error('Ese identificador ya existe.');
          if (kind === 'estados') item.final = data.has('final');
          if (kind === 'transiciones') Object.assign(item, { actor: get('actor'), desde: get('desde'), hasta: get('hasta') });
          if (kind === 'datos') {
            Object.assign(item, { tipo: get('tipo'), requerido: data.has('requerido') });
            if (item.tipo === 'Seleccion') item.opciones = fieldOptions(get('opciones'));
            if (next.tipo === 'crud') {
              const unique = data.has('unico');
              if (unique && (!item.requerido || !['Texto', 'Entero'].includes(item.tipo))) {
                throw new Error('Un campo único debe ser obligatorio y de tipo Texto o Entero.');
              }
              next.unicos = (next.unicos ?? []).filter(id => id !== next.datos[index]?.id);
              if (unique) next.unicos.push(item.id);
            }
          }
          const oldId = next[kind][index]?.id;
          next[kind][index] = item;
          if (oldId && oldId !== item.id) replaceReferences(next, kind, oldId, item.id);
        }
      }
      save(next);
    } catch (error) {
      showFormError(error);
    }
  };

  $('#diagram-remove').onclick = () => {
    const { kind, index } = editing;
    const next = structuredClone(model);
    const item = next[kind][index];
    if (item?.id) {
      const probe = structuredClone(next);
      replaceReferences(probe, kind, item.id, '@removed');
      if (JSON.stringify(probe) !== JSON.stringify(next)) {
        showFormError(new Error('Este elemento tiene referencias en el proceso o en reglas OCL. Actualiza esas referencias antes de borrarlo.'));
        return;
      }
    }
    if (kind === 'datos' && next.unicos) next.unicos = next.unicos.filter(id => id !== item.id);
    next[kind].splice(index, 1);
    try { save(next); } catch (error) { showFormError(error); }
  };

  for (const [kind, [label]] of Object.entries(sections)) {
    const tab = button(label, () => { section = kind; renderList(); });
    tab.dataset.section = kind;
    $('#diagram-tabs').append(tab);
  }
  $('#diagram-add').onclick = () => openEditor(section, model[section].length);
  $('#diagram-cancel').onclick = () => dialog.close();
  $('#diagram-connect').onclick = () => openEditor('transiciones', model.transiciones.length, { desde: model.estados[editing.index].id });
  $('#diagram-actor').onchange = renderGraph;
  $('#diagram-minus').onclick = () => applyZoom(zoom / 1.2);
  $('#diagram-plus').onclick = () => applyZoom(zoom * 1.2);
  $('#diagram-fit').onclick = fit;
  viewport.addEventListener('wheel', event => {
    if (!hasLayout || !event.deltaY) return;
    event.preventDefault();
    const units = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientHeight : 1;
    const delta = Math.max(-200, Math.min(200, event.deltaY * units));
    zoomAt(zoom * Math.exp(-delta * 0.002), event.clientX, event.clientY);
  }, { passive: false });
  let pan;
  viewport.addEventListener('pointerdown', event => {
    const bounds = viewport.getBoundingClientRect();
    if (event.pointerType !== 'mouse' || event.button !== 0 || event.target.closest('button') ||
        event.clientX - bounds.left >= viewport.clientWidth || event.clientY - bounds.top >= viewport.clientHeight) return;
    pan = { id: event.pointerId, x: event.clientX, y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop };
    viewport.setPointerCapture(event.pointerId);
    viewport.classList.add('is-panning');
  });
  viewport.addEventListener('pointermove', event => {
    if (event.pointerId === pan?.id) viewport.scrollTo(pan.left + pan.x - event.clientX, pan.top + pan.y - event.clientY);
  });
  viewport.addEventListener('lostpointercapture', () => {
    pan = undefined;
    viewport.classList.remove('is-panning');
  });
  return { show, openItem, exportSvg };
}

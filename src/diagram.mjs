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
const rulePattern = /^context\s+[A-Za-z]\w*(?:::([a-z][a-z0-9-]*)\(\))?\s+(inv|pre)\s+([A-Za-z]\w*)\s*:\s*(.+)$/;

export function createDiagram(root, { read, validate, change, editJson }) {
  const $ = selector => root.querySelector(selector);
  const dialog = $('#diagram-dialog');
  const form = $('#diagram-form');
  const viewport = $('#diagram-viewport');
  const scene = $('#diagram-scene');
  let model, key, text, editing;
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
    return model[list].find(item => item.id === id)?.nombre ?? id;
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

  function applyZoom(value) {
    zoom = Math.max(0.12, Math.min(1.7, value));
    scene.style.transform = 'scale(' + zoom + ')';
    $('#diagram-scroller').style.width = Math.ceil(width * zoom) + 'px';
    $('#diagram-scroller').style.height = Math.ceil(height * zoom) + 'px';
    $('#diagram-zoom').textContent = Math.round(zoom * 100) + '%';
    $('#diagram-minus').disabled = zoom <= 0.12;
    $('#diagram-plus').disabled = zoom >= 1.7;
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
      case 'datos': return [item.nombre, item.tipo + (item.requerido ? ' · Obligatorio' : ' · Opcional') + (item.opciones ? ' · ' + item.opciones.length + ' opciones' : '')];
      case 'estados': return [item.nombre, item.id + (item.final ? ' · Final' : '')];
      case 'ocl': {
        const match = rulePattern.exec(item.trim());
        return [match?.[3] ?? 'Expresión OCL', match?.[1] ? 'Precondición de ' + nameOf('transiciones', match[1]) + ' · ' + match[4] : match?.[4] ?? item];
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
    for (const tab of $('#diagram-tabs').children) tab.setAttribute('aria-pressed', String(tab.dataset.section === section));
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
    if (text === nextText) return;
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
    $('#diagram-stats').textContent = model.estados.length + ' estados · ' + model.transiciones.length + ' transiciones';
    const filter = $('#diagram-actor');
    actorOptions(filter, model.actores, model.actores.some(actor => actor.id === filter.value) ? filter.value : '', 'Todos');
    renderGraph();
    renderList();
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

  function openEditor(kind, index, defaults = {}) {
    if (!model) return;
    section = kind;
    renderList();
    editing = { kind, index };
    const existing = kind === 'inicio' ? model.inicio : model[kind][index];
    const item = existing ?? defaults;
    $('#diagram-form-fields').replaceChildren();
    $('#diagram-dialog-title').textContent = (existing ? 'Editar ' : 'Añadir ') + sections[kind][1];
    $('#diagram-dialog-context').textContent = 'Los cambios se guardan en el CIM del proyecto.';
    $('#diagram-form-error').hidden = true;
    $('#diagram-remove').hidden = !existing || kind === 'inicio';
    $('#diagram-connect').hidden = kind !== 'estados' || !existing || existing.final;
    if (kind === 'ocl') {
      if (typeof item === 'string' && !rulePattern.test(item.trim())) {
        formField('regla-completa', 'Expresión OCL', item, { multiline: 4 });
      } else {
        const [, operation, ruleType, name, expression] = rulePattern.exec(String(item).trim()) ?? [];
        formField('nombre', 'Nombre de la regla', name, { pattern: '[A-Za-z][A-Za-z0-9_]*' });
        const selector = formField('regla', 'Alcance', ruleType ?? 'inv',
          { list: [{ id: 'inv', nombre: 'Invariante de ' + model.entidad }, { id: 'pre', nombre: 'Precondición de una transición' }] });
        const operations = formField('operacion', 'Transición', operation ?? '', { list: model.transiciones, placeholder: 'Selecciona una transición' });
        const sync = () => { operations.parentElement.hidden = selector.value !== 'pre'; operations.required = selector.value === 'pre'; };
        selector.onchange = sync;
        sync();
        formField('expresion', 'Condición', expression, { multiline: 3, placeholder: 'self.cantidad >= 1' });
      }
    } else {
      formField('nombre', 'Nombre', item.nombre);
      if (kind !== 'inicio') formField('id', 'Identificador', item.id, { pattern: identifier, placeholder: 'ejemplo-id' });
      if (kind === 'estados') formField('final', 'Estado final', item.final, { checkbox: true });
      if (kind === 'inicio' || kind === 'transiciones') {
        formField('actor', 'Actor responsable', item.actor ?? '', { list: model.actores, placeholder: 'Selecciona un actor' });
      }
      if (kind === 'inicio') formField('estado', 'Estado inicial', item.estado, { list: model.estados, placeholder: 'Selecciona un estado' });
      if (kind === 'transiciones') {
        formField('desde', 'Estado de origen', item.desde ?? '', { list: model.estados, placeholder: 'Selecciona un origen' });
        formField('hasta', 'Estado de destino', item.hasta ?? '', { list: model.estados, placeholder: 'Selecciona un destino' });
      }
      if (kind === 'datos') {
        const type = formField('tipo', 'Tipo', item.tipo ?? 'Texto', { list: types.map(id => ({ id, nombre: id === 'Seleccion' ? 'Selección' : id })) });
        formField('requerido', 'Campo obligatorio', item.requerido, { checkbox: true });
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
    if (kind === 'actores' && next.inicio.actor === oldId) next.inicio.actor = newId;
    if (kind === 'estados' && next.inicio.estado === oldId) next.inicio.estado = newId;
    for (const edge of next.transiciones) {
      if (kind === 'actores' && edge.actor === oldId) edge.actor = newId;
      if (kind === 'estados' && edge.desde === oldId) edge.desde = newId;
      if (kind === 'estados' && edge.hasta === oldId) edge.hasta = newId;
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
        const prefix = get('regla') === 'pre' ? '::' + get('operacion') + '() pre ' : ' inv ';
        const rule = get('regla-completa') || 'context ' + model.entidad + prefix + get('nombre') + ': ' + get('expresion');
        if (!rulePattern.test(rule.trim())) throw new Error('Escribe una invariante o precondición OCL en una sola línea.');
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
    if (item.id) {
      const probe = structuredClone(next);
      replaceReferences(probe, kind, item.id, '@removed');
      if (JSON.stringify(probe) !== JSON.stringify(next)) {
        showFormError(new Error('Este elemento tiene referencias. Cambia o elimina esas referencias antes de borrarlo.'));
        return;
      }
    }
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
  return { show };
}

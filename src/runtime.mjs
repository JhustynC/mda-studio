export function application(model, validators) {
  const root = document.querySelector('#application');
  const $ = selector => root.querySelector(selector);
  const stateNames = new Map(model.estados.map(state => [state.id, state.nombre]));
  const board = model.presentacion === 'tablero';
  let role = model.formulario.actor;
  let selected = null;
  let records = [];
  let durable = true;
  try {
    const stored = JSON.parse(localStorage.getItem(model.almacen.clave) ?? '[]');
    if (Array.isArray(stored)) records = stored.filter(record =>
      record && typeof record.id === 'string' && record.values && Array.isArray(record.history) && stateNames.has(record.state));
  } catch {
    durable = false;
  }

  function element(tag, label, className) {
    const node = document.createElement(tag);
    if (label !== undefined) node.textContent = label;
    if (className) node.className = className;
    return node;
  }

  function notify(message, error = false) {
    const notice = $('#app-notice');
    notice.textContent = message;
    notice.dataset.error = String(error);
  }

  function persist(next) {
    if (durable) {
      try {
        localStorage.setItem(model.almacen.clave, JSON.stringify(next));
      } catch {
        durable = false;
      }
    }
    records = next;
    return durable ? '' : ' Los cambios se conservan en esta pestaña.';
  }

  function showDate(iso) {
    return new Date(iso).toLocaleString('es', { dateStyle: 'short', timeStyle: 'short' });
  }

  function describe(record) {
    const title = model.campos.map(field => record.values[field.id]).find(value => typeof value === 'string' && value.length);
    return title ?? model.entidad;
  }

  function violations(values, operation) {
    return model.validadores.filter(rule => {
      if (rule.tipo === 'pre' && rule.operacion !== operation) return false;
      return !validators[rule.id](values);
    }).map(rule => rule.fuente.split(': ').at(-1) + ' (' + rule.id + ')');
  }

  function renderForm(form) {
    const controls = new Map();
    for (const field of model.campos) {
      const label = element('label', field.nombre);
      const input = element(field.control === 'select' ? 'select' : 'input');
      controls.set(field.id, input);
      input.name = field.id;
      input.required = field.requerido;
      if (field.control === 'select') {
        const empty = element('option', 'Selecciona una opción');
        empty.value = '';
        input.append(empty);
        for (const choice of field.opciones) {
          const option = element('option', choice.nombre);
          option.value = choice.id;
          input.append(option);
        }
      } else {
        input.type = field.control;
      }
      if (field.control === 'number') {
        input.step = '1';
        input.inputMode = 'numeric';
        input.placeholder = '0';
      } else if (field.control === 'text') {
        input.placeholder = field.nombre;
        input.maxLength = 300;
      }
      if (field.control === 'checkbox') {
        label.className = 'checkbox-field';
        label.prepend(input);
        form.append(label);
        continue;
      }
      label.append(input);
      form.append(label);
    }
    const submit = element('button', 'Crear caso', 'primary');
    submit.type = 'submit';
    form.append(submit);
    form.addEventListener('submit', event => {
      event.preventDefault();
      if (role !== model.formulario.actor) return;
      const values = Object.create(null);
      for (const field of model.campos) {
        const input = controls.get(field.id);
        if (field.control === 'checkbox') {
          if (field.requerido && !input.checked) return notify('Marca ' + field.nombre + '.', true);
          values[field.id] = input.checked;
          continue;
        }
        const inputValue = input.value.trim();
        if (field.requerido && !inputValue) return notify('Completa ' + field.nombre + '.', true);
        if (field.control === 'number' && inputValue && !Number.isSafeInteger(Number(inputValue))) {
          return notify(field.nombre + ' debe ser un entero válido.', true);
        }
        if (field.control === 'select' && inputValue && !field.opciones.some(choice => choice.id === inputValue)) {
          return notify('Selecciona una opción válida para ' + field.nombre + '.', true);
        }
        values[field.id] = inputValue && field.control === 'number' ? Number(inputValue) : inputValue || null;
      }
      const errors = violations(values, null);
      if (errors.length) return notify('Restricción incumplida: ' + errors.join(' · '), true);
      const now = new Date().toISOString();
      const record = {
        id: globalThis.crypto?.randomUUID?.() ?? String(Date.now()) + '-' + String(Math.random()).slice(2),
        values, state: model.formulario.estado,
        history: [{ action: model.formulario.nombre, role, at: now }],
      };
      const saved = persist([record, ...records]);
      selected = record.id;
      form.reset();
      render();
      notify('Caso creado.' + saved);
    });
  }

  function transition(record, action) {
    const latest = records.find(item => item.id === record.id);
    if (action.actor !== role || latest?.state !== action.desde) return;
    const errors = violations(latest.values, action.id);
    if (errors.length) return notify('Restricción incumplida: ' + errors.join(' · '), true);
    const next = {
      ...latest, state: action.hasta,
      history: [...latest.history, { action: action.nombre, role, at: new Date().toISOString() }],
    };
    const saved = persist(records.map(item => item.id === next.id ? next : item));
    render();
    notify(action.nombre + ' → ' + stateNames.get(next.state) + '.' + saved);
  }

  function renderDetail(record) {
    const detail = $('#app-detail');
    detail.replaceChildren();
    if (!record) {
      detail.append(element('h3', 'Detalle del caso'), element('p', 'Selecciona un caso para ver sus datos y acciones.', 'muted'));
      return;
    }
    detail.append(element('h3', describe(record)), element('span', stateNames.get(record.state), 'state'));
    const fields = element('dl');
    for (const field of model.campos) {
      const value = record.values[field.id];
      const display = typeof value === 'boolean' ? (value ? 'Sí' : 'No') :
        field.opciones?.find(choice => choice.id === value)?.nombre ?? value ?? '—';
      fields.append(element('dt', field.nombre), element('dd', display));
    }
    detail.append(fields);
    const actions = model.acciones.filter(action => action.desde === record.state && action.actor === role);
    const bar = element('div', undefined, 'action-bar');
    for (const action of actions) {
      const button = element('button', action.nombre, 'primary');
      button.onclick = () => transition(record, action);
      bar.append(button);
    }
    if (!actions.length) bar.append(element('p', 'No hay acciones pendientes para este rol.', 'muted'));
    detail.append(bar, element('h4', 'Historial'));
    const history = element('ol');
    for (const event of record.history) {
      const actor = model.roles.find(item => item.id === event.role);
      history.append(element('li', event.action + ' · ' + (actor?.nombre ?? event.role) + ' · ' + showDate(event.at)));
    }
    detail.append(history);
  }

  function caseButton(record) {
    const button = element('button', undefined, 'case');
    button.type = 'button';
    button.setAttribute('aria-pressed', String(record.id === selected));
    button.append(element('strong', describe(record)));
    if (!board) button.append(element('span', stateNames.get(record.state), 'state'));
    button.onclick = () => {
      selected = record.id;
      notify('');
      render();
      $('#app-detail').focus();
    };
    return button;
  }

  function renderBoard(inbox) {
    const groups = new Map(model.estados.map(state => [state.id, []]));
    for (const record of records) groups.get(record.state).push(record);
    for (const state of model.estados) {
      const group = groups.get(state.id);
      if (!group.length) continue;
      const lane = element('div', undefined, 'board-lane');
      const heading = element('h3', state.nombre + ' · ' + group.length);
      lane.append(heading, ...group.map(caseButton));
      inbox.append(lane);
    }
  }

  function render() {
    $('#app-create').hidden = role !== model.formulario.actor;
    const inbox = $('#app-inbox');
    inbox.replaceChildren();
    $('#app-count').textContent = records.length + (records.length === 1 ? ' caso' : ' casos');
    if (!records.length) inbox.append(element('p', 'Todavía no hay casos.', 'muted'));
    if (board) renderBoard(inbox);
    else for (const record of records) inbox.append(caseButton(record));
    renderDetail(records.find(record => record.id === selected));
  }

  $('#app-title').textContent = model.nombre;
  root.dataset.presentation = board ? 'tablero' : 'bandeja';
  if (board) $('#app-cases-title').textContent = 'Tablero por estado';
  document.title = model.nombre;
  $('#app-description').textContent = model.objetivo;
  $('#app-form-title').textContent = model.formulario.nombre;
  for (const actor of model.roles) {
    const option = element('option', actor.nombre);
    option.value = actor.id;
    $('#app-role').append(option);
  }
  $('#app-role').value = role;
  $('#app-role').onchange = event => {
    role = event.target.value;
    notify('');
    render();
  };
  renderForm($('#app-form'));
  render();
  if (!durable) notify('El almacenamiento local no está disponible. Los cambios se conservan en esta pestaña.');
}

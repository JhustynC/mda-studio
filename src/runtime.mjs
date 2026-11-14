export function application(model, validators, catalogValidators, sqlSchemaDdl = '') {
  const root = document.querySelector('#application');
  const $ = selector => root.querySelector(selector);
  const crud = model.tipo === 'crud';
  const link = model.integracion;
  const catalog = link?.catalogo ?? model;
  let catalogView = crud;
  let products = [];
  let movements = [];
  const stateNames = new Map((model.estados ?? []).map(state => [state.id, state.nombre]));
  const board = model.presentacion === 'tablero';
  let role = model.formulario?.actor;
  let editing = null;
  const controls = new Map();
  let selected = null;
  let records = [];
  let durable = true;
  let fileHandle = null;
  let idbDatabase = null;

  function filterValidRecords(list) {
    if (!Array.isArray(list)) return [];
    return list.filter(record =>
      record && typeof record.id === 'string' && record.values && (crud || (Array.isArray(record.history) && stateNames.has(record.state))));
  }

  function applyStoredPayload(stored) {
    if (!stored) return;
    if (link && Array.isArray(stored.records) && Array.isArray(stored.products) && Array.isArray(stored.movements)) {
      products = stored.products;
      movements = stored.movements;
      records = filterValidRecords(stored.records);
    } else if (Array.isArray(stored.records)) {
      records = filterValidRecords(stored.records);
    } else if (Array.isArray(stored)) {
      records = filterValidRecords(stored);
    }
  }

  try {
    const stored = JSON.parse(localStorage.getItem(model.almacen.clave) ?? 'null');
    applyStoredPayload(stored);
  } catch {
    durable = false;
  }

  function currentPayload(nextRecords = records, nextProducts = products, nextMovements = movements) {
    return {
      schemaVersion: 1,
      modelId: model.id,
      entity: model.entidad,
      updatedAt: new Date().toISOString(),
      records: nextRecords,
      ...(link ? { products: nextProducts, movements: nextMovements } : {}),
    };
  }

  function updateDbStatus(extra = '') {
    const badge = $('#db-badge');
    const text = $('#db-status-text');
    if (!badge || !text) return;
    const countText = crud
      ? records.length + ' registros'
      : records.length + ' casos' + (link ? ' · ' + products.length + ' productos · ' + movements.length + ' movimientos' : '');
    if (fileHandle) {
      badge.textContent = 'Archivo BD conectado: ' + fileHandle.name;
      badge.dataset.file = 'true';
      text.textContent = 'Sincronización automática en disco + IndexedDB (' + countText + ').' + extra;
    } else if (idbDatabase) {
      badge.textContent = 'BD IndexedDB activa';
      badge.dataset.file = 'false';
      text.textContent = 'Almacén transaccional IndexedDB (' + countText + ').' + extra;
    } else {
      badge.textContent = durable ? 'Almacén Local' : 'Memoria de sesión';
      badge.dataset.file = 'false';
      text.textContent = 'Persistencia en navegador (' + countText + ').' + extra;
    }
  }

  function initIndexedDb() {
    if (!globalThis.indexedDB) return;
    try {
      const request = indexedDB.open('mda_studio_runtime_db', 1);
      request.onupgradeneeded = event => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('models_data')) {
          db.createObjectStore('models_data', { keyPath: 'storageKey' });
        }
      };
      request.onsuccess = event => {
        idbDatabase = event.target.result;
        const tx = idbDatabase.transaction('models_data', 'readonly');
        const store = tx.objectStore('models_data');
        const getReq = store.get(model.almacen.clave);
        getReq.onsuccess = () => {
          if (getReq.result?.payload && !records.length && !products.length) {
            applyStoredPayload(getReq.result.payload);
            refreshCurrentView();
          } else if (records.length || products.length) {
            writeIndexedDb(currentPayload());
          }
          updateDbStatus();
        };
      };
    } catch {
      /* fallback to localStorage */
    }
  }

  function writeIndexedDb(payload) {
    if (!idbDatabase) return;
    try {
      const tx = idbDatabase.transaction('models_data', 'readwrite');
      tx.objectStore('models_data').put({ storageKey: model.almacen.clave, payload });
    } catch {
      /* ignore idb write error */
    }
  }

  async function syncFileHandle(payload) {
    if (!fileHandle) return;
    try {
      const writable = await fileHandle.createWritable();
      await writable.write(JSON.stringify(payload, null, 2) + '\n');
      await writable.close();
      updateDbStatus(' Guardado en archivo.');
    } catch {
      notify('No se pudo escribir automáticamente en el archivo conectado.', true);
    }
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

  function persist(next, nextProducts = products, nextMovements = movements) {
    const payload = currentPayload(next, nextProducts, nextMovements);
    if (durable) {
      try {
        localStorage.setItem(model.almacen.clave, JSON.stringify(link ? { records: next, products: nextProducts, movements: nextMovements } : next));
      } catch {
        durable = false;
      }
    }
    records = next;
    products = nextProducts;
    movements = nextMovements;
    writeIndexedDb(payload);
    syncFileHandle(payload);
    updateDbStatus();
    return fileHandle ? ' Sincronizado en ' + fileHandle.name + '.' : durable ? '' : ' Los cambios se conservan en esta pestaña.';
  }

  function sqlLiteral(val) {
    if (val === null || val === undefined) return 'NULL';
    if (typeof val === 'number') return String(val);
    if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE';
    return "'" + String(val).replace(/'/g, "''") + "'";
  }

  function sqlIdent(name) {
    return String(name).replace(/-/g, '_').toLowerCase();
  }

  function generateSqlDump() {
    const lines = [
      sqlSchemaDdl.trim(),
      '',
      '-- =================================================================',
      '-- VOLCADO DE DATOS ACTIVOS (INSERT INTO) · ' + new Date().toISOString(),
      '-- =================================================================',
    ];
    if (link) {
      const catTable = sqlIdent(catalog.entidad);
      const catCols = ['id', ...catalog.campos.map(c => sqlIdent(c.id))];
      lines.push('', '-- Registros de catálogo: ' + catalog.entidad + ' (' + products.length + ')');
      for (const prod of products) {
        const vals = [sqlLiteral(prod.id), ...catalog.campos.map(c => sqlLiteral(prod.values[c.id]))];
        lines.push('INSERT INTO ' + catTable + ' (' + catCols.join(', ') + ') VALUES (' + vals.join(', ') + ');');
      }
    }

    const mainTable = sqlIdent(model.entidad);
    const mainCols = ['id', ...(crud ? [] : ['estado_actual']), ...model.campos.map(c => sqlIdent(c.id))];
    lines.push('', '-- Registros principales: ' + model.entidad + ' (' + records.length + ')');
    for (const rec of records) {
      const vals = [
        sqlLiteral(rec.id),
        ...(crud ? [] : [sqlLiteral(rec.state)]),
        ...model.campos.map(c => sqlLiteral(rec.values[c.id])),
      ];
      lines.push('INSERT INTO ' + mainTable + ' (' + mainCols.join(', ') + ') VALUES (' + vals.join(', ') + ');');
      if (!crud && Array.isArray(rec.history)) {
        for (const ev of rec.history) {
          lines.push(
            'INSERT INTO ' + mainTable + '_historial (caso_id, accion, rol_actor, fecha_hora) VALUES (' +
            [sqlLiteral(rec.id), sqlLiteral(ev.action), sqlLiteral(ev.role), sqlLiteral(ev.at)].join(', ') + ');',
          );
        }
      }
    }

    if (link && movements.length) {
      lines.push('', '-- Movimientos de inventario (' + movements.length + ')');
      for (const mov of movements) {
        lines.push(
          'INSERT INTO ' + mainTable + '_movimientos_stock (caso_id, producto_sku, transicion, unidades, saldo_resultante, fecha_hora) VALUES (' +
          [sqlLiteral(mov.request), sqlLiteral(mov.sku), sqlLiteral(mov.action), sqlLiteral(mov.units), sqlLiteral(mov.stock), sqlLiteral(mov.at)].join(', ') + ');',
        );
      }
    }
    return lines.join('\n') + '\n';
  }

  function downloadFile(content, filename, mime) {
    const url = URL.createObjectURL(new Blob([content], { type: mime }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function showDate(iso) {
    return new Date(iso).toLocaleString('es', { dateStyle: 'short', timeStyle: 'short' });
  }

  function describe(record, fields = model.campos) {
    const title = fields.map(field => record.values[field.id]).find(value => typeof value === 'string' && value.length);
    return title ?? model.entidad;
  }

  function violations(values, operation, definition = model, rules = validators) {
    return definition.validadores.filter(rule => {
      if ((rule.tipo === 'pre' || rule.tipo === 'post') && rule.operacion !== operation) return false;
      return !rules[rule.id](values);
    }).map(rule => rule.fuente.split(': ').at(-1) + ' (' + rule.id + ')');
  }

  function renderForm(form) {
    const fields = catalogView ? catalog.campos : model.campos;
    form.replaceChildren();
    controls.clear();
    for (const field of fields) {
      const label = element('label', field.nombre);
      const reference = link && !catalogView && field.id === link.referencia;
      const input = element(reference || field.control === 'select' ? 'select' : 'input');
      controls.set(field.id, input);
      input.name = field.id;
      input.required = field.requerido;
      if (reference || field.control === 'select') {
        const empty = element('option', 'Selecciona una opción');
        empty.value = '';
        input.append(empty);
        const options = reference ? products.map(product => ({ id: product.id, nombre: describe(product, catalog.campos) + ' · ' +
          product.values[link.clave] + ' (' + product.values[link.existencias] + ' disponibles)' })) : field.opciones;
        for (const choice of options) {
          const option = element('option', choice.nombre);
          option.value = choice.id;
          input.append(option);
        }
      } else {
        input.type = field.control;
      }
      if (Array.isArray(field.atributosHtml)) {
        for (const attr of field.atributosHtml) {
          const m = /^(min|max|minlength|maxlength)="(-?\d+)"$/.exec(attr);
          if (m) input.setAttribute(m[1], m[2]);
        }
      }
      if (field.control === 'number') {
        input.step = '1';
        input.inputMode = 'numeric';
        input.placeholder = '0';
      } else if (field.control === 'text') {
        input.placeholder = field.nombre;
        if (!input.hasAttribute('maxlength')) input.maxLength = 300;
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
    const submit = element('button', catalogView ? 'Crear registro' : 'Crear caso', 'primary');
    submit.id = 'app-submit';
    submit.type = 'submit';
    form.append(submit);
    if (catalogView) {
      const cancel = element('button', 'Cancelar edición');
      cancel.id = 'crud-cancel-edit';
      cancel.type = 'button';
      cancel.hidden = true;
      cancel.onclick = () => { setEditing(null); notify(''); };
      form.append(cancel);
    }
    form.onsubmit = event => {
      event.preventDefault();
      if (!catalogView && role !== model.formulario.actor) return;
      const values = Object.create(null);
      for (const field of fields) {
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
        if (field.opciones && inputValue && !field.opciones.some(choice => choice.id === inputValue)) {
          return notify('Selecciona una opción válida para ' + field.nombre + '.', true);
        }
        values[field.id] = inputValue && field.control === 'number' ? Number(inputValue) : inputValue || null;
      }
      const errors = catalogView && link ? violations(values, null, catalog, catalogValidators) : violations(values, null);
      if (errors.length) return notify('Restricción OCL incumplida: ' + errors.join(' · '), true);
      if (catalogView) return saveRecord(values);
      if (link && !products.some(product => product.id === values[link.referencia])) return notify('Selecciona un producto del inventario.', true);
      if (link && values[link.cantidad] <= 0) return notify('La cantidad del préstamo debe ser mayor que cero.', true);
      const now = new Date().toISOString();
      const record = {
        id: newId(),
        values, state: model.formulario.estado,
        history: [{ action: model.formulario.nombre, role, at: now }],
      };
      const saved = persist([record, ...records]);
      selected = record.id;
      form.reset();
      render();
      notify('Caso creado en la base de datos.' + saved);
    };
  }

  function newId() { return globalThis.crypto?.randomUUID?.() ?? String(Date.now()) + '-' + String(Math.random()).slice(2); }

  function displayValue(field, value) {
    if (typeof value === 'boolean') return value ? 'Sí' : 'No';
    return field.opciones?.find(choice => choice.id === value)?.nombre ?? value ?? '—';
  }

  function setEditing(record) {
    editing = record?.id ?? null;
    $('#app-form').reset();
    $('#app-form-title').textContent = record ? 'Editar registro' : 'Nuevo registro';
    $('#app-submit').textContent = record ? 'Guardar cambios' : 'Crear registro';
    $('#crud-cancel-edit').hidden = !record;
    if (!record) return;
    for (const field of catalog.campos) {
      const input = controls.get(field.id);
      if (field.control === 'checkbox') input.checked = record.values[field.id] === true;
      else input.value = record.values[field.id] ?? '';
    }
    controls.values().next().value?.focus();
  }

  function saveRecord(values) {
    const entries = link ? products : records;
    if (link && values[link.existencias] < 0) return notify('Las existencias no pueden ser negativas.', true);
    const normalize = value => typeof value === 'string' ? value.trim().toLocaleLowerCase('es') : value;
    for (const key of catalog.unicos) {
      if (entries.some(record => record.id !== editing && normalize(record.values[key]) === normalize(values[key]))) {
        return notify('Valor duplicado para ' + catalog.campos.find(field => field.id === key).nombre + '.', true);
      }
    }
    const previous = entries.find(record => record.id === editing);
    if (editing && !previous) {
      setEditing(null);
      return notify('El registro ya no está disponible.', true);
    }
    const record = { id: previous?.id ?? newId(), values };
    const next = previous ? entries.map(item => item.id === record.id ? record : item) : [record, ...entries];
    const saved = link ? persist(records, next) : persist(next);
    setEditing(null);
    renderCrud();
    notify((previous ? 'Registro actualizado en BD.' : 'Registro creado en BD.') + saved);
  }

  function requestDelete(record) {
    if (link && records.some(item => item.values[link.referencia] === record.id)) {
      return notify('El producto está vinculado a una solicitud y su historial debe conservarse.', true);
    }
    const dialog = $('#crud-delete');
    $('#crud-delete-name').textContent = 'Se eliminará «' + describe(record, catalog.campos) + '».';
    $('#crud-delete-confirm').onclick = () => {
      const entries = (link ? products : records).filter(item => item.id !== record.id);
      const saved = link ? persist(records, entries) : persist(entries);
      if (editing === record.id) setEditing(null);
      dialog.close();
      renderCrud();
      $('#crud-search').focus();
      notify('Registro eliminado de BD.' + saved);
    };
    dialog.showModal();
  }

  function renderCrud() {
    const query = $('#crud-search').value.trim().toLocaleLowerCase('es');
    const entries = link ? products : records;
    const matching = entries.filter(record => catalog.campos.some(field =>
      String(displayValue(field, record.values[field.id])).toLocaleLowerCase('es').includes(query)));
    const rows = document.createDocumentFragment();
    for (const record of matching) {
      const row = element('tr');
      for (const field of catalog.campos) {
        const cell = element('td', displayValue(field, record.values[field.id]));
        if (field.id === link?.existencias) cell.dataset.stock = '';
        row.append(cell);
      }
      const actions = element('td', undefined, 'crud-actions');
      const edit = element('button', 'Editar');
      edit.setAttribute('aria-label', 'Editar ' + describe(record, catalog.campos));
      edit.onclick = () => { notify(''); setEditing(record); };
      const remove = element('button', 'Eliminar', 'danger');
      remove.setAttribute('aria-label', 'Eliminar ' + describe(record, catalog.campos));
      remove.onclick = () => requestDelete(record);
      actions.append(edit, remove);
      row.append(actions);
      rows.append(row);
    }
    $('#crud-rows').replaceChildren(rows);
    $('#crud-count').textContent = matching.length + ' de ' + entries.length + ' registros';
    $('#crud-empty').hidden = matching.length > 0;
    $('#crud-empty').textContent = query ? 'No hay coincidencias.' : 'Todavía no hay registros.';
  }

  function transition(record, action) {
    const latest = records.find(item => item.id === record.id);
    if (action.actor !== role || latest?.state !== action.desde) return;
    const errors = violations(latest.values, action.id);
    if (errors.length) return notify('Restricción OCL incumplida: ' + errors.join(' · '), true);
    const next = {
      ...latest, state: action.hasta,
      history: [...latest.history, { action: action.nombre, role, at: new Date().toISOString() }],
    };
    const nextRecords = records.map(item => item.id === next.id ? next : item);
    const effect = link?.movimientos.find(entry => entry.transicion === action.id);
    const saved = effect ? persistMovement(nextRecords, latest, effect) : persist(nextRecords);
    if (saved === undefined) return;
    render();
    notify(action.nombre + ' → ' + stateNames.get(next.state) + '.' + saved);
  }

  function persistMovement(nextRecords, request, effect) {
    const product = products.find(item => item.id === request.values[link.referencia]);
    const quantity = request.values[link.cantidad];
    if (!product || !Number.isSafeInteger(quantity) || quantity <= 0) {
      notify('La solicitud no tiene un producto y cantidad válidos.', true);
      return;
    }
    const units = effect.tipo === 'salida' ? -quantity : quantity;
    const stock = product.values[link.existencias] + units;
    if (!Number.isSafeInteger(stock) || stock < 0) {
      notify('No se puede aplicar el movimiento. Existencias disponibles: ' + product.values[link.existencias] + '.', true);
      return;
    }
    const values = { ...product.values, [link.existencias]: stock };
    const errors = violations(values, null, catalog, catalogValidators);
    if (errors.length) { notify('Restricción de inventario: ' + errors.join(' · '), true); return; }
    const nextProducts = products.map(item => item.id === product.id ? { ...item, values } : item);
    const movement = { request: request.id, requester: describe(request), sku: values[link.clave], name: describe(product, catalog.campos),
      units, stock, action: effect.transicion, at: new Date().toISOString() };
    return persist(nextRecords, nextProducts, [movement, ...movements]);
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
      const product = link && field.id === link.referencia ? products.find(item => item.id === value) : null;
      fields.append(element('dt', field.nombre), element('dd', product ? describe(product, catalog.campos) : displayValue(field, value)));
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
    if (!records.length) inbox.append(element('p', role === model.formulario.actor ? 'Completa el formulario para registrar el primer caso.' : 'Aquí aparecerán los casos cuando se registren.', 'app-empty'));
    if (board) renderBoard(inbox);
    else for (const record of records) inbox.append(caseButton(record));
    renderDetail(records.find(record => record.id === selected));
  }

  function refreshCurrentView() {
    if (crud) {
      renderCrud();
    } else if (link) {
      const activeMod = $('#app-nav button[aria-pressed="true"]')?.dataset.module ?? 'requests';
      showModule(activeMod);
    } else {
      render();
    }
  }

  function showModule(module) {
    catalogView = module === 'catalog';
    const requests = module === 'requests';
    editing = null;
    root.dataset.presentation = catalogView ? 'tabla' : model.presentacion;
    $('.layout').hidden = !requests && !catalogView;
    $('#app-role').closest('label').hidden = !requests;
    $('#app-cases').hidden = !requests;
    $('#app-detail').hidden = !requests;
    $('#crud-catalog').hidden = !catalogView;
    $('#stock-ledger').hidden = module !== 'ledger';
    for (const button of $('#app-nav').querySelectorAll('button')) button.setAttribute('aria-pressed', String(button.dataset.module === module));
    if (requests || catalogView) renderForm($('#app-form'));
    if (requests) {
      $('#app-form-title').textContent = model.formulario.nombre;
      render();
    } else if (catalogView) {
      $('#app-create').hidden = false;
      $('#app-form-title').textContent = 'Nuevo registro';
      renderCrud();
    } else {
      const items = movements.map(item => {
        const action = model.acciones.find(edge => edge.id === item.action)?.nombre ?? item.action;
        const row = element('li', undefined, 'movement');
        row.dataset.direction = item.units > 0 ? 'in' : 'out';
        const direction = element('span', item.units > 0 ? '↙' : '↗', 'movement-direction');
        direction.setAttribute('aria-hidden', 'true');
        const copy = element('div', undefined, 'movement-copy');
        copy.append(element('strong', action + ' · ' + item.name),
          element('span', [item.sku, item.requester, showDate(item.at)].filter(Boolean).join(' · ')));
        const totals = element('div', undefined, 'movement-totals');
        totals.append(element('strong', (item.units > 0 ? '+' : '') + item.units + ' unidades'),
          element('span', 'Disponibles: ' + item.stock));
        row.append(direction, copy, totals);
        return row;
      });
      $('#stock-movements').replaceChildren(...items);
      $('#stock-empty').hidden = items.length > 0;
    }
    const panel = $(requests ? '.layout' : catalogView ? '#crud-catalog' : '#stock-ledger');
    panel.classList.remove('module-enter');
    requestAnimationFrame(() => panel.classList.add('module-enter'));
    if (durable) notify('');
  }

  $('#db-connect-file').onclick = async () => {
    if (typeof window.showSaveFilePicker === 'function') {
      try {
        fileHandle = await window.showSaveFilePicker({
          suggestedName: model.id + '.db.json',
          types: [{ description: 'Base de datos JSON MDA', accept: { 'application/json': ['.json'] } }],
        });
        await syncFileHandle(currentPayload());
        notify('Archivo de base de datos «' + fileHandle.name + '» conectado en vivo.');
        return;
      } catch (err) {
        if (err?.name === 'AbortError') return;
      }
    }
    downloadFile(JSON.stringify(currentPayload(), null, 2) + '\n', model.id + '.db.json', 'application/json');
    notify('Base de datos descargada como ' + model.id + '.db.json (abre la app en una pestaña nueva para conexión directa en disco).');
  };

  $('#db-import-btn').onclick = () => $('#db-import-input').click();
  $('#db-import-input').onchange = async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      applyStoredPayload(parsed);
      persist(records, products, movements);
      refreshCurrentView();
      notify('Base de datos importada desde «' + file.name + '».');
    } catch {
      notify('El archivo seleccionado no es una base de datos JSON válida.', true);
    } finally {
      event.target.value = '';
    }
  };

  $('#db-export-json').onclick = () => {
    downloadFile(JSON.stringify(currentPayload(), null, 2) + '\n', model.id + '.db.json', 'application/json');
    notify('Volcado JSON guardado (' + model.id + '.db.json).');
  };

  $('#db-export-sql').onclick = () => {
    downloadFile(generateSqlDump(), model.id + '.datos.sql', 'application/sql;charset=utf-8');
    notify('Volcado SQL DDL + INSERT guardado (' + model.id + '.datos.sql).');
  };

  $('#db-inspect-btn').onclick = () => {
    $('#db-dialog-subtitle').textContent = 'Esquema relacional DDL y sentencias INSERT en tiempo real para ' + model.nombre;
    $('#db-dialog-sql').textContent = generateSqlDump();
    $('#db-dialog').showModal();
  };
  $('#db-dialog-close').onclick = () => $('#db-dialog').close();

  $('#app-title').textContent = model.nombre;
  root.dataset.presentation = board ? 'tablero' : 'bandeja';
  $('#app-cases-title').textContent = board ? 'Tablero por estado' : 'Lista de casos';
  $('#app-cases-help').textContent = board ? 'Los casos se agrupan por su estado.' : 'Cada caso muestra su estado al lado.';
  document.title = model.nombre;
  $('#app-description').textContent = model.objetivo;
  if (!link && !crud) renderForm($('#app-form'));
  if (!durable) notify('El almacenamiento local no está disponible. Los cambios se conservan en esta pestaña.');
  if (crud || link) {
    for (const name of [...catalog.campos.map(field => field.nombre), 'Acciones']) {
      const cell = element('th', name);
      cell.scope = 'col';
      $('#crud-columns').append(cell);
    }
    $('#crud-search').oninput = renderCrud;
    $('#crud-delete-cancel').onclick = () => $('#crud-delete').close();
    if (link) {
      $('#app-nav').hidden = false;
      for (const button of $('#app-nav').querySelectorAll('button')) button.onclick = () => showModule(button.dataset.module);
    }
  }
  initIndexedDb();
  updateDbStatus();
  if (crud) { showModule('catalog'); return; }
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
  if (link) showModule('requests');
  else render();
}

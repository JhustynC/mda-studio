export function createCompiler(METAMODEL, application) {
  const controls = { Texto: 'text', Entero: 'number', Fecha: 'date', Seleccion: 'select', Booleano: 'checkbox' };
  const ATOMS = {
    version: x => x === 1,
    crudType: x => x === 'crud',
    movementType: x => x === 'salida' || x === 'entrada',
    crudOperation: x => ['crear', 'consultar', 'editar', 'eliminar'].includes(x),
    table: x => x === 'tabla',
    id: x => typeof x === 'string' && /^[a-z][a-z0-9-]*$/.test(x),
    nullableId: x => x === null || ATOMS.id(x),
    class: x => typeof x === 'string' && /^[A-Za-z][A-Za-z0-9_]*$/.test(x),
    text: x => typeof x === 'string' && x.trim().length > 0,
    bool: x => typeof x === 'boolean',
    int: Number.isSafeInteger,
    domainType: x => typeof x === 'string' && Object.hasOwn(controls, x),
    ruleType: x => ['inv', 'pre'].includes(x),
    access: x => ['size', 'value'].includes(x),
    operator: x => ['>=', '<=', '>', '<', '=', '<>'].includes(x),
    control: x => Object.values(controls).includes(x),
    presentation: x => ['bandeja', 'tablero'].includes(x),
  };

  function conform(type, value, path, issues) {
    if (Array.isArray(type)) {
      if (!Array.isArray(value)) issues.push(path + ' debe ser una lista.');
      else value.forEach((item, index) => conform(type[0], item, path + '[' + index + ']', issues));
      return;
    }
    if (Object.hasOwn(ATOMS, type)) {
      if (!ATOMS[type](value)) issues.push(path + ' no cumple el tipo ' + type + '.');
      return;
    }
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      issues.push(path + ' debe ser un objeto ' + type + '.');
      return;
    }
    const remaining = new Set(Object.keys(value));
    for (const [key, fieldType] of Object.entries(METAMODEL[type])) {
      const field = key.replace(/\?$/, '');
      remaining.delete(field);
      if (key.endsWith('?') && !Object.hasOwn(value, field)) continue;
      conform(fieldType, Object.hasOwn(value, field) ? value[field] : undefined, path + '.' + field, issues);
    }
    for (const field of remaining) issues.push(path + '.' + field + ' no está definido en el metamodelo.');
  }

  function validateModel(type, model) {
    const issues = [];
    conform(type, model, type, issues);
    if (issues.length) throw new Error(issues.join('\n'));
  }

  function indexBy(list, key, label, issues) {
    const index = new Map();
    for (const item of list) {
      if (index.has(item[key])) issues.push(label + ' duplicado: ' + item[key] + '.');
      index.set(item[key], item);
    }
    return index;
  }

  function parseOcl(source, model, fields, operations) {
    const context = /^context\s+([A-Za-z]\w*)(?:::([a-z][a-z0-9-]*)\(\))?\s+(inv|pre)\s+([A-Za-z]\w*)\s*:\s*(.+)$/.exec(source.trim());
    if (!context) throw new Error('Sintaxis OCL no soportada: ' + source);
    const [, entity, operation, type, id, expression] = context;
    if (entity !== model.entidad || (type === 'inv' && operation) || (type === 'pre' && !operations.has(operation))) {
      throw new Error(id + ': el contexto o la operación no existe o no corresponde a ' + type + '.');
    }
    const comparisons = expression.split(/\s+and\s+/).map(term => {
      const match = /^self\.([a-z][a-z0-9-]*)(\.size\(\))?\s*(>=|<=|<>|=|>|<)\s*(-?\d+)$/.exec(term.trim());
      if (!match) throw new Error(id + ': comparación OCL no soportada: ' + term);
      const [, field, sizeCall, operator, number] = match;
      const property = fields.get(field);
      if (property?.tipo !== (sizeCall ? 'Texto' : 'Entero')) {
        throw new Error(id + ': atributo desconocido o tipo incompatible: ' + field + '.');
      }
      if (!Number.isSafeInteger(Number(number))) throw new Error(id + ': número fuera de rango.');
      return { campo: field, acceso: sizeCall ? 'size' : 'value', operador: operator, valor: Number(number) };
    });
    return { id, clase: entity, tipo: type, operacion: operation ?? null, expresion: comparisons, fuente: source };
  }

  function reachable(start, operations, from, to) {
    const seen = new Set(start);
    for (const current of seen) {
      for (const operation of operations) {
        if (operation[from] === current) seen.add(operation[to]);
      }
    }
    return seen;
  }

  function indexFields(cim, issues) {
    const fields = indexBy(cim.datos, 'id', 'Dato', issues);
    if (!fields.size) issues.push('El modelo necesita al menos un dato.');
    for (const field of fields.values()) {
      if (field.tipo === 'Seleccion') {
        if (!field.opciones?.length) issues.push(field.id + ': Seleccion necesita al menos una opción.');
        else indexBy(field.opciones, 'id', 'Opción de ' + field.id, issues);
      } else if (field.opciones !== undefined) {
        issues.push(field.id + ': opciones solo se admite en campos de tipo Seleccion.');
      }
    }
    return fields;
  }

  function toPim(cim) {
    const issues = [];
    const fields = indexFields(cim, issues);
    const actors = indexBy(cim.actores, 'id', 'Actor', issues);
    const states = indexBy(cim.estados, 'id', 'Estado', issues);
    const operations = indexBy(cim.transiciones, 'id', 'Transición', issues);
    if (!actors.has(cim.inicio.actor)) issues.push('El actor inicial no existe.');
    if (!states.has(cim.inicio.estado) || states.get(cim.inicio.estado).final) issues.push('El estado inicial debe existir y estar abierto.');
    for (const operation of operations.values()) {
      if (!actors.has(operation.actor)) issues.push(operation.id + ': actor desconocido.');
      if (!states.has(operation.desde) || !states.has(operation.hasta)) issues.push(operation.id + ': estado desconocido.');
      if (states.get(operation.desde)?.final) issues.push(operation.id + ': un estado final no admite transiciones.');
    }
    const finalStates = cim.estados.filter(state => state.final).map(state => state.id);
    if (!finalStates.length) issues.push('Debe existir al menos un estado final.');
    const accessible = reachable([cim.inicio.estado], cim.transiciones, 'desde', 'hasta');
    const canFinish = reachable(finalStates, cim.transiciones, 'hasta', 'desde');
    for (const state of states.keys()) {
      if (!accessible.has(state)) issues.push('Estado inaccesible desde el inicio: ' + state + '.');
      if (!canFinish.has(state)) issues.push('Estado sin camino a un fin: ' + state + '.');
    }
    const rules = readRules(cim, fields, operations, issues);
    if (issues.length) throw new Error(issues.join('\n'));
    const integracion = cim.integracion ? integrate(cim, fields, operations) : undefined;
    return {
      id: cim.id, nombre: cim.nombre, objetivo: cim.objetivo, entidad: cim.entidad,
      roles: cim.actores, propiedades: cim.datos, creacion: cim.inicio, estados: cim.estados,
      operaciones: cim.transiciones, restricciones: rules,
      ...(integracion ? { integracion } : {}),
    };
  }

  function readRules(cim, fields, operations, issues) {
    const rules = [];
    for (const source of cim.ocl) {
      try {
        rules.push(parseOcl(source, cim, fields, operations));
      } catch (error) {
        issues.push(error.message);
      }
    }
    indexBy(rules, 'id', 'Restricción', issues);
    return rules;
  }

  function toCrudPim(cim) {
    const issues = [];
    const fields = indexFields(cim, issues);
    const unicos = cim.unicos ?? [];
    if (new Set(unicos).size !== unicos.length) issues.push('Hay campos únicos repetidos.');
    for (const id of unicos) {
      const field = fields.get(id);
      if (!field || !['Texto', 'Entero'].includes(field.tipo) || !field.requerido) {
        issues.push(id + ': un campo único debe ser obligatorio y de tipo Texto o Entero.');
      }
    }
    const restricciones = readRules(cim, fields, new Map(), issues);
    if (issues.length) throw new Error(issues.join('\n'));
    return { tipo: 'crud', id: cim.id, nombre: cim.nombre, objetivo: cim.objetivo, entidad: cim.entidad,
      propiedades: cim.datos, unicos, operaciones: ['crear', 'consultar', 'editar', 'eliminar'], restricciones };
  }

  function integrate(cim, fields, operations) {
    const { catalogo: source, referencia, clave, existencias, cantidad, movimientos } = cim.integracion;
    const catalogo = toCrudPim(source);
    const stock = catalogo.propiedades.find(field => field.id === existencias);
    const key = catalogo.propiedades.find(field => field.id === clave);
    function required(field, type) { return field?.tipo === type && field.requerido; }
    if (!required(fields.get(referencia), 'Texto') || !required(key, 'Texto') || !catalogo.unicos.includes(clave)) {
      throw new Error('El vínculo necesita una referencia obligatoria de Texto y una clave de Texto única en el catálogo.');
    }
    if (!required(stock, 'Entero') || !required(fields.get(cantidad), 'Entero')) {
      throw new Error('Existencias y cantidad deben ser campos obligatorios de tipo Entero.');
    }
    const issues = [];
    const effects = indexBy(movimientos, 'transicion', 'Movimiento', issues);
    if (!movimientos.some(effect => effect.tipo === 'salida') || !movimientos.some(effect => effect.tipo === 'entrada')) {
      issues.push('Declara al menos una salida y una entrada de inventario.');
    }
    for (const effect of movimientos) if (!operations.has(effect.transicion)) issues.push('Transición de inventario desconocida: ' + effect.transicion);
    if (issues.length) throw new Error(issues.join('\n'));
    const finals = new Set(cim.estados.filter(state => state.final).map(state => state.id));
    const queue = [[cim.inicio.estado, 0]];
    const seen = new Set();
    for (const [state, outstanding] of queue) {
      const visit = state + ':' + outstanding;
      if (seen.has(visit)) continue;
      seen.add(visit);
      if (outstanding && finals.has(state)) throw new Error('El estado final ' + state + ' deja existencias pendientes de devolver.');
      for (const edge of operations.values()) {
        if (edge.desde !== state) continue;
        const effect = effects.get(edge.id)?.tipo;
        const next = outstanding + (effect === 'salida' ? 1 : effect === 'entrada' ? -1 : 0);
        if (next < 0 || next > 1) throw new Error('Movimiento de inventario fuera de secuencia en ' + edge.id + '.');
        queue.push([edge.hasta, next]);
      }
    }
    return { ...cim.integracion, catalogo };
  }

  function toPsm(pim, projectId, presentation) {
    const storageScope = projectId ? 'proyecto.' + projectId + '.' + pim.id : pim.id;
    const metadata = {
      id: pim.id, nombre: pim.nombre, objetivo: pim.objetivo, entidad: pim.entidad,
      plataforma: 'HTML5 / JavaScript ES2022 / Web Storage',
    };
    const campos = pim.propiedades.map(field => ({
      id: field.id, nombre: field.nombre, control: field.id === pim.integracion?.referencia ? 'select' : controls[field.tipo],
      requerido: field.requerido ?? false,
      ...(field.opciones ? { opciones: field.opciones } : {}),
    }));
    const crud = pim.tipo === 'crud';
    const almacen = { tipo: 'localStorage', clave: (crud ? 'mda.registros.' : 'mda.casos.') + storageScope };
    if (crud) return { ...metadata, tipo: 'crud', presentacion: 'tabla', almacen, campos,
      unicos: pim.unicos, acciones: pim.operaciones, validadores: pim.restricciones };
    return { ...metadata, presentacion: presentation, almacen, roles: pim.roles, campos,
      formulario: pim.creacion, estados: pim.estados, acciones: pim.operaciones, validadores: pim.restricciones,
      ...(pim.integracion ? { integracion: { ...pim.integracion, catalogo: toPsm(pim.integracion.catalogo, projectId, 'tabla') } } : {}) };
  }

  function jsLiteral(value) {
    return JSON.stringify(value).replace(/</g, '\\u003c');
  }

  function emitValidator(rule) {
    const operators = { '=': '===', '<>': '!==' };
    const terms = rule.expresion.map(term => {
      const field = 'values[' + jsLiteral(term.campo) + ']';
      const left = term.acceso === 'size' ? 'Array.from(' + field + ' ?? "").length' : field;
      const operator = operators[term.operador] ?? term.operador;
      const comparison = left + ' ' + operator + ' ' + term.valor;
      return '(' + field + ' != null && ' + comparison + ')';
    });
    return jsLiteral(rule.id) + ': (values) => ' + terms.join(' && ');
  }

  function instantiate(template, replacements) {
    return template.replace(/\{\{([A-Z]+)\}\}/g, (_, name) => {
      if (!Object.hasOwn(replacements, name)) throw new Error('Variable de plantilla desconocida: ' + name);
      return replacements[name];
    });
  }

  function generateApp(psm, assets, initialData) {
    const catalogValidators = psm.integracion?.catalogo.validadores.map(emitValidator).join(',\n  ') ?? '';
    return instantiate(assets.html, {
      CSS: assets.css,
      SCRIPT: 'const model = ' + jsLiteral(psm) + ';\n'
        + 'const validators = {\n  ' + psm.validadores.map(emitValidator).join(',\n  ') + '\n};\n'
        + 'const catalogValidators = {' + catalogValidators + '};\n'
        + '(' + application.toString() + ')(model, validators, catalogValidators, ' + jsLiteral(initialData ?? null) + ');',
    });
  }



  function readCim(source) {
    let cim;
    try {
      cim = JSON.parse(source.replace(/^\uFEFF/, ''));
    } catch (error) {
      throw new Error('JSON inválido. ' + error.message);
    }
    validateModel(cim?.tipo === 'crud' ? 'CIMCrud' : 'CIM', cim);
    return cim;
  }

  function compile(source, assets, projectId, presentation = 'bandeja', initialData) {
    const cim = readCim(source);
    const crud = cim.tipo === 'crud';
    const pim = validateCim(cim);
    validateModel(crud ? 'PIMCrud' : 'PIM', pim);
    const psm = toPsm(pim, projectId, presentation);
    validateModel(crud ? 'PSMCrud' : 'PSM', psm);
    const trace = [
      ...pim.propiedades.map(field => ({
        cim: 'datos.' + field.id, pim: cim.entidad + '.' + field.id, psm: 'campos.' + field.id,
        app: field.id === pim.integracion?.referencia ? 'Selector de inventario' :
          controls[field.tipo] === 'select' ? 'select' : 'input[type=' + controls[field.tipo] + ']',
      })),
      ...pim.operaciones.map(operation => crud ? {
        cim: 'tipo.crud', pim: 'operaciones.' + operation, psm: 'acciones.' + operation, app: operation,
      } : ({
        cim: 'transiciones.' + operation.id, pim: 'operaciones.' + operation.id,
        psm: 'acciones.' + operation.id, app: operation.desde + ' → ' + operation.hasta,
      })),
      ...(crud ? pim.unicos.map(id => ({
        cim: 'unicos.' + id, pim: 'unicos.' + id, psm: 'unicos.' + id, app: 'Valor único al crear y editar',
      })) : []),
      ...pim.restricciones.map(rule => ({
        cim: 'ocl.' + rule.id, pim: rule.tipo + ' ' + rule.id, psm: 'validadores.' + rule.id,
        app: 'validators[' + JSON.stringify(rule.id) + ']',
      })),
    ];
    if (pim.integracion) {
      const link = pim.integracion;
      for (const field of link.catalogo.propiedades) trace.push({
        cim: 'integracion.catalogo.datos.' + field.id, pim: 'integracion.catalogo.propiedades.' + field.id,
        psm: 'integracion.catalogo.campos.' + field.id, app: 'Inventario · ' + field.nombre,
      });
      trace.push({ cim: 'integracion.referencia', pim: cim.entidad + '.' + link.referencia + ' → ' + link.catalogo.entidad + '.' + link.clave,
        psm: 'integracion.referencia', app: 'Selector de inventario compartido' });
      for (const movement of link.movimientos) trace.push({
        cim: 'integracion.movimientos.' + movement.transicion, pim: 'operaciones.' + movement.transicion,
        psm: 'integracion.movimientos.' + movement.transicion, app: movement.tipo === 'salida' ? 'Descontar existencias' : 'Reponer existencias',
      });
    }
    return { cim, pim, psm, trace, html: generateApp(psm, assets, initialData) };
  }
  function validateCim(cim) {
    return cim.tipo === 'crud' ? toCrudPim(cim) : toPim(cim);
  }
  return Object.assign(compile, { readCim, validateCim });
}

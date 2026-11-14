export function createCompiler(METAMODEL, application) {
  const controls = { Texto: 'text', Entero: 'number', Fecha: 'date', Seleccion: 'select', Booleano: 'checkbox' };
  const ATOMS = {
    version: x => x === 1,
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

  function toPim(cim) {
    const issues = [];
    const actors = indexBy(cim.actores, 'id', 'Actor', issues);
    const fields = indexBy(cim.datos, 'id', 'Dato', issues);
    const states = indexBy(cim.estados, 'id', 'Estado', issues);
    const operations = indexBy(cim.transiciones, 'id', 'Transición', issues);
    if (!fields.size) issues.push('El proceso necesita al menos un dato.');
    for (const field of fields.values()) {
      if (field.tipo === 'Seleccion') {
        if (!field.opciones?.length) issues.push(field.id + ': Seleccion necesita al menos una opción.');
        else indexBy(field.opciones, 'id', 'Opción de ' + field.id, issues);
      } else if (field.opciones !== undefined) {
        issues.push(field.id + ': opciones solo se admite en campos de tipo Seleccion.');
      }
    }
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
    const rules = [];
    for (const source of cim.ocl) {
      try {
        rules.push(parseOcl(source, cim, fields, operations));
      } catch (error) {
        issues.push(error.message);
      }
    }
    indexBy(rules, 'id', 'Restricción', issues);
    if (issues.length) throw new Error(issues.join('\n'));
    return {
      id: cim.id, nombre: cim.nombre, objetivo: cim.objetivo, entidad: cim.entidad,
      roles: cim.actores, propiedades: cim.datos, creacion: cim.inicio, estados: cim.estados,
      operaciones: cim.transiciones, restricciones: rules,
    };
  }

  function toPsm(pim, projectId, presentation) {
    const storageScope = projectId ? 'proyecto.' + projectId + '.' + pim.id : pim.id;
    return {
      id: pim.id, nombre: pim.nombre, objetivo: pim.objetivo, entidad: pim.entidad,
      plataforma: 'HTML5 / JavaScript ES2022 / Web Storage',
      presentacion: presentation,
      almacen: { tipo: 'localStorage', clave: 'mda.casos.' + storageScope },
      roles: pim.roles, campos: pim.propiedades.map(field => ({
        id: field.id, nombre: field.nombre, control: controls[field.tipo],
        requerido: field.requerido ?? false,
        ...(field.opciones ? { opciones: field.opciones } : {}),
      })),
      formulario: pim.creacion, estados: pim.estados, acciones: pim.operaciones, validadores: pim.restricciones,
    };
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

  function generateApp(psm, assets) {
    return instantiate(assets.html, {
      CSS: assets.css,
      SCRIPT: 'const model = ' + jsLiteral(psm) + ';\n'
        + 'const validators = {\n  ' + psm.validadores.map(emitValidator).join(',\n  ') + '\n};\n'
        + '(' + application.toString() + ')(model, validators);',
    });
  }



  function readCim(source) {
    let cim;
    try {
      cim = JSON.parse(source.replace(/^\uFEFF/, ''));
    } catch (error) {
      throw new Error('JSON inválido. ' + error.message);
    }
    validateModel('CIM', cim);
    return cim;
  }

  function compile(source, assets, projectId, presentation = 'bandeja') {
    const cim = readCim(source);
    const pim = toPim(cim);
    validateModel('PIM', pim);
    const psm = toPsm(pim, projectId, presentation);
    validateModel('PSM', psm);
    const trace = [
      ...pim.propiedades.map(field => ({
        cim: 'datos.' + field.id, pim: cim.entidad + '.' + field.id, psm: 'campos.' + field.id,
        app: controls[field.tipo] === 'select' ? 'select' : 'input[type=' + controls[field.tipo] + ']',
      })),
      ...pim.operaciones.map(operation => ({
        cim: 'transiciones.' + operation.id, pim: 'operaciones.' + operation.id,
        psm: 'acciones.' + operation.id, app: operation.desde + ' → ' + operation.hasta,
      })),
      ...pim.restricciones.map(rule => ({
        cim: 'ocl.' + rule.id, pim: rule.tipo + ' ' + rule.id, psm: 'validadores.' + rule.id,
        app: 'validators[' + JSON.stringify(rule.id) + ']',
      })),
    ];
    return { cim, pim, psm, trace, html: generateApp(psm, assets) };
  }
  return Object.assign(compile, { readCim, validateCim: toPim });
}

export function createCompiler(METAMODEL, application) {
  const controls = { Texto: 'text', Entero: 'number', Fecha: 'date', Seleccion: 'select', Booleano: 'checkbox' };
  const ecoreTypes = { Texto: 'EString', Entero: 'EInt', Fecha: 'EDate', Seleccion: 'EEnum', Booleano: 'EBoolean' };
  const umlTypes = { Texto: 'String', Entero: 'Integer', Fecha: 'Date', Seleccion: 'Enumeration', Booleano: 'Boolean' };
  const sqlTypes = { Texto: 'VARCHAR(300)', Entero: 'INTEGER', Fecha: 'DATE', Seleccion: 'VARCHAR(64)', Booleano: 'BOOLEAN' };

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
    ruleType: x => ['inv', 'pre', 'post'].includes(x),
    access: x => ['size', 'value'].includes(x),
    operator: x => ['>=', '<=', '>', '<', '=', '<>'].includes(x),
    ruleValue: x => Number.isSafeInteger(x) || typeof x === 'string' || typeof x === 'boolean',
    logicalOperator: x => ['and', 'or', 'implies'].includes(x),
    attributeOrigin: x => ['sistema', 'dominio'].includes(x),
    ecoreType: x => ['EString', 'EInt', 'EDate', 'EEnum', 'EBoolean', 'EList<EventoFlujo>'].includes(x),
    multiplicity: x => ['0..1', '1..1', '0..*', '1..*'].includes(x),
    visibility: x => ['public', 'protected', 'private'].includes(x),
    relationKind: x => ['asociacion', 'composicion', 'dependencia', 'integracion'].includes(x),
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

  function tokenizeOclTerms(expression) {
    const tokens = [];
    const pattern = /\s+(and|or|implies)\s+/gi;
    let lastIndex = 0;
    let connector = null;
    let match;
    while ((match = pattern.exec(expression)) !== null) {
      tokens.push({ connector, term: expression.slice(lastIndex, match.index).trim() });
      connector = match[1].toLowerCase();
      lastIndex = pattern.lastIndex;
    }
    tokens.push({ connector, term: expression.slice(lastIndex).trim() });
    return tokens;
  }

  function parseOcl(source, model, fields, operations) {
    const context = /^context\s+([A-Za-z]\w*)(?:::([a-z][a-z0-9-]*)\(\))?\s+(inv|pre|post)\s+([A-Za-z]\w*)\s*:\s*(.+)$/.exec(source.trim());
    if (!context) throw new Error('Sintaxis OCL no soportada: ' + source);
    const [, entity, operation, type, id, expression] = context;
    if (entity !== model.entidad || (type === 'inv' && operation) || ((type === 'pre' || type === 'post') && !operations.has(operation))) {
      throw new Error(id + ': el contexto o la operación no existe o no corresponde a ' + type + '.');
    }
    const rawTerms = tokenizeOclTerms(expression);
    const comparisons = rawTerms.map(({ connector, term }) => {
      const match = /^self\.([a-z][a-z0-9-]*)(\.size\(\))?\s*(>=|<=|<>|=|>|<)\s*(.+)$/.exec(term);
      if (!match) throw new Error(id + ': comparación OCL no soportada: ' + term);
      const [, field, sizeCall, operator, rawRight] = match;
      const property = fields.get(field);
      if (!property) throw new Error(id + ': atributo desconocido: ' + field + '.');
      const right = rawRight.trim();
      const base = {
        campo: field,
        acceso: sizeCall ? 'size' : 'value',
        operador: operator,
        ...(connector ? { conector: connector } : {}),
      };

      if (sizeCall) {
        if (!['Texto', 'Fecha'].includes(property.tipo)) {
          throw new Error(id + ': .size() solo se aplica a campos Texto o Fecha (' + field + ').');
        }
        const n = Number(right);
        if (!/^-?\d+$/.test(right) || !Number.isSafeInteger(n)) {
          throw new Error(id + ': .size() debe compararse con un entero válido.');
        }
        return { ...base, valor: n };
      }

      const refMatch = /^self\.([a-z][a-z0-9-]*)$/.exec(right);
      if (refMatch) {
        const rightField = fields.get(refMatch[1]);
        if (!rightField || rightField.tipo !== property.tipo) {
          throw new Error(id + ': comparación entre campos requiere que ambos existan y tengan el mismo tipo (' + field + ' y ' + refMatch[1] + ').');
        }
        return { ...base, valor: 'self.' + refMatch[1], campoDerecho: refMatch[1] };
      }

      if (property.tipo === 'Entero') {
        const n = Number(right);
        if (!/^-?\d+$/.test(right) || !Number.isSafeInteger(n)) {
          throw new Error(id + ': el campo Entero ' + field + ' debe compararse con un entero.');
        }
        return { ...base, valor: n };
      }

      if (property.tipo === 'Booleano') {
        if (!['=', '<>'].includes(operator) || !['true', 'false'].includes(right)) {
          throw new Error(id + ': el campo Booleano ' + field + ' solo admite = o <> con true o false.');
        }
        return { ...base, valor: right === 'true' };
      }

      const stringMatch = /^(?:'([^']*)'|"([^"]*)")$/.exec(right);
      if (!stringMatch) {
        throw new Error(id + ': el valor para ' + field + ' (' + property.tipo + ') debe ir entre comillas simples o dobles.');
      }
      const literal = stringMatch[1] ?? stringMatch[2];
      if (property.tipo === 'Seleccion') {
        if (!['=', '<>'].includes(operator)) {
          throw new Error(id + ': el campo Seleccion ' + field + ' solo admite operadores = o <>.');
        }
        if (!property.opciones?.some(opt => opt.id === literal)) {
          throw new Error(id + ': "' + literal + '" no es una opción válida de ' + field + '.');
        }
      }
      if (property.tipo === 'Fecha' && !/^\d{4}-\d{2}-\d{2}$/.test(literal)) {
        throw new Error(id + ': la fecha en ' + field + ' debe tener formato AAAA-MM-DD.');
      }
      return { ...base, valor: literal };
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

  function buildPimAttributes(cim, crud, unicos = []) {
    const systemAttrs = [
      {
        id: 'id',
        nombre: 'Identificador UUID',
        origen: 'sistema',
        tipoDominio: 'UUID',
        tipoEcore: 'EString',
        tipoUml: 'UUID «PK»',
        multiplicidad: '1..1',
        requerido: true,
        unico: true,
        soloLectura: true,
      },
    ];
    if (!crud) {
      systemAttrs.push(
        {
          id: 'estado-actual',
          nombre: 'Estado del caso',
          origen: 'sistema',
          tipoDominio: 'EstadoFlujo',
          tipoEcore: 'EEnum',
          tipoUml: 'Estado' + cim.entidad,
          multiplicidad: '1..1',
          requerido: true,
          unico: false,
          soloLectura: true,
          valoresEnum: cim.estados.map(s => s.id),
        },
        {
          id: 'historial',
          nombre: 'Bitácora de transiciones',
          origen: 'sistema',
          tipoDominio: 'Colección<Evento>',
          tipoEcore: 'EList<EventoFlujo>',
          tipoUml: 'List<EventoFlujo>',
          multiplicidad: '0..*',
          requerido: true,
          unico: false,
          soloLectura: true,
        },
      );
    }
    const domainAttrs = cim.datos.map(field => ({
      id: field.id,
      nombre: field.nombre,
      origen: 'dominio',
      tipoDominio: field.tipo,
      tipoEcore: ecoreTypes[field.tipo],
      tipoUml: field.tipo === 'Seleccion' ? 'Enum<' + field.id + '>' : umlTypes[field.tipo],
      multiplicidad: field.requerido ? '1..1' : '0..1',
      requerido: Boolean(field.requerido),
      unico: unicos.includes(field.id),
      soloLectura: false,
      ...(field.opciones ? { valoresEnum: field.opciones.map(o => o.id) } : {}),
    }));
    return [...systemAttrs, ...domainAttrs];
  }

  function buildPimSignatures(cim, rules, crud, integracion) {
    const invariants = rules.filter(r => r.tipo === 'inv').map(r => r.id);
    if (crud) {
      return [
        {
          id: 'crear',
          nombre: 'Crear ' + cim.entidad,
          visibilidad: 'public',
          actor: null,
          desde: null,
          hasta: null,
          parametros: cim.datos.map(d => d.id + ': ' + ecoreTypes[d.tipo]),
          retorno: cim.entidad,
          guardas: invariants,
          efectos: ['Persiste nueva instancia de ' + cim.entidad, ...(cim.unicos?.length ? ['Verifica unicidad de: ' + cim.unicos.join(', ')] : [])],
        },
        {
          id: 'consultar',
          nombre: 'Consultar catálogo',
          visibilidad: 'public',
          actor: null,
          desde: null,
          hasta: null,
          parametros: ['filtro: EString'],
          retorno: 'EList<' + cim.entidad + '>',
          guardas: [],
          efectos: ['Filtra registros por coincidencia de texto'],
        },
        {
          id: 'editar',
          nombre: 'Actualizar ' + cim.entidad,
          visibilidad: 'public',
          actor: null,
          desde: null,
          hasta: null,
          parametros: ['id: EString', ...cim.datos.map(d => d.id + ': ' + ecoreTypes[d.tipo])],
          retorno: cim.entidad,
          guardas: invariants,
          efectos: ['Actualiza atributos manteniendo identidad UUID'],
        },
        {
          id: 'eliminar',
          nombre: 'Eliminar ' + cim.entidad,
          visibilidad: 'public',
          actor: null,
          desde: null,
          hasta: null,
          parametros: ['id: EString'],
          retorno: 'EBoolean',
          guardas: [],
          efectos: ['Remueve la instancia si no existen referencias activas'],
        },
      ];
    }

    const createSig = {
      id: 'iniciar-caso',
      nombre: cim.inicio.nombre,
      visibilidad: 'public',
      actor: cim.inicio.actor,
      desde: null,
      hasta: cim.inicio.estado,
      parametros: ['actor: Rol', ...cim.datos.map(d => d.id + ': ' + ecoreTypes[d.tipo])],
      retorno: cim.entidad,
      guardas: invariants,
      efectos: ['Inicializa estado en ' + cim.inicio.estado, 'Registra evento de creación en historial'],
    };

    const transitionSigs = cim.transiciones.map(op => {
      const opRules = rules.filter(r => r.operacion === op.id || r.tipo === 'inv').map(r => r.id);
      const mov = integracion?.movimientos.find(m => m.transicion === op.id);
      const efectos = [
        'Cambia estado: ' + op.desde + ' → ' + op.hasta,
        'Anexa evento auditado por rol ' + op.actor,
      ];
      if (mov) {
        efectos.push((mov.tipo === 'salida' ? 'Descuenta ' : 'Repone ') + 'stock en ' + integracion.catalogo.entidad + '.' + integracion.existencias);
      }
      return {
        id: op.id,
        nombre: op.nombre,
        visibilidad: 'public',
        actor: op.actor,
        desde: op.desde,
        hasta: op.hasta,
        parametros: ['idCaso: EString', 'actor: Rol'],
        retorno: 'EBoolean',
        guardas: opRules,
        efectos,
      };
    });

    return [createSig, ...transitionSigs];
  }

  function buildPimRelations(cim, crud, integracion) {
    const relations = [];
    if (!crud) {
      relations.push(
        {
          origen: cim.entidad,
          destino: 'EventoHistorial',
          multiplicidadOrigen: '1..1',
          multiplicidadDestino: '1..*',
          rol: 'historial',
          tipo: 'composicion',
        },
        {
          origen: 'ActorRol',
          destino: cim.entidad,
          multiplicidadOrigen: '1..1',
          multiplicidadDestino: '0..*',
          rol: 'ejecutaTransiciones',
          tipo: 'asociacion',
        },
      );
    }
    if (integracion) {
      relations.push({
        origen: cim.entidad,
        destino: integracion.catalogo.entidad,
        multiplicidadOrigen: '0..*',
        multiplicidadDestino: '1..1',
        rol: integracion.referencia + ' → ' + integracion.clave,
        tipo: 'integracion',
      });
    }
    return relations;
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
    const paquete = 'org.mda.studio.' + cim.id.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    return {
      id: cim.id,
      nombre: cim.nombre,
      objetivo: cim.objetivo,
      entidad: cim.entidad,
      paquete,
      estereotipo: integracion ? '«Entity, IntegratedProcess»' : '«Entity, StatefulProcess»',
      roles: cim.actores,
      propiedades: cim.datos,
      atributos: buildPimAttributes(cim, false),
      creacion: cim.inicio,
      estados: cim.estados,
      operaciones: cim.transiciones,
      firmas: buildPimSignatures(cim, rules, false, integracion),
      relaciones: buildPimRelations(cim, false, integracion),
      restricciones: rules,
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
    const paquete = 'org.mda.studio.' + cim.id.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    return {
      tipo: 'crud',
      id: cim.id,
      nombre: cim.nombre,
      objetivo: cim.objetivo,
      entidad: cim.entidad,
      paquete,
      estereotipo: '«Entity, CrudCatalog»',
      propiedades: cim.datos,
      atributos: buildPimAttributes(cim, true, unicos),
      unicos,
      operaciones: ['crear', 'consultar', 'editar', 'eliminar'],
      firmas: buildPimSignatures(cim, restricciones, true),
      relaciones: buildPimRelations(cim, true),
      restricciones,
    };
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

  function inferHtmlAttributes(field, pim) {
    const attrs = [];
    if (field.requerido) attrs.push('required');
    const control = field.id === pim.integracion?.referencia ? 'select' : controls[field.tipo];
    if (control === 'number') attrs.push('step="1"', 'inputmode="numeric"');
    if (control === 'text') attrs.push('maxlength="300"');
    for (const rule of pim.restricciones) {
      if (rule.tipo !== 'inv') continue;
      for (const term of rule.expresion) {
        if (term.campo !== field.id || term.campoDerecho || (term.conector && term.conector !== 'and')) continue;
        if (term.acceso === 'value' && typeof term.valor === 'number') {
          if (term.operador === '>=') attrs.push('min="' + term.valor + '"');
          if (term.operador === '>') attrs.push('min="' + (term.valor + 1) + '"');
          if (term.operador === '<=') attrs.push('max="' + term.valor + '"');
          if (term.operador === '<') attrs.push('max="' + (term.valor - 1) + '"');
        }
        if (term.acceso === 'size' && typeof term.valor === 'number') {
          if (term.operador === '>=') attrs.push('minlength="' + term.valor + '"');
          if (term.operador === '<=') attrs.push('maxlength="' + term.valor + '"');
        }
      }
    }
    return [...new Set(attrs)];
  }

  function sqlIdent(name) {
    return name.replace(/-/g, '_').toLowerCase();
  }

  function ruleToSqlCheck(rule) {
    const parts = rule.expresion.map((term, idx) => {
      const col = sqlIdent(term.campo);
      const left = term.acceso === 'size' ? 'CHAR_LENGTH(' + col + ')' : col;
      const right = term.campoDerecho
        ? sqlIdent(term.campoDerecho)
        : typeof term.valor === 'string'
          ? "'" + term.valor.replace(/'/g, "''") + "'"
          : typeof term.valor === 'boolean'
            ? (term.valor ? 'TRUE' : 'FALSE')
            : String(term.valor);
      const expr = left + ' ' + term.operador + ' ' + right;
      if (idx === 0) return expr;
      if (term.conector === 'or') return 'OR ' + expr;
      if (term.conector === 'implies') return 'OR (' + expr + ')';
      return 'AND ' + expr;
    });
    if (rule.expresion.some(t => t.conector === 'implies') && rule.expresion.length === 2) {
      const first = parts[0];
      const second = parts[1].replace(/^OR\s+/, '');
      return 'CONSTRAINT chk_' + sqlIdent(rule.id) + ' CHECK (NOT (' + first + ') OR ' + second + ')';
    }
    return 'CONSTRAINT chk_' + sqlIdent(rule.id) + ' CHECK (' + parts.join(' ') + ')';
  }

  function buildSqlSchema(pim) {
    const crud = pim.tipo === 'crud';
    const mainTable = sqlIdent(pim.entidad);
    const tablas = [];

    if (pim.integracion) {
      const catSchema = buildSqlSchema(pim.integracion.catalogo);
      tablas.push(...catSchema.tablas);
    }

    const columnas = [
      { nombre: 'id', tipo: 'VARCHAR(64)', restricciones: 'PRIMARY KEY NOT NULL' },
    ];
    if (!crud) {
      columnas.push({
        nombre: 'estado_actual',
        tipo: 'VARCHAR(48)',
        restricciones: "NOT NULL DEFAULT '" + pim.creacion.estado + "'",
      });
    }
    const unicos = new Set(pim.unicos ?? []);
    for (const field of pim.propiedades) {
      const colConstraints = [];
      if (field.requerido) colConstraints.push('NOT NULL');
      if (unicos.has(field.id)) colConstraints.push('UNIQUE');
      if (pim.integracion && field.id === pim.integracion.referencia) {
        const catTable = sqlIdent(pim.integracion.catalogo.entidad);
        colConstraints.push('REFERENCES ' + catTable + '(id)');
      }
      if (field.tipo === 'Seleccion' && field.opciones?.length) {
        const allowed = field.opciones.map(o => "'" + o.id + "'").join(', ');
        colConstraints.push('CHECK (' + sqlIdent(field.id) + ' IN (' + allowed + '))');
      }
      columnas.push({
        nombre: sqlIdent(field.id),
        tipo: sqlTypes[field.tipo],
        restricciones: colConstraints.length ? colConstraints.join(' ') : 'NULL',
      });
    }

    const checks = pim.restricciones.filter(r => r.tipo === 'inv').map(ruleToSqlCheck);
    if (!crud) {
      const stateList = pim.estados.map(s => "'" + s.id + "'").join(', ');
      checks.unshift('CONSTRAINT chk_' + mainTable + '_estado CHECK (estado_actual IN (' + stateList + '))');
    }

    tablas.push({
      nombre: mainTable,
      descripcion: (crud ? 'Tabla de catálogo CRUD para ' : 'Tabla principal de casos de proceso para ') + pim.entidad,
      columnas,
      checks,
    });

    if (!crud) {
      tablas.push({
        nombre: mainTable + '_historial',
        descripcion: 'Bitácora inmutable de auditoría de transiciones por rol',
        columnas: [
          { nombre: 'id_evento', tipo: 'INTEGER', restricciones: 'PRIMARY KEY AUTOINCREMENT' },
          { nombre: 'caso_id', tipo: 'VARCHAR(64)', restricciones: 'NOT NULL REFERENCES ' + mainTable + '(id) ON DELETE CASCADE' },
          { nombre: 'accion', tipo: 'VARCHAR(120)', restricciones: 'NOT NULL' },
          { nombre: 'rol_actor', tipo: 'VARCHAR(64)', restricciones: 'NOT NULL' },
          { nombre: 'fecha_hora', tipo: 'TIMESTAMP', restricciones: 'NOT NULL DEFAULT CURRENT_TIMESTAMP' },
        ],
        checks: [],
      });
    }

    if (pim.integracion) {
      const catTable = sqlIdent(pim.integracion.catalogo.entidad);
      tablas.push({
        nombre: mainTable + '_movimientos_stock',
        descripcion: 'Kardex de entradas y salidas vinculadas entre ' + pim.entidad + ' y ' + pim.integracion.catalogo.entidad,
        columnas: [
          { nombre: 'id_movimiento', tipo: 'INTEGER', restricciones: 'PRIMARY KEY AUTOINCREMENT' },
          { nombre: 'caso_id', tipo: 'VARCHAR(64)', restricciones: 'NOT NULL REFERENCES ' + mainTable + '(id)' },
          { nombre: 'producto_sku', tipo: 'VARCHAR(120)', restricciones: 'NOT NULL REFERENCES ' + catTable + '(' + sqlIdent(pim.integracion.clave) + ')' },
          { nombre: 'transicion', tipo: 'VARCHAR(64)', restricciones: 'NOT NULL' },
          { nombre: 'unidades', tipo: 'INTEGER', restricciones: 'NOT NULL' },
          { nombre: 'saldo_resultante', tipo: 'INTEGER', restricciones: 'NOT NULL CHECK (saldo_resultante >= 0)' },
          { nombre: 'fecha_hora', tipo: 'TIMESTAMP', restricciones: 'NOT NULL DEFAULT CURRENT_TIMESTAMP' },
        ],
        checks: [],
      });
    }

    return {
      motor: 'SQLite 3',
      tablas,
    };
  }

  function buildPsmArchitecture(pim, presentation) {
    const crud = pim.tipo === 'crud';
    if (crud) {
      return {
        patronUi: 'Data Grid CRUD Tabular (Formulario + Tabla Filtrable)',
        disposicion: 'Formulario de captura multi-columna superior + Tabla de registros con búsqueda instantánea y diálogo de confirmación de borrado.',
        contenedores: [
          'Formulario de Alta/Edición (' + pim.propiedades.length + ' controles)',
          'Barra de búsqueda en tiempo real',
          'Tabla de datos con columnas: ' + pim.propiedades.map(p => p.nombre).join(', ') + ' + Acciones',
          'Gestión de datos y exportación',
        ],
        adaptadorDatos: 'IndexedDB y localStorage en el navegador. Copias JSON y exportación SQL.',
        seguridad: 'Validación de unicidad (' + (pim.unicos.join(', ') || 'sin claves únicas') + ') e invariantes OCL en cliente antes de confirmar transacción',
      };
    }

    const isBoard = presentation === 'tablero';
    const containers = isBoard
      ? [
          'Cabecera con selector de rol de demostración (' + pim.roles.map(r => r.nombre).join(', ') + ')',
          'Tablero Kanban con ' + pim.estados.length + ' carriles de estado: ' + pim.estados.map(s => s.nombre + (s.final ? ' [Final]' : '')).join(' | '),
          'Formulario de creación para rol inicial (' + pim.creacion.actor + ')',
          'Inspector lateral de caso seleccionado + Botonera de transiciones + Historial',
          ...(pim.integracion ? ['Módulo integrado de Catálogo (' + pim.integracion.catalogo.entidad + ') y Kardex de Movimientos'] : []),
          'Gestión de datos y exportación',
        ]
      : [
          'Cabecera con selector de rol de demostración (' + pim.roles.map(r => r.nombre).join(', ') + ')',
          'Columna izquierda: Formulario de captura (' + pim.creacion.nombre + ') + Bandeja vertical de casos con badge de estado',
          'Columna derecha: Inspector maestro-detalle, disparadores de transición y línea de tiempo auditada',
          ...(pim.integracion ? ['Módulo integrado de Catálogo (' + pim.integracion.catalogo.entidad + ') y Kardex de Movimientos'] : []),
          'Gestión de datos y exportación',
        ];

    return {
      patronUi: isBoard ? 'Tablero Kanban por Estado (State-Lane Board)' : 'Bandeja Maestro-Detalle (Master-Detail Inbox)',
      disposicion: isBoard
        ? 'Grid horizontal de carriles agrupados por cada estado de la máquina de estados (' + pim.estados.length + ' columnas) + panel de formulario e inspector.'
        : 'Layout de dos columnas 50/50: captura y lista cronológica a la izquierda; ficha técnica, acciones por rol e historial a la derecha.',
      contenedores: containers,
      adaptadorDatos: 'IndexedDB y localStorage en el navegador. Copias JSON y exportación SQL.',
      seguridad: 'Simulación de roles en cliente para ' + pim.roles.length + ' actores y ' + pim.restricciones.length + ' validadores OCL compilados a ES2022',
    };
  }

  function toPsm(pim, projectId, presentation) {
    const storageScope = projectId ? 'proyecto.' + projectId + '.' + pim.id : pim.id;
    const metadata = {
      id: pim.id,
      nombre: pim.nombre,
      objetivo: pim.objetivo,
      entidad: pim.entidad,
      plataforma: 'HTML5 / JavaScript ES2022 / IndexedDB + File System Access API + SQL DDL',
    };
    const campos = pim.propiedades.map(field => ({
      id: field.id,
      nombre: field.nombre,
      control: field.id === pim.integracion?.referencia ? 'select' : controls[field.tipo],
      tipoSql: sqlTypes[field.tipo],
      requerido: field.requerido ?? false,
      atributosHtml: inferHtmlAttributes(field, pim),
      ...(field.opciones ? { opciones: field.opciones } : {}),
    }));
    const crud = pim.tipo === 'crud';
    const effectivePresentation = crud ? 'tabla' : presentation;
    const almacen = { tipo: 'IndexedDB + localStorage', clave: (crud ? 'mda.registros.' : 'mda.casos.') + storageScope };
    const arquitectura = buildPsmArchitecture(pim, effectivePresentation);
    const esquemaSql = buildSqlSchema(pim);

    if (crud) {
      return {
        ...metadata,
        tipo: 'crud',
        presentacion: 'tabla',
        arquitectura,
        almacen,
        esquemaSql,
        campos,
        unicos: pim.unicos,
        acciones: pim.operaciones,
        validadores: pim.restricciones,
      };
    }
    return {
      ...metadata,
      presentacion: effectivePresentation,
      arquitectura,
      almacen,
      esquemaSql,
      roles: pim.roles,
      campos,
      formulario: pim.creacion,
      estados: pim.estados,
      acciones: pim.operaciones,
      validadores: pim.restricciones,
      ...(pim.integracion ? { integracion: { ...pim.integracion, catalogo: toPsm(pim.integracion.catalogo, projectId, 'tabla') } } : {}),
    };
  }

  function jsLiteral(value) {
    return JSON.stringify(value).replace(/</g, '\\u003c');
  }

  function emitValidator(rule) {
    const operators = { '=': '===', '<>': '!==' };
    const clauses = rule.expresion.map(term => {
      const field = 'values[' + jsLiteral(term.campo) + ']';
      const left = term.acceso === 'size' ? 'Array.from(String(' + field + ' ?? "")).length' : field;
      const operator = operators[term.operador] ?? term.operador;
      const right = term.campoDerecho
        ? 'values[' + jsLiteral(term.campoDerecho) + ']'
        : jsLiteral(term.valor);
      const rightNullCheck = term.campoDerecho ? ' && values[' + jsLiteral(term.campoDerecho) + '] != null' : '';
      const expr = '(' + field + ' != null' + rightNullCheck + ' && ' + left + ' ' + operator + ' ' + right + ')';
      return { connector: term.conector ?? 'and', expr };
    });

    let body = clauses[0]?.expr ?? 'true';
    for (let i = 1; i < clauses.length; i++) {
      const { connector, expr } = clauses[i];
      if (connector === 'or') body = '(' + body + ' || ' + expr + ')';
      else if (connector === 'implies') body = '(!(' + body + ') || ' + expr + ')';
      else body = '(' + body + ' && ' + expr + ')';
    }
    return jsLiteral(rule.id) + ': (values) => ' + body;
  }

  function instantiate(template, replacements) {
    return template.replace(/\{\{([A-Z]+)\}\}/g, (_, name) => {
      if (!Object.hasOwn(replacements, name)) throw new Error('Variable de plantilla desconocida: ' + name);
      return replacements[name];
    });
  }

  function xmlEscape(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function generateMermaid(cim) {
    if (cim.tipo === 'crud') {
      const lines = [
        'classDiagram',
        '  class ' + cim.entidad + ' {',
        '    <<CRUD Catalog>>',
      ];
      for (const f of cim.datos) {
        const unique = cim.unicos?.includes(f.id) ? ' [UNIQUE]' : '';
        const req = f.requerido ? ' [1..1]' : ' [0..1]';
        lines.push('    +' + f.tipo + ' ' + f.id + req + unique);
      }
      lines.push('    +crear() ' + cim.entidad);
      lines.push('    +consultar(filtro) List~' + cim.entidad + '~');
      lines.push('    +editar(id) ' + cim.entidad);
      lines.push('    +eliminar(id) Boolean');
      lines.push('  }');
      return lines.join('\n') + '\n';
    }

    const actors = new Map(cim.actores.map(a => [a.id, a.nombre]));
    const lines = [
      'stateDiagram-v2',
      '  direction LR',
      '  [*] --> ' + cim.inicio.estado + ' : ' + cim.inicio.nombre + ' (' + (actors.get(cim.inicio.actor) ?? cim.inicio.actor) + ')',
    ];
    for (const state of cim.estados) {
      lines.push('  state "' + state.nombre.replace(/"/g, "'") + '" as ' + state.id);
    }
    for (const tr of cim.transiciones) {
      const actor = actors.get(tr.actor) ?? tr.actor;
      lines.push('  ' + tr.desde + ' --> ' + tr.hasta + ' : ' + tr.nombre + ' [' + actor + ']');
    }
    for (const state of cim.estados.filter(s => s.final)) {
      lines.push('  ' + state.id + ' --> [*]');
    }
    return lines.join('\n') + '\n';
  }

  function generateEcore(pim) {
    const ecoreMap = {
      EString: 'ecore:EDataType http://www.eclipse.org/emf/2002/Ecore#//EString',
      EInt: 'ecore:EDataType http://www.eclipse.org/emf/2002/Ecore#//EInt',
      EDate: 'ecore:EDataType http://www.eclipse.org/emf/2002/Ecore#//EDate',
      EBoolean: 'ecore:EDataType http://www.eclipse.org/emf/2002/Ecore#//EBoolean',
    };
    const nsPrefix = pim.id.replace(/[^a-zA-Z0-9_]/g, '_');
    const lines = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<ecore:EPackage xmi:version="2.0"',
      '    xmlns:xmi="http://www.omg.org/XMI"',
      '    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"',
      '    xmlns:ecore="http://www.eclipse.org/emf/2002/Ecore"',
      '    name="' + xmlEscape(nsPrefix) + '"',
      '    nsURI="http://mda.studio/models/' + xmlEscape(pim.id) + '/1.0"',
      '    nsPrefix="' + xmlEscape(nsPrefix) + '">',
    ];

    function appendEntityClass(entityPim) {
      const invariantNames = entityPim.restricciones.map(r => r.id).join(' ');
      lines.push('  <eClassifiers xsi:type="ecore:EClass" name="' + xmlEscape(entityPim.entidad) + '">');
      if (entityPim.restricciones.length) {
        lines.push('    <eAnnotations source="http://www.eclipse.org/emf/2002/Ecore">');
        lines.push('      <details key="constraints" value="' + xmlEscape(invariantNames) + '"/>');
        lines.push('    </eAnnotations>');
        lines.push('    <eAnnotations source="http://www.eclipse.org/emf/2002/Ecore/OCL/Pivot">');
        for (const rule of entityPim.restricciones) {
          lines.push('      <details key="' + xmlEscape(rule.id) + '" value="' + xmlEscape(rule.fuente) + '"/>');
        }
        lines.push('    </eAnnotations>');
      }
      for (const attr of entityPim.atributos) {
        if (attr.tipoEcore === 'EList<EventoFlujo>') continue;
        const eType = attr.tipoEcore === 'EEnum'
          ? '#//' + xmlEscape(entityPim.entidad + '_' + attr.id)
          : ecoreMap[attr.tipoEcore] ?? ecoreMap.EString;
        const lower = attr.requerido ? '1' : '0';
        lines.push(
          '    <eStructuralFeatures xsi:type="ecore:EAttribute" name="' + xmlEscape(attr.id) + '"' +
          ' lowerBound="' + lower + '" upperBound="1"' +
          (attr.id === 'id' ? ' iD="true"' : '') +
          ' eType="' + eType + '"/>',
        );
      }
      if (entityPim.integracion) {
        lines.push(
          '    <eStructuralFeatures xsi:type="ecore:EReference" name="' + xmlEscape(entityPim.integracion.referencia + 'Ref') + '"' +
          ' lowerBound="1" upperBound="1" eType="#//' + xmlEscape(entityPim.integracion.catalogo.entidad) + '"/>',
        );
      }
      for (const sig of entityPim.firmas) {
        lines.push('    <eOperations name="' + xmlEscape(sig.id) + '" eType="ecore:EDataType http://www.eclipse.org/emf/2002/Ecore#//EBoolean">');
        if (sig.guardas.length) {
          lines.push('      <eAnnotations source="http://www.eclipse.org/emf/2002/Ecore/OCL/Pivot">');
          lines.push('        <details key="guards" value="' + xmlEscape(sig.guardas.join(', ')) + '"/>');
          lines.push('      </eAnnotations>');
        }
        lines.push('    </eOperations>');
      }
      lines.push('  </eClassifiers>');

      for (const attr of entityPim.atributos.filter(a => a.tipoEcore === 'EEnum' && a.valoresEnum?.length)) {
        lines.push('  <eClassifiers xsi:type="ecore:EEnum" name="' + xmlEscape(entityPim.entidad + '_' + attr.id) + '">');
        attr.valoresEnum.forEach((val, idx) => {
          lines.push('    <eLiterals name="' + xmlEscape(val) + '" value="' + idx + '" literal="' + xmlEscape(val) + '"/>');
        });
        lines.push('  </eClassifiers>');
      }
    }

    appendEntityClass(pim);
    if (pim.integracion) appendEntityClass(pim.integracion.catalogo);
    lines.push('</ecore:EPackage>');
    return lines.join('\n') + '\n';
  }

  function generateOclFile(pim) {
    const lines = [
      '-- Especificación OCL 2.4 generada por MDA Studio',
      '-- Modelo PIM: ' + pim.nombre + ' (' + pim.paquete + ')',
      'package ' + pim.paquete.replace(/\./g, '::'),
      '',
    ];
    if (pim.restricciones.length) {
      for (const rule of pim.restricciones) {
        lines.push('  ' + rule.fuente);
      }
    } else {
      lines.push('  -- Sin restricciones OCL declaradas en ' + pim.entidad);
    }
    if (pim.integracion?.catalogo.restricciones.length) {
      lines.push('');
      lines.push('  -- Restricciones del catálogo integrado (' + pim.integracion.catalogo.entidad + ')');
      for (const rule of pim.integracion.catalogo.restricciones) {
        lines.push('  ' + rule.fuente);
      }
    }
    lines.push('', 'endpackage', '');
    return lines.join('\n');
  }

  function generateSqlDdl(psm) {
    const lines = [
      '-- Esquema Relacional SQL (PSM) generado automáticamente por MDA Studio',
      '-- Aplicación: ' + psm.nombre + ' (' + psm.id + ')',
      '-- Plataforma destino: ' + psm.plataforma,
      '',
    ];
    for (const tabla of psm.esquemaSql.tablas) {
      lines.push('-- ' + tabla.descripcion);
      lines.push('CREATE TABLE IF NOT EXISTS ' + tabla.nombre + ' (');
      const entries = [
        ...tabla.columnas.map(c => '  ' + c.nombre + ' ' + c.tipo + (c.restricciones ? ' ' + c.restricciones : '')),
        ...tabla.checks.map(chk => '  ' + chk),
      ];
      lines.push(entries.join(',\n'));
      lines.push(');', '');
    }
    return lines.join('\n');
  }

  function generateJsonSchema(psm) {
    const properties = {};
    const required = [];
    for (const field of psm.campos) {
      if (field.requerido) required.push(field.id);
      const prop = { title: field.nombre };
      if (field.control === 'number') prop.type = 'integer';
      else if (field.control === 'checkbox') prop.type = 'boolean';
      else prop.type = 'string';
      if (field.control === 'date') prop.format = 'date';
      if (field.opciones?.length) prop.enum = field.opciones.map(o => o.id);
      for (const attr of field.atributosHtml) {
        const m = /^(min|max|minlength|maxlength)="(-?\d+)"$/.exec(attr);
        if (!m) continue;
        const val = Number(m[2]);
        if (m[1] === 'min') prop.minimum = val;
        if (m[1] === 'max') prop.maximum = val;
        if (m[1] === 'minlength') prop.minLength = val;
        if (m[1] === 'maxlength') prop.maxLength = val;
      }
      properties[field.id] = prop;
    }
    return JSON.stringify({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: 'https://mda.studio/schemas/' + psm.id + '.schema.json',
      title: psm.entidad,
      description: psm.objetivo,
      type: 'object',
      required,
      properties,
      additionalProperties: false,
    }, null, 2) + '\n';
  }

  function generateTraceCsv(trace) {
    const escapeCsv = val => '"' + String(val ?? '').replace(/"/g, '""') + '"';
    const rows = [
      ['CIM (Negocio)', 'PIM (Lógico / Ecore)', 'PSM (Plataforma Web / SQL)', 'Aplicación (M2T)'].map(escapeCsv).join(','),
      ...trace.map(r => [r.cim, r.pim, r.psm, r.app].map(escapeCsv).join(',')),
    ];
    return rows.join('\n') + '\n';
  }

  function generateApp(psm, assets, sqlDdl, initialData) {
    const catalogValidators = psm.integracion?.catalogo.validadores.map(emitValidator).join(',\n  ') ?? '';
    return instantiate(assets.html, {
      CSS: assets.css,
      SCRIPT: 'const model = ' + jsLiteral(psm) + ';\n'
        + 'const sqlSchemaDdl = ' + jsLiteral(sqlDdl) + ';\n'
        + 'const validators = {\n  ' + psm.validadores.map(emitValidator).join(',\n  ') + '\n};\n'
        + 'const catalogValidators = {' + catalogValidators + '};\n'
        + '(' + application.toString() + ')(model, validators, catalogValidators, sqlSchemaDdl, ' + jsLiteral(initialData ?? null) + ');',
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
        cim: 'datos.' + field.id + ' (' + field.tipo + ')',
        pim: cim.entidad + '.' + field.id + ' : ' + ecoreTypes[field.tipo] + (field.requerido ? ' [1..1]' : ' [0..1]'),
        psm: 'campos.' + field.id + ' (' + (field.id === pim.integracion?.referencia ? 'select' : controls[field.tipo]) + ' / ' + sqlTypes[field.tipo] + ')',
        app: field.id === pim.integracion?.referencia ? 'Selector de inventario + FK SQL' :
          controls[field.tipo] === 'select' ? '<select> + CHECK SQL' : '<input type="' + controls[field.tipo] + '">',
      })),
      ...pim.operaciones.map(operation => crud ? {
        cim: 'tipo.crud',
        pim: cim.entidad + '::' + operation + '()',
        psm: 'acciones.' + operation + ' + SQL ' + operation.toUpperCase(),
        app: 'Operación CRUD: ' + operation,
      } : ({
        cim: 'transiciones.' + operation.id + ' (' + operation.actor + ')',
        pim: cim.entidad + '::' + operation.id + '() : EBoolean',
        psm: 'acciones.' + operation.id + ' [' + operation.desde + ' → ' + operation.hasta + ']',
        app: 'Botón de rol ' + operation.actor + ' (' + operation.desde + ' → ' + operation.hasta + ')',
      })),
      ...(crud ? pim.unicos.map(id => ({
        cim: 'unicos.' + id,
        pim: cim.entidad + '.' + id + ' {unique}',
        psm: 'unicos.' + id + ' + SQL UNIQUE',
        app: 'Índice único en BD y validador de alta/edición',
      })) : []),
      ...pim.restricciones.map(rule => ({
        cim: 'ocl.' + rule.id,
        pim: rule.tipo + ' ' + rule.id + ' (OCL AST)',
        psm: 'validadores.' + rule.id + (rule.tipo === 'inv' ? ' + SQL CHECK' : ''),
        app: 'validators[' + JSON.stringify(rule.id) + ']',
      })),
    ];
    if (pim.integracion) {
      const link = pim.integracion;
      for (const field of link.catalogo.propiedades) trace.push({
        cim: 'integracion.catalogo.datos.' + field.id,
        pim: link.catalogo.entidad + '.' + field.id + ' : ' + ecoreTypes[field.tipo],
        psm: 'integracion.catalogo.campos.' + field.id + ' (' + sqlTypes[field.tipo] + ')',
        app: 'Inventario · ' + field.nombre,
      });
      trace.push({
        cim: 'integracion.referencia',
        pim: cim.entidad + '.' + link.referencia + ' (0..*) → (1..1) ' + link.catalogo.entidad + '.' + link.clave,
        psm: 'FOREIGN KEY (' + sqlIdent(link.referencia) + ') REFERENCES ' + sqlIdent(link.catalogo.entidad),
        app: 'Selector de inventario compartido + Integridad referencial',
      });
      for (const movement of link.movimientos) trace.push({
        cim: 'integracion.movimientos.' + movement.transicion,
        pim: cim.entidad + '::' + movement.transicion + '() efecto=' + movement.tipo,
        psm: 'integracion.movimientos.' + movement.transicion + ' + Kardex SQL',
        app: movement.tipo === 'salida' ? 'Descontar existencias y registrar kardex' : 'Reponer existencias y registrar kardex',
      });
    }
    const psmSql = generateSqlDdl(psm);
    const entregables = {
      cimMermaid: generateMermaid(cim),
      pimEcore: generateEcore(pim),
      pimOcl: generateOclFile(pim),
      psmSql,
      psmSchema: generateJsonSchema(psm),
      traceCsv: generateTraceCsv(trace),
    };
    return { cim, pim, psm, trace, entregables, html: generateApp(psm, assets, psmSql, initialData) };
  }

  function validateCim(cim) {
    return cim.tipo === 'crud' ? toCrudPim(cim) : toPim(cim);
  }
  return Object.assign(compile, { readCim, validateCim });
}

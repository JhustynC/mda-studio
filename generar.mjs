import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { createCompiler } from './src/compiler.mjs';
import { application } from './src/runtime.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const read = name => readFile(join(here, name), 'utf8');
const toJson = value => JSON.stringify(value, null, 2) + '\n';
const inline = value => JSON.stringify(value).replace(/</g, '\\u003c');

async function main() {
  const [modelPath, outputPath, ...extra] = process.argv.slice(2);
  if (extra.length) throw new Error('Uso: node generar.mjs [modelo.cim.json] [directorio de salida]');
  const output = outputPath ? resolve(outputPath) : join(here, 'generado');
  const [source, example, advanced, stock, lab, metamodel, html, css, studioHtml, studioCss, studioJs, diagramCss, themeCss, editor] = await Promise.all([
    modelPath ? readFile(resolve(modelPath), 'utf8') : read('models/prestamos.cim.json'),
    read('models/prestamos.cim.json'),
    read('models/compras.cim.json'),
    read('models/inventario.cim.json'),
    read('models/laboratorio.cim.json'),
    read('models/metamodelo.json').then(JSON.parse),
    read('src/generated.html'), read('src/generated.css'),
    read('src/studio.html'), read('src/studio.css'), read('src/studio.js'),
    read('src/diagram.css'), read('src/theme.css'),
    build({
      entryPoints: [join(here, 'src/json-editor.mjs')],
      bundle: true, minify: true, format: 'iife', globalName: 'MdaJsonEditor',
      target: 'es2022', supported: { 'inline-script': false },
      write: false, metafile: true, absWorkingDir: here,
    }),
  ]);
  const templates = { html, css };
  const compile = createCompiler(metamodel, application);
  const demo = compile(source, templates);
  const purchases = compile(advanced, templates, 'example-compras', 'tablero');
  const inventory = compile(stock, templates, 'example-inventario');
  const laboratory = compile(lab, templates, 'example-laboratorio');
  const script = [
    editor.outputFiles[0].text,
    'const TEMPLATES = ' + inline(templates) + ';',
    'const DEMO = ' + inline(source.trim()) + ';',
    'const EXAMPLE = ' + inline(example.trim()) + ';',
    'const ADVANCED = ' + inline(advanced.trim()) + ';',
    'const INVENTORY = ' + inline(stock.trim()) + ';',
    'const LABORATORY = ' + inline(lab.trim()) + ';',
    'const METAMODEL = ' + inline(metamodel) + ';',
    'const compile = (' + createCompiler.toString() + ')(METAMODEL, ' + application.toString() + ');',
    studioJs,
  ].join('\n');
  const packagePaths = new Set(Object.keys(editor.metafile.inputs).flatMap(path => {
    const match = /^(node_modules\/(?:@[^/]+\/)?[^/]+)\//.exec(path);
    return match ? [match[1]] : [];
  }));
  const notices = await Promise.all([...packagePaths].sort().map(async path =>
    path.slice('node_modules/'.length) + '\n' + await read(path + '/LICENSE')));
  const licenseComment = '<!-- Licencias del editor\n' + notices.join('\n\n').replace(/-->/g, '-- >') + '\n-->';
  const studio = studioHtml.replace(/\{\{(CSS|SCRIPT)\}\}/g, (_, key) => key === 'CSS' ? studioCss + '\n' + diagramCss + '\n' + themeCss : script) + licenseComment;
  await mkdir(output, { recursive: true });
  const files = { 'index.html': studio };
  for (const result of [purchases, inventory, laboratory, demo]) {
    const id = result.cim.id;
    const stem = /^(index|con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(id) ? 'proceso-' + id : id;
    files[stem + '.pim.json'] = toJson(result.pim);
    files[stem + '.psm.json'] = toJson(result.psm);
    files[stem + '.traza.json'] = toJson(result.trace);
    files[stem + '.html'] = result.html;
  }
  await Promise.all(Object.entries(files).map(([name, contents]) => writeFile(join(output, name), contents)));
  console.log('CIM → PIM → PSM → aplicación completado.');
  for (const name of Object.keys(files)) console.log(join(output, name));
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});


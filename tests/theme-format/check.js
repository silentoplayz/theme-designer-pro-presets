#!/usr/bin/env node

/**
 * Keeps the theme format's four copies in step
 *
 * The format is written down in schemas/theme-format.md and
 * schemas/theme.schema.json, and built into the designer (the event function)
 * and the Studio (docs/assets/studio.js). This reads the field lists,
 * defaults and limits out of all four and fails on any difference, so a field
 * added to one is added to the others in the same change.
 *
 * What a file goes through on its way between the Studio and the designer is
 * tested end to end in tests/event-function/e2e.js.
 *
 * Usage:
 *   node tests/theme-format/check.js
 */

const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');
const addFormats = require('ajv-formats');

const ROOT = path.join(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const DESIGNER = read('event-function/theme_designer_pro_event.py');
const STUDIO = read('docs/assets/studio.js');
const SPEC = read('schemas/theme-format.md');
const SCHEMA = JSON.parse(read('schemas/theme.schema.json'));
const MODE = SCHEMA.$defs.themeMode.properties;
const MODES = ['dark', 'light', 'oled', 'her'];

let failures = 0;
function fail(msg) {
  console.error(`  ✗ ${msg}`);
  failures++;
}

// An object literal assigned in a source file, such as `const X = { ... };`
function literal(source, name, file) {
  const at = source.search(new RegExp(`(const|let|var)\\s+${name}\\s*=\\s*\\{`));
  if (at < 0) throw new Error(`${name} not found in ${file}`);
  const start = source.indexOf('{', at);
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return new Function(`return (${source.slice(start, i + 1)});`)();
  }
  throw new Error(`${name} never closes in ${file}`);
}

// A schema property with its $ref followed, keeping the property's own keys
function prop(p) {
  if (!p || !p.$ref) return p;
  return { ...SCHEMA.$defs[p.$ref.replace('#/$defs/', '')], ...p };
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sorted = (keys) => [...keys].sort();
const missing = (from, to) => [...from].filter((k) => !to.has(k));

function sameKeys(label, a, b, nameA, nameB) {
  const A = new Set(a), B = new Set(b);
  const onlyA = missing(A, B), onlyB = missing(B, A);
  if (onlyA.length) fail(`${label}: in ${nameA} but not ${nameB}: ${onlyA.join(', ')}`);
  if (onlyB.length) fail(`${label}: in ${nameB} but not ${nameA}: ${onlyB.join(', ')}`);
}

console.log('Checking the theme format...');

// ── The mode's fields and their defaults ──

const designerDefaults = literal(DESIGNER, 'DEFAULT_MODE_DATA', 'the designer');
const studioDefaults = literal(STUDIO, 'DEFAULT_MODE', 'the Studio');
const schemaFields = Object.keys(MODE);

sameKeys('mode fields', Object.keys(designerDefaults), schemaFields, 'the designer', 'the schema');
sameKeys('mode fields', Object.keys(studioDefaults), schemaFields, 'the Studio', 'the schema');

schemaFields.forEach((k) => {
  const p = prop(MODE[k]);
  if (!('default' in p)) return fail(`${k} has no default in the schema`);
  if (k in designerDefaults && !same(designerDefaults[k], p.default)) {
    fail(`${k} defaults to ${JSON.stringify(designerDefaults[k])} in the designer, ${JSON.stringify(p.default)} in the schema`);
  }
  if (k in studioDefaults && !same(studioDefaults[k], p.default)) {
    fail(`${k} defaults to ${JSON.stringify(studioDefaults[k])} in the Studio, ${JSON.stringify(p.default)} in the schema`);
  }
});

// ── The limits the designer holds values to on import ──

const bounds = literal(DESIGNER, '_MODE_NUM_BOUNDS', 'the designer');
Object.entries(bounds).forEach(([k, [lo, hi]]) => {
  const p = prop(MODE[k]);
  if (!p) return;
  if (p.minimum !== lo || p.maximum !== hi) {
    fail(`${k} is held to ${lo}–${hi} by the designer, ${p.minimum}–${p.maximum} by the schema`);
  }
});
schemaFields.filter((k) => prop(MODE[k]).type === 'number' && !(k in bounds) && !prop(MODE[k]).$ref)
  .forEach((k) => fail(`${k} is a number with no limits in the designer`));

const enums = literal(DESIGNER, '_MODE_ENUMS', 'the designer');
Object.entries(enums).forEach(([k, values]) => {
  if (MODE[k] && !same(sorted(values), sorted(MODE[k].enum || []))) {
    fail(`${k} takes ${values.join(', ')} in the designer, ${(MODE[k].enum || []).join(', ')} in the schema`);
  }
});

// The switches the designer reads as true or false
const switches = /\[\s*('paletteEnabled'[\s\S]*?)\]\s*\.forEach\(k => \{ if \(d\[k\] !== undefined\) d\[k\] = !!d\[k\]/.exec(DESIGNER);
if (!switches) fail('the designer\'s list of switches wasn\'t found');
else {
  const designerSwitches = switches[1].match(/'(\w+)'/g).map((s) => s.slice(1, -1));
  const schemaSwitches = schemaFields.filter((k) => [].concat(MODE[k].type).includes('boolean'));
  sameKeys('switches', designerSwitches, schemaSwitches, 'the designer', 'the schema');
}

// ── The file's own fields ──

const exporter = /window\.exportSnapshot = [\s\S]*?const data = \{([\s\S]*?)\};/.exec(DESIGNER);
if (!exporter) fail('the designer\'s theme export wasn\'t found');
else {
  const exported = [...exporter[1].matchAll(/^\s*(\w+):/gm)].map((m) => m[1]);
  sameKeys('theme fields', exported, Object.keys(SCHEMA.properties), 'the designer\'s export', 'the schema');
}

// ── The written spec ──

const specVersion = /^# Theme format (\d+\.\d+)/m.exec(SPEC);
const schemaVersion = /Theme format (\d+\.\d+)/.exec(SCHEMA.$comment || '');
if (!specVersion || !schemaVersion || specVersion[1] !== schemaVersion[1]) {
  fail(`the spec is version ${specVersion && specVersion[1]}, the schema says ${schemaVersion && schemaVersion[1]}`);
}
[...Object.keys(SCHEMA.properties), ...schemaFields].forEach((k) => {
  if (!SPEC.includes('`' + k + '`')) fail(`the spec doesn't describe ${k}`);
});

// ── The fixtures the end-to-end test sends through ──

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const valid = ajv.compile(SCHEMA);
const fixtures = path.join(__dirname, 'fixtures');
fs.readdirSync(fixtures).filter((f) => f.endsWith('.json')).forEach((f) => {
  const theme = JSON.parse(fs.readFileSync(path.join(fixtures, f), 'utf8'));
  if (!valid(theme)) fail(`fixtures/${f} doesn't match the schema: ${ajv.errorsText(valid.errors)}`);
});
// Every field in every mode, and away from its default in at least one, so
// the test notices any field a reader drops or resets
const every = JSON.parse(fs.readFileSync(path.join(fixtures, 'every-field.json'), 'utf8'));
schemaFields.forEach((k) => {
  const left = MODES.filter((m) => !every[m] || !(k in every[m]));
  if (left.length) fail(`fixtures/every-field.json leaves ${k} out of ${left.join(', ')}`);
  else if (MODES.every((m) => same(every[m][k], prop(MODE[k]).default))) fail(`fixtures/every-field.json leaves ${k} at its default in every mode`);
});

console.log(failures ? `\n${failures} problems` : '✅ The spec, the schema, the designer and the Studio agree');
process.exit(failures ? 1 : 0);

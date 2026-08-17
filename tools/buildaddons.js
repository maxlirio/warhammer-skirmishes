/* The same problem as three.js itself, one layer down: GLTFLoader is an ES
   module that imports from 'three', and a module cannot be loaded from a
   `file://` page. This flattens the loader and the one utility it depends on
   into a single classic script that takes what it needs off window.THREE.

   Mechanical and checked: it finds each file's `import { … } from 'three'`
   block, turns it into a destructure, drops the cross-import, strips the
   `export` keywords, and refuses if a file imports anything it does not know
   how to rewrite.

   Run:  node tools/buildaddons.js                                          */

const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'game', 'vendor');
const read = f => fs.readFileSync(path.join(dir, f), 'utf8');

const names = new Set();

/* Pull `import { A, B as C } from 'three';` out of a file, remembering the
   names so they can be destructured off THREE once at the top. */
function stripThreeImport(src, file) {
  const re = /import\s*\{([\s\S]*?)\}\s*from\s*['"]three['"];?/g;
  let found = 0;
  const out = src.replace(re, function (_, inner) {
    found++;
    inner.split(',').map(s => s.trim()).filter(Boolean).forEach(function (n) {
      if (/\s+as\s+/.test(n)) {
        console.error(file + ': renamed import "' + n + '" is not handled');
        process.exit(1);
      }
      names.add(n);
    });
    return '';
  });
  if (!found) { console.error(file + ': no import from three — has the layout changed?'); process.exit(1); }
  return out;
}

/* Anything still importing after that is something this tool has not been
   taught about, and guessing would produce a subtly broken file. */
function assertNoImportsLeft(src, file, allowed) {
  const re = /^\s*import\s.*$/gm;
  const left = (src.match(re) || []).filter(l => !allowed.some(a => l.includes(a)));
  if (left.length) {
    console.error(file + ': unhandled import — ' + left[0].trim());
    process.exit(1);
  }
}

let utils = read('BufferGeometryUtils.module.js');
utils = stripThreeImport(utils, 'BufferGeometryUtils');
assertNoImportsLeft(utils, 'BufferGeometryUtils', []);
utils = utils.replace(/^\s*export\s+(function|const|class|let)\s/gm, '$1 ');
utils = utils.replace(/^\s*export\s*\{[\s\S]*?\};?\s*$/gm, '');

let gltf = read('GLTFLoader.module.js');
gltf = stripThreeImport(gltf, 'GLTFLoader');
gltf = gltf.replace(/import\s*\{[^}]*\}\s*from\s*['"][^'"]*BufferGeometryUtils\.js['"];?/g, '');
assertNoImportsLeft(gltf, 'GLTFLoader', []);
gltf = gltf.replace(/^\s*export\s*\{\s*GLTFLoader\s*\};?\s*$/gm, '');

const list = Array.from(names).sort();
const out =
  '/* three.js GLTFLoader + BufferGeometryUtils (MIT), flattened into a classic\n' +
  '   script by tools/buildaddons.js so they can be loaded from file://.\n' +
  '   Do not edit — edit the .module.js sources and re-run the tool. */\n' +
  '(function () {\n' +
  '  const {\n    ' + list.join(',\n    ') + '\n  } = window.THREE;\n\n' +
  utils + '\n' + gltf + '\n' +
  '  window.GLTFLoader = GLTFLoader;\n})();\n';

fs.writeFileSync(path.join(dir, 'gltfloader.global.js'), out);
console.log('wrote game/vendor/gltfloader.global.js — ' + list.length +
            ' names off THREE, ' + (out.length / 1024).toFixed(0) + ' KB');

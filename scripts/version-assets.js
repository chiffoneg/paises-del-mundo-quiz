// Agrega ?v=<huella del contenido> a los .css y .js que carga index.html.
// Así, cuando un archivo cambia, el navegador no usa la versión vieja guardada en caché
// (GitHub Pages guarda los archivos 10 minutos).
// Uso: node scripts/version-assets.js   (correrlo antes de cada commit)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.join(__dirname, '..');
const indexPath = path.join(root, 'index.html');
let html = fs.readFileSync(indexPath, 'utf8');

html = html.replace(/(href|src)="((?:css|js|data)\/[^"?]+)(\?v=[^"]*)?"/g, (all, attr, file) => {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) return all;
  const hash = crypto.createHash('md5').update(fs.readFileSync(full)).digest('hex').slice(0, 8);
  return `${attr}="${file}?v=${hash}"`;
});

fs.writeFileSync(indexPath, html);
console.log('index.html actualizado:');
(html.match(/(?:href|src)="(?:css|js|data)\/[^"]+"/g) || []).forEach(s => console.log('  ' + s));

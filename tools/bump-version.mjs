// Stamps a new version into public/version.json and public/js/version.js.
// Run before committing a change: npm run bump
import { writeFileSync } from 'fs';
const d = new Date();
const v = d.toISOString().slice(0, 16).replace(/[-:T]/g, '').replace(/^(\d{8})(\d{4})$/, '$1.$2');
writeFileSync(new URL('../public/version.json', import.meta.url), JSON.stringify({ version: v }) + '\n');
writeFileSync(new URL('../public/js/version.js', import.meta.url), `// Set by tools/bump-version.mjs\nexport const APP_VERSION = '${v}';\n`);
console.log('version', v);

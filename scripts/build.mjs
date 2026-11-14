import {cp, mkdir, rm} from 'node:fs/promises';
// Explicit allowlist prevents serving backend Worker source, secrets, docs or tests.
await rm('dist',{recursive:true,force:true});
await mkdir('dist/src',{recursive:true});
for(const item of ['index.html','styles.css','favicon.svg','src/app.mjs','src/engine.mjs'])await cp(item,`dist/${item}`);
console.log('Public-only static assets prepared in dist/.');
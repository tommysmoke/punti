// Unisce la funzione cross-cascade-tick e il modulo condiviso in un solo file da incollare nell'editor della Dashboard Supabase.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const functionSource = readFileSync('supabase/functions/cross-cascade-tick/index.ts', 'utf8')
const sharedSource = readFileSync('supabase/functions/_shared/crossCascade.ts', 'utf8')

const sharedImport = /import \{[^}]*\} from '\.\.\/_shared\/crossCascade\.ts'\r?\n/
const clientImport = /\/\/ @ts-ignore[^\n]*\r?\nimport \{ createClient \} from '[^']+'\r?\n/

const clientImportLines = functionSource.match(clientImport)
if (!sharedImport.test(functionSource) || !clientImportLines) {
  throw new Error('Struttura degli import di cross-cascade-tick/index.ts non riconosciuta')
}

const functionBody = functionSource.replace(clientImport, '').replace(sharedImport, '')
const sharedBody = sharedSource.replace(/^export /gm, '')

const output = [
  '// GENERATO da scripts/build-dashboard-function.mjs (npm run build:dashboard-function): non modificare a mano.',
  clientImportLines[0].trimEnd(),
  '',
  sharedBody.trim(),
  '',
  functionBody.trim(),
  '',
].join('\n')

mkdirSync('supabase/dashboard', { recursive: true })
writeFileSync('supabase/dashboard/cross-cascade-tick.ts', output)
console.log('Scritto supabase/dashboard/cross-cascade-tick.ts')

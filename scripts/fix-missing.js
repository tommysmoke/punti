import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'

const SUPABASE_URL = 'https://yxafxswjrcqjpcjfneon.supabase.co'
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const STORE_ID = '6fa82010-8710-4dc9-b972-844dd3f50dd5'

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error('ERRORE: $env:SUPABASE_SERVICE_ROLE_KEY non impostata')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

function normalizzaNome(nome) {
  return nome
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase()
}

async function main() {
  // 1) Carica TUTTI i phone già esistenti nei customers
  const phoneEsistenti = new Set()
  let page = 0
  while (true) {
    const { data } = await supabase
      .from('customers')
      .select('phone')
      .eq('store_id', STORE_ID)
      .range(page * 1000, page * 1000 + 999)
    if (!data || data.length === 0) break
    data.forEach((c) => phoneEsistenti.add(c.phone))
    if (data.length < 1000) break
    page++
  }
  console.log(`Phone esistenti: ${phoneEsistenti.size}`)

  // 2) Carica TUTTI gli username esistenti (con paginazione)
  const usernamesEsistenti = new Set()
  page = 0
  while (true) {
    const { data } = await supabase
      .from('profiles')
      .select('username')
      .eq('role', 'customer')
      .neq('username', null)
      .range(page * 1000, page * 1000 + 999)
    if (!data || data.length === 0) break
    data.forEach((p) => usernamesEsistenti.add(p.username?.toLowerCase()))
    if (data.length < 1000) break
    page++
  }
  console.log(`Username esistenti: ${usernamesEsistenti.size}`)

  // 3) Leggi CSV e trova righe mancanti
  const csv = readFileSync(
    'C:\\Users\\Dell\\Documents\\clienti_nome_punti_finale.csv',
    'utf-8',
  )
  const righe = csv.trim().split('\n').slice(1)

  const mancanti = []
  for (let i = 0; i < righe.length; i++) {
    const tel = String(i + 1).padStart(3, '0')
    if (!phoneEsistenti.has(tel)) {
      const riga = righe[i].trim()
      if (!riga) continue
      const ultimaVirgola = riga.lastIndexOf(',')
      const nome = riga.substring(0, ultimaVirgola).trim()
      const punti = parseInt(riga.substring(ultimaVirgola + 1).trim(), 10)
      if (!nome || isNaN(punti)) continue

      const nomeBase = normalizzaNome(nome)
      let username
      let suffisso = 1
      do {
        const codice = String(suffisso).padStart(2, '0')
        username = `${nomeBase}01${codice}`
        suffisso++
      } while (usernamesEsistenti.has(username))

      usernamesEsistenti.add(username)
      mancanti.push({ i, nome, punti, tel, username })
    }
  }

  console.log(`Righe mancanti: ${mancanti.length}`)

  if (mancanti.length === 0) {
    console.log('Nessuna riga mancante. Import già completo!')
    return
  }

  // 4) Importa le righe mancanti
  let creati = 0
  let errori = 0

  for (const m of mancanti) {
    const email = `${m.tel}@import.local`
    try {
      const { error } = await supabase.auth.admin.createUser({
        email,
        password: m.tel,
        email_confirm: true,
        user_metadata: {
          role: 'customer',
          name: m.nome,
          phone: m.tel,
          username: m.username,
          store_id: STORE_ID,
        },
      })

      if (error) {
        console.log(`  ERR ${m.tel} (${m.nome}): ${error.message}`)
        errori++
        continue
      }

      creati++
      if (creati % 20 === 0) {
        console.log(`  ${creati}/${mancanti.length} creati...`)
        await new Promise((r) => setTimeout(r, 500))
      }
    } catch (e) {
      console.log(`  ERR ${m.tel}: ${e instanceof Error ? e.message : String(e)}`)
      errori++
    }
  }

  // Verifica finale
  const { count } = await supabase
    .from('customers')
    .select('*', { count: 'exact', head: true })
    .eq('store_id', STORE_ID)

  console.log(`\n--- COMPLETATO ---`)
  console.log(`Creati: ${creati}`)
  console.log(`Errori: ${errori}`)
  console.log(`Totale clienti nello store: ${count}`)
}

main()

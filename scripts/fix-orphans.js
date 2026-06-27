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

async function fix() {
  // Carica tutti gli username esistenti (con paginazione)
  const usernamesEsistenti = new Set()
  let page = 0
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
  console.log(`Username esistenti caricati: ${usernamesEsistenti.size}`)

  // Trova auth users @import.local senza customer (paginati)
  const csv = readFileSync(
    'C:\\Users\\Dell\\Documents\\clienti_nome_punti_finale.csv',
    'utf-8',
  )
  const righe = csv.trim().split('\n').slice(1)

  const orfani = []
  let authPage = 0
  const processedPhones = new Set()

  while (true) {
    const { data: usersPage } = await supabase.auth.admin.listUsers({
      perPage: 500,
      page: authPage,
    })

    const batch = usersPage?.users || []
    if (batch.length === 0) break

    for (const u of batch) {
      if (!u.email?.endsWith('@import.local')) continue
      const phone = u.user_metadata?.phone || u.email.split('@')[0]
      if (processedPhones.has(phone)) continue
      processedPhones.add(phone)

      // Verifica se ha già un customer
      const { data: profile } = await supabase
        .from('profiles')
        .select('customer_id')
        .eq('id', u.id)
        .single()

      if (!profile?.customer_id) {
        const phoneNum = parseInt(phone, 10)
        if (isNaN(phoneNum)) continue

        const rowIndex = phoneNum - 1
        const riga = righe[rowIndex]?.trim()
        if (!riga) continue

        const ultimaVirgola = riga.lastIndexOf(',')
        const nome = riga.substring(0, ultimaVirgola).trim()
        const punti = parseInt(riga.substring(ultimaVirgola + 1).trim(), 10) || 0

        const nomeBase = normalizzaNome(nome)
        let username
        let suffisso = 1
        do {
          const codice = String(suffisso).padStart(2, '0')
          username = `${nomeBase}01${codice}`
          suffisso++
        } while (usernamesEsistenti.has(username))

        usernamesEsistenti.add(username)

        orfani.push({ userId: u.id, nome, phone, username, punti })
      }
    }

    if (batch.length < 500) break
    authPage++
  }

  console.log(`Auth users orfani trovati: ${orfani.length}`)

  if (orfani.length === 0) {
    console.log('Nessun orfano da fixare.')
    return
  }

  let fissati = 0
  for (const o of orfani) {
    try {
      // Crea customer manualmente (come farebbe il trigger)
      const { data: customer, error: custErr } = await supabase
        .from('customers')
        .insert({
          store_id: STORE_ID,
          name: o.nome,
          phone: o.phone,
          points: o.punti,
          updated_at: new Date().toISOString(),
        })
        .select('id')
        .single()

      if (custErr) {
        console.log(`  ERR customer ${o.phone} (${o.nome}): ${custErr.message}`)
        continue
      }

      // Crea/aggiorna profilo
      const { error: profErr } = await supabase
        .from('profiles')
        .upsert({
          id: o.userId,
          role: 'customer',
          store_id: null,
          customer_id: customer.id,
          username: o.username,
        }, { onConflict: 'id' })

      if (profErr) {
        console.log(`  ERR profile ${o.phone} (${o.nome}): ${profErr.message}`)
        continue
      }

      fissati++
      if (fissati % 20 === 0) {
        console.log(`  ${fissati}/${orfani.length} orfani fissati...`)
        await new Promise((r) => setTimeout(r, 300))
      }
    } catch (e) {
      console.log(`  ERR ${o.phone}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  console.log(`\nFissati: ${fissati}/${orfani.length}`)
}

fix()

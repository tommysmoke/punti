import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'

const SUPABASE_URL = 'https://yxafxswjrcqjpcjfneon.supabase.co'
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const STORE_ID = '6fa82010-8710-4dc9-b972-844dd3f50dd5'
const START_FROM = parseInt(process.env.START_FROM || '4241', 10)

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

async function importa() {
  const csv = readFileSync(
    'C:\\Users\\Dell\\Documents\\clienti_nome_punti_finale.csv',
    'utf-8',
  )
  const righe = csv.trim().split('\n').slice(1)
  const totali = righe.length

  console.log(`Ripresa da riga ${START_FROM}/${totali}\n`)

  let contatoreTel = START_FROM
  let creati = 0
  let errori = []

  const { data: existing } = await supabase
    .from('profiles')
    .select('username')
    .eq('role', 'customer')
    .neq('username', null)

  const usernamesUsati = new Set((existing || []).map((p) => p.username?.toLowerCase()).filter(Boolean))

  for (let i = START_FROM - 1; i < righe.length; i++) {
    const riga = righe[i].trim()
    if (!riga) continue

    const ultimaVirgola = riga.lastIndexOf(',')
    const nome = riga.substring(0, ultimaVirgola).trim()
    const punti = parseInt(riga.substring(ultimaVirgola + 1).trim(), 10)

    if (!nome || isNaN(punti)) {
      errori.push({ riga: i + 2, nome, errore: 'Dati non validi' })
      continue
    }

    const nomeBase = normalizzaNome(nome)
    let username
    let suffisso = 1
    do {
      const codice = String(suffisso).padStart(2, '0')
      username = `${nomeBase}01${codice}`
      suffisso++
    } while (usernamesUsati.has(username))

    usernamesUsati.add(username)

    const telefono = String(contatoreTel).padStart(3, '0')
    contatoreTel++
    const email = `${telefono}@import.local`
    const password = telefono

    try {
      const { data, error } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          role: 'customer',
          name: nome,
          phone: telefono,
          username,
          store_id: STORE_ID,
        },
      })

      if (error) {
        errori.push({ nome, telefono, errore: error.message })
        continue
      }

      if (punti > 0 && data?.user) {
        const { data: profilo } = await supabase
          .from('profiles')
          .select('customer_id')
          .eq('id', data.user.id)
          .single()

        if (profilo?.customer_id) {
          await supabase
            .from('customers')
            .update({ points: punti, updated_at: new Date().toISOString() })
            .eq('id', profilo.customer_id)
        }
      }

      creati++

      if (creati % 20 === 0) {
        console.log(`  ${START_FROM - 1 + creati}/${totali} clienti creati...`)
        await new Promise((r) => setTimeout(r, 500))
      }
    } catch (e) {
      errori.push({
        nome,
        telefono,
        errore: e instanceof Error ? e.message : String(e),
      })
    }
  }

  console.log(`\n--- COMPLETATO ---`)
  console.log(`Creati in questa sessione: ${creati}`)
  if (errori.length > 0) {
    console.log(`Errori (${errori.length}):`)
    errori.forEach((e) =>
      console.log(`  ${e.nome || '?'} (tel:${e.telefono || '?'}): ${e.errore}`),
    )
  }
}

importa()

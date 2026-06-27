import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'

const SUPABASE_URL = 'https://yxafxswjrcqjpcjfneon.supabase.co'
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const STORE_ID = '6fa82010-8710-4dc9-b972-844dd3f50dd5'

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error('ERRORE: imposta la variabile d\'ambiente SUPABASE_SERVICE_ROLE_KEY')
  console.error('  $env:SUPABASE_SERVICE_ROLE_KEY="eyJh..."')
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
  const righe = csv.trim().split('\n').slice(1) // salta header "nome,punti_accumulati"

  const usernamesUsati = new Set()
  let contatoreTel = 1
  let creati = 0
  let errori = []

  console.log(`Totale righe CSV: ${righe.length}`)
  console.log('Inizio import...\n')

  for (let i = 0; i < righe.length; i++) {
    const riga = righe[i].trim()
    if (!riga) continue

    const ultimaVirgola = riga.lastIndexOf(',')
    const nome = riga.substring(0, ultimaVirgola).trim()
    const punti = parseInt(riga.substring(ultimaVirgola + 1).trim(), 10)

    if (!nome || isNaN(punti)) {
      errori.push({ riga: i + 2, nome, errore: 'Dati non validi' })
      continue
    }

    // Genera username unico: nomebase + 01 + suffisso a 2 cifre (01, 02, 03...)
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
        email_confirm: true, // salta email di verifica (dominio inesistente)
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

      // Aggiorna i punti (il trigger handle_new_user li mette a 0)
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
        console.log(`  ${creati}/${righe.length} clienti creati...`)
        await new Promise((r) => setTimeout(r, 500)) // evita rate limit
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
  console.log(`Creati: ${creati}/${righe.length}`)
  if (errori.length > 0) {
    console.log(`Errori (${errori.length}):`)
    errori.forEach((e) =>
      console.log(`  ${e.nome || '?'} (tel:${e.telefono || '?'}): ${e.errore}`),
    )
  }
}

importa()

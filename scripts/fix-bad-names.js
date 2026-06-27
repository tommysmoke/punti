import { createClient } from '@supabase/supabase-js'

const s = createClient(
  'https://yxafxswjrcqjpcjfneon.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

// Nomi corretti (ripuliti da virgolette e newline del CSV)
const fixes = [
  { id: 4425, name: 'Raffaella' },
  { id: 4481, name: 'Jack7890' },
  { id: 4560, name: 'Francesco Muraca' },
  { id: 4642, name: 'Germano' },
]

async function main() {
  for (const f of fixes) {
    const { error } = await s
      .from('customers')
      .update({ name: f.name })
      .eq('id', f.id)

    if (error) {
      console.log(`ERR id=${f.id}: ${error.message}`)
    } else {
      console.log(`OK id=${f.id} → ${f.name}`)
    }
  }
}

main()

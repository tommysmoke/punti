import { createClient } from '@supabase/supabase-js'

const s = createClient(
  'https://yxafxswjrcqjpcjfneon.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

async function main() {
  // Cerca nomi con virgolette (indice di parsing CSV rotto)
  const { data } = await s
    .from('customers')
    .select('id, name, phone')
    .eq('store_id', '6fa82010-8710-4dc9-b972-844dd3f50dd5')
    .like('name', '%"%')
    .order('id')
    .limit(30)

  console.log('Nomi con virgolette:', data?.length || 0)
  if (data) {
    data.forEach((c) =>
      console.log(`  id=${c.id} tel=${c.phone} name=${JSON.stringify(c.name)}`),
    )
  }
}

main()

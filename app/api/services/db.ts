import { createClient } from '@supabase/supabase-js'

// biome-ignore lint/style/noNonNullAssertion: <explanation>
const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!)

export async function checkIfUserExists(userId: string) {
  const { data, error } = await supabase.from('users').select('*').eq('id', userId)
  if (error) throw new Error('User does not exist')
  return data?.length > 0
}

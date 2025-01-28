import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  // biome-ignore lint/style/noNonNullAssertion: <explanation>
  process.env.SUPABASE_URL!,
  // biome-ignore lint/style/noNonNullAssertion: <explanation>
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);
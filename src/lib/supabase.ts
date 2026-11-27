import { createClient } from "@supabase/supabase-js";

// Public client configuration. The publishable key is designed for browser use;
// authorization is enforced by Supabase Auth and row-level security.
const supabaseUrl = "https://mbnhwnvxdsbfebtqvgym.supabase.co";
const supabasePublishableKey = "sb_publishable_dWW7tqtVJJe7so2hEzuYzw_L6f0P6ux";

export const supabase = createClient(supabaseUrl, supabasePublishableKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});

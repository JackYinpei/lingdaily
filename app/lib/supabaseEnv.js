// CommonJS so next-sitemap.config.js can require it; the app imports it too.
// The NEXT_PUBLIC_* names win over the plain server-side aliases everywhere.

function getSupabaseUrl() {
  return process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
}

function getSupabaseAnonKey() {
  return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
}

function getSupabaseServiceRoleKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY
}

function getSupabaseSchema() {
  return process.env.SUPABASE_SCHEMA || 'public'
}

module.exports = {
  getSupabaseUrl,
  getSupabaseAnonKey,
  getSupabaseServiceRoleKey,
  getSupabaseSchema,
}

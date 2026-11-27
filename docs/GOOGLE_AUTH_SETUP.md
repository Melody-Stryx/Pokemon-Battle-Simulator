# Google sign-in setup

The app uses the dedicated Pokémon Battle Lab Supabase project. Google OAuth credentials belong to this project and must not be shared with Privy.

1. In Google Cloud Console, create an OAuth 2.0 Client ID for a **Web application**.
2. Add this authorized redirect URI to the Google OAuth client:

   `https://mbnhwnvxdsbfebtqvgym.supabase.co/auth/v1/callback`

3. In the Pokémon Battle Lab Supabase dashboard, open Authentication → Providers → Google, enable Google, and enter the Google OAuth Client ID and Client Secret.
4. In Authentication → URL Configuration, add the app's production origin and the local development origin to the redirect URL allow list:

   - `https://pokemon-battle-simulator.melodystryx.workers.dev/**`
   - `http://localhost:5173/**`

The app redirects back to the origin that initiated sign-in. Supabase stores the session in the browser and refreshes it automatically.

## Data isolation

Team and folder data is stored in `public.user_teams`. Row-level security restricts every row to its owning authenticated user. Existing local teams are uploaded on first sign-in when no cloud record exists. If a cloud record already exists, it becomes the account's active team library on that device.

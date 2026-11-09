# Campus Canteen

A static campus canteen ordering website hosted on GitHub Pages, with Supabase providing authentication, menu data, order storage, and admin permissions. Students can browse the menu, submit pickup orders, and track their status. Canteen admins can add menu items, view incoming orders (the dashboard refreshes automatically every 20 seconds), and update their status.

## Set up Supabase

1. Create a Supabase project.
2. In the Supabase SQL Editor, run [`supabase/schema.sql`](./supabase/schema.sql). This creates the menu and order tables, enables row-level security, and seeds the menu. If the project is already set up, run the updated SQL again to enable admin menu management.
3. In Supabase **Authentication → Providers → Email**, enable email/password sign-in and keep email confirmation enabled. After creating an account, users must open the confirmation link sent to their email before signing in. The website can resend the link if needed. Users can request a password reset from the sign-in screen; configure Supabase email templates and SMTP delivery for production.
4. In `site/static/config.js`, set the Supabase project URL and **publishable/anon key** from **Project Settings → API**. This key is intended for browser use; never put a `service_role` or secret key in this file.

## Password reset email

In Supabase **Authentication → Email Templates → Reset Password**, set the subject to `Reset your Campus Canteen password` and paste the contents of [`supabase/email-templates/password-reset.html`](./supabase/email-templates/password-reset.html) into the message editor. The template uses Supabase's `{{ .ConfirmationURL }}` variable so the link continues to use the redirect URL requested by the website.

For delivery to real users, configure a custom SMTP provider in Supabase **Authentication → SMTP Settings**. Also make sure the deployed site URL is set in **Authentication → URL Configuration** and that the site's URL is in the allowed redirect URLs. Supabase's default email sender may be restricted and is intended for testing.

## Publish on GitHub Pages

1. Push this repository to GitHub.
2. In the repository, open **Settings → Pages** and set the build/deployment source to **GitHub Actions**.
3. Open the **Actions** tab and allow the Pages workflow if GitHub asks.
4. Push a change to `main` or run **Deploy static canteen website** from the Actions tab. The workflow publishes the `site/` directory.
5. Open the URL shown under **Settings → Pages**.
6. In Supabase **Authentication → URL Configuration**, set the site URL to your GitHub Pages URL and add it to the allowed redirect URLs. Add `http://127.0.0.1:8000/**` there too if you will test locally.
7. Create an account on the website, then promote that account to canteen admin by running this SQL in the Supabase SQL Editor (replace the email):

   ```sql
   update public.profiles
   set role = 'admin'
   where id = (
     select id
     from auth.users
     where email = 'canteen@example.com'
   );
   ```

   The account must be registered before running the query. The admin role is not assignable through the website.

## Local preview

After configuring `site/static/config.js`, run a local static server from the repository root:

```powershell
python -m http.server 8000 --directory site
```

Then open `http://127.0.0.1:8000`. The local HTTP server only serves the website files; Supabase provides account and order storage.

## Project layout

```text
site/                   Static website published by GitHub Pages
  index.html            App shell
  static/app.js         Customer and admin interface
  static/config.js      Supabase project URL and public browser key
  static/style.css      Responsive styles
supabase/schema.sql     Database schema, menu seed, and access policies
supabase/email-templates/  Supabase Auth email templates
.github/workflows/      GitHub Pages deployment
```

The ordering flow supports pickup orders and status tracking. It does not process online payments or provide delivery.

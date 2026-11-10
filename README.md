# Campus Canteen

A static campus canteen ordering website hosted on GitHub Pages, with Supabase providing authentication, menu data, order storage, and staff permissions. Students can browse the menu, submit pickup orders, and track their status. Chefs get a kitchen queue of orders to prepare, can update preparation status, and can add menu items. Administrators use the protected `site/chef.html` console to manage orders, food, categories, customers, payments, inventory, reviews, reports, staff access, and account settings. Inventory counts are maintained by the canteen and are not automatically reduced when orders are placed.

## Set up Supabase

1. Create a Supabase project.
2. In the Supabase SQL Editor, run [`supabase/schema.sql`](./supabase/schema.sql). This creates the menu and order tables, enables row-level security, and seeds the menu. The schema also provides `categories`, `cart`, `cart_items`, `payments`, and `reviews`; `users` and `food_items` are compatibility views over the existing `profiles` and `foods` tables. Supabase Auth remains the source of credentials. If the project is already set up, run the updated SQL again to apply the additions. Existing menu items will be marked as not counted until the canteen enters their stock quantities.
3. In Supabase **Authentication → Providers → Email**, enable email/password sign-in and keep email confirmation enabled. After creating an account, users must open the confirmation link sent to their email before signing in. The website can resend the link if needed. Users can request a password reset from the sign-in screen; configure Supabase email templates and SMTP delivery for production.
4. In `site/static/config.js`, set the Supabase project URL and **publishable/anon key** from **Project Settings → API**. This key is intended for browser use; never put a `service_role` or secret key in this file.

The schema creates the public `canteen-food-images` Storage bucket for admin food-image uploads (JPG, PNG, WebP, or AVIF; maximum 5 MB) and the admin-only database functions used for safe order transitions, deletion, and review moderation. Re-run the updated [`supabase/schema.sql`](./supabase/schema.sql) in the Supabase SQL Editor when deploying these changes.

## Admin and chef access

- Promote an existing, confirmed account to `admin` using the SQL in **Publish on GitHub Pages**. Open `site/chef.html` and sign in with that admin account to use the administration console. The page checks the profile role after authentication; there is no public admin registration.
- Chefs continue to sign in from the customer sign-in page using **Chef sign in**. Their existing kitchen queue and menu access remain role-restricted.
- The admin console summarizes paid revenue only for delivered/completed orders. Payment records are read-only; online payments must be confirmed by a verified payment provider, not by an admin UI action.
- Food image uploads are validated in the browser and restricted by Supabase Storage to admin accounts, allowed image MIME types, and 5 MB. Supabase Storage must be available in the project.
- Customer contact details and order history are visible only to signed-in admins under the existing row-level security policies. Passwords are never exposed. Suspending Supabase Auth accounts requires a trusted server-side Auth Admin API integration and is not exposed through this static app.
- The static app does not use Flask, SQLAlchemy, or Flask-Login. Do not put service-role credentials in browser code. Account deletion/suspension and other privileged Auth Admin actions require a separately hosted trusted backend.

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

8. To let a chef account receive kitchen orders, register and confirm that account first. As an admin, open **Staff access** and change the account to **Chef**. Alternatively, assign the chef role in the SQL Editor (replace the email):

   ```sql
   update public.profiles
   set role = 'chef'
   where id = (
     select id
     from auth.users
     where email = 'chef@example.com'
   );
   ```

  The chef signs in with that account to see the kitchen order queue and add menu items. Chef access does not include editing existing items or managing inventory.

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
  chef.html             Admin console sign-in and dashboard
  static/app.js         Customer, chef, and admin interfaces
  static/config.js      Supabase project URL and public browser key
  static/style.css      Responsive styles
supabase/schema.sql     Database schema, menu seed, and access policies
supabase/email-templates/  Supabase Auth email templates
.github/workflows/      GitHub Pages deployment
```

The ordering flow supports pickup orders and status tracking. It does not process online payments or provide delivery.

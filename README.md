# canteenon
canteen management

## Configuration

Set `SECRET_KEY` to a persistent, randomly generated value in deployed environments. If it is unset, the app generates a temporary key at startup, so sessions will be invalidated when the app restarts.

Set `ADMIN_PASSWORD` before the first startup to create the initial administrator account. If it is unset, no administrator account is created. Store both values in the environment or your hosting provider's secret manager; do not commit them. Existing administrator accounts are not changed automatically, so rotate any password created by an older version that used a default.

## Deploy to Render

This repository includes a Render Blueprint (`render.yaml`) for a paid web service with a persistent disk for the SQLite database. The persistent disk prevents user accounts and orders from disappearing when the service restarts or redeploys.

1. Push this repository to GitHub.
2. In Render, choose **New → Blueprint** and connect this repository.
3. Before deploying, provide a strong value for the prompted `ADMIN_PASSWORD`. Render generates `SECRET_KEY` automatically.
4. Create the Blueprint resources and wait for the first deployment to finish.
5. Open the service URL provided by Render. The initial administrator email is `admin@canteen.com`.

The persistent disk and paid web service incur hosting charges. Review Render's current pricing before creating the service. The app currently accepts orders for pickup but does not process online payments.

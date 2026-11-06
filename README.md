# canteenon
canteen management

## Configuration

Set `SECRET_KEY` to a persistent, randomly generated value in deployed environments. If it is unset, the app generates a temporary key at startup, so sessions will be invalidated when the app restarts.

Set `ADMIN_PASSWORD` before the first startup to create the initial administrator account. If it is unset, no administrator account is created. Store both values in the environment or your hosting provider's secret manager; do not commit them. Existing administrator accounts are not changed automatically, so rotate any password created by an older version that used a default.

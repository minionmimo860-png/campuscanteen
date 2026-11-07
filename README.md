# Campus Canteen

A Flask-based campus canteen ordering system. Students can browse the menu, manage a cart, and place pickup orders. Administrators can review orders and update their status.

## Features

- Student registration and login
- Menu browsing and cart updates
- Pickup order placement and order history
- Admin dashboard with order totals and status management
- SQLite storage for local use, with configurable database path

This project does not process online payments or provide delivery.

## Run locally

Requires Python 3.10 or later.

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
$env:ADMIN_PASSWORD = "choose-a-strong-password"
.\.venv\Scripts\python.exe app.py
```

Open [http://127.0.0.1:5000](http://127.0.0.1:5000). Register a student account to place a test order. The initial admin email is `admin@canteen.com`; its password is the `ADMIN_PASSWORD` value set before the first database initialization.

On macOS or Linux, run:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
export ADMIN_PASSWORD="choose-a-strong-password"
python app.py
```

## Configuration

| Variable | Purpose | Default |
| --- | --- | --- |
| `SECRET_KEY` | Flask session signing key. Set a persistent, randomly generated secret when deploying. | Temporary key generated at startup |
| `ADMIN_PASSWORD` | Password for creating the initial `admin@canteen.com` account. Only used if that account does not already exist. | No initial admin is created |
| `DATABASE_PATH` | SQLite database file location. Use persistent storage in a hosted deployment. | `canteen.db` |
| `SESSION_COOKIE_SECURE` | Marks session cookies secure for HTTPS deployments. | `false` |
| `PORT` | Port used by the local development server. | `5000` |

Keep secrets in your environment or hosting provider's secret manager. Do not commit them. Changing `ADMIN_PASSWORD` does not change the password of an existing administrator account.

## Deploy to Render

The included [Render Blueprint](./render.yaml) creates a Gunicorn web service and mounts a persistent disk at `/var/data` for the SQLite database. The persistent disk and service use a paid Render plan; check current pricing before deployment.

1. Push this repository to GitHub.
2. In Render, choose **New → Blueprint** and connect this repository.
3. Set a strong `ADMIN_PASSWORD` when prompted. Render generates `SECRET_KEY`; the Blueprint enables secure session cookies for HTTPS.
4. Create the Blueprint resources and wait for the deployment to finish.
5. Open the public service URL shown by Render. Sign in as `admin@canteen.com` with the password configured above.

The admin account is created only during database initialization and only if it does not already exist. Configure the password before the first deployment. If the account already exists, changing the environment variable will not reset its password.

## Project structure

```text
app.py                 Flask application and routes
wsgi.py                WSGI entry point for Gunicorn
render.yaml            Render deployment configuration
requirements.txt       Python dependencies
templates/             Jinja HTML templates
static/                CSS and static assets
```

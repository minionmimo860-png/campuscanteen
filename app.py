
from flask import (
    Flask, render_template, request,
    redirect, url_for, session, flash
)
import sqlite3
import os
from functools import wraps
from werkzeug.security import generate_password_hash, check_password_hash

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY") or os.urandom(32)

DATABASE = os.environ.get("DATABASE_PATH", "canteen.db")

# ---------------- FOOD MENU ----------------

FOOD_MENU = {
    1: {"name": "Tea - Red Milk", "price": 10, "emoji": "☕"},
    2: {"name": "Plain Paratha", "price": 30, "emoji": "🫓"},
    3: {"name": "Pori (2 Pcs)", "price": 30, "emoji": "🍞"},
    5: {"name": "Allu Paratha", "price": 40, "emoji": "🥔"},
    6: {"name": "Veg Roll", "price": 40, "emoji": "🌯"},
    7: {"name": "Egg Roll", "price": 50, "emoji": "🌯"},
    8: {"name": "Chicken Roll", "price": 70, "emoji": "🌯"},
    9: {"name": "Veg Chow", "price": 40, "emoji": "🍜"},
    10: {"name": "Egg Chow", "price": 50, "emoji": "🍜"},
    11: {"name": "Chicken Chow", "price": 70, "emoji": "🍜"},
    12: {"name": "Chicken Lollipop (2 Pcs)", "price": 60, "emoji": "🍗"},
    13: {"name": "Chicken Dry Fry (3 Pcs)", "price": 60, "emoji": "🍗"},
    14: {"name": "Chicken Pakoda (2 Pcs)", "price": 50, "emoji": "🥘"},
    15: {"name": "Veg Pakoda (3 Pcs)", "price": 40, "emoji": "🥔"},
    16: {"name": "Veg Fried Rice", "price": 40, "emoji": "🍚"},
    17: {"name": "Egg Fried Rice", "price": 50, "emoji": "🍚"},
    18: {"name": "Chicken Fried Rice", "price": 70, "emoji": "🍚"}
}


# ---------------- DATABASE ----------------

def get_db():
    os.makedirs(os.path.dirname(os.path.abspath(DATABASE)), exist_ok=True)
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_db()

    conn.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL,
            name TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            role TEXT DEFAULT 'student'
        )
    """)

    # Check existing users table columns
    columns = [
        row["name"]
        for row in conn.execute("PRAGMA table_info(users)").fetchall()
    ]

    # Add missing columns
    if "name" not in columns:
        conn.execute("ALTER TABLE users ADD COLUMN name TEXT")

    if "username" not in columns:
        conn.execute("ALTER TABLE users ADD COLUMN username TEXT")

    if "email" not in columns:
        conn.execute("ALTER TABLE users ADD COLUMN email TEXT")

    if "role" not in columns:
        conn.execute(
            "ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'student'"
        )

    # Preserve usernames from older database schemas.
    conn.execute("""
        UPDATE users
        SET name = username
        WHERE name IS NULL
    """)

    conn.execute("""
        UPDATE users
        SET username = name
        WHERE username IS NULL OR username = ''
    """)

    # Give existing users unique placeholder emails
    conn.execute("""
        UPDATE users
        SET email = 'legacy-' || id || '@local.invalid'
        WHERE email IS NULL OR email = ''
    """)

    conn.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email
        ON users(email)
    """)

    conn.commit()

    conn.execute("""
        CREATE TABLE IF NOT EXISTS orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            items TEXT NOT NULL,
            total REAL NOT NULL,
            status TEXT DEFAULT 'Pending',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(user_id) REFERENCES users(id)
        )
    """)

    # Create a default administrator if one does not exist.
    admin = conn.execute(
        "SELECT id FROM users WHERE email = ?",
        ("admin@canteen.com",)
    ).fetchone()

    admin_password = os.environ.get("ADMIN_PASSWORD")
    if not admin and admin_password:
        conn.execute("""
            INSERT INTO users (username, name, email, password, role)
            VALUES (?, ?, ?, ?, ?)
        """, (
            "Administrator",
            "Administrator",
            "admin@canteen.com",
            generate_password_hash(admin_password),
            "admin"
        ))

    conn.commit()
    conn.close()


# ---------------- LOGIN REQUIRED ----------------

def login_required(func):
    @wraps(func)
    def wrapper(*args, **kwargs):
        if "user_id" not in session:
            flash("Please login first.", "warning")
            return redirect(url_for("login"))
        return func(*args, **kwargs)
    return wrapper


def admin_required(func):
    @wraps(func)
    def wrapper(*args, **kwargs):
        if "user_id" not in session:
            return redirect(url_for("login"))

        if session.get("role") != "admin":
            flash("Admin access required.", "danger")
            return redirect(url_for("menu"))

        return func(*args, **kwargs)
    return wrapper


# ---------------- HOME ----------------

@app.route("/")
def home():
    if "user_id" in session:
        if session.get("role") == "admin":
            return redirect(url_for("admin"))
        return redirect(url_for("menu"))

    return redirect(url_for("login"))


# ---------------- REGISTRATION ----------------

@app.route("/register", methods=["GET", "POST"])
def register():

    if request.method == "POST":
        name = request.form.get("name", "").strip()
        username = request.form.get("username", "").strip()
        email = request.form.get("email", "").strip().lower()
        password = request.form.get("password", "")

        if not name or not username or not email or not password:
            flash("All fields are required.", "danger")
            return redirect(url_for("register"))

        if len(password) < 8:
            flash("Password must contain at least 8 characters.", "danger")
            return redirect(url_for("register"))

        conn = get_db()

        try:
            conn.execute("""
                INSERT INTO users (username, name, email, password)
                VALUES (?, ?, ?, ?)
            """, (
                username,
                name,
                email,
                generate_password_hash(password)
            ))

            conn.commit()
            flash("Registration successful! Please login.", "success")
            return redirect(url_for("login"))

        except sqlite3.IntegrityError:
         flash("Registration failed. Please check the database.", "danger")

        finally:
            conn.close()

    return render_template("register.html")


# ---------------- LOGIN ----------------

@app.route("/login", methods=["GET", "POST"])
def login():

    if request.method == "POST":
        email = request.form.get("email", "").strip().lower()
        password = request.form.get("password", "")

        conn = get_db()
        user = conn.execute(
            "SELECT * FROM users WHERE email = ?", (email,)
        ).fetchone()
        conn.close()

        if user and check_password_hash(user["password"], password):
            session["user_id"] = user["id"]
            session["name"] = user["name"]
            session["role"] = user["role"] or "student"
            return redirect(url_for("home"))

        flash("Invalid email or password.", "danger")
        return redirect(url_for("login"))

    return render_template("login.html")


# ---------------- LOGOUT ----------------

@app.route("/logout")
def logout():
    session.clear()
    flash("You have logged out.", "success")
    return redirect(url_for("login"))


# ---------------- FOOD MENU ----------------

@app.route("/menu")
@login_required
def menu():
    if session.get("role") == "admin":
        return redirect(url_for("admin"))

    return render_template(
        "menu.html",
        foods=FOOD_MENU
    )


# ---------------- ADD TO CART ----------------

@app.route("/add_to_cart/<int:food_id>", methods=["POST"])
@login_required
def add_to_cart(food_id):

    if session.get("role") != "student":
        return redirect(url_for("admin"))

    if food_id not in FOOD_MENU:
        flash("Food item not found.", "danger")
        return redirect(url_for("menu"))

    cart = session.get("cart", {})
    key = str(food_id)

    cart[key] = cart.get(key, 0) + 1

    session["cart"] = cart

    flash("Food added to cart!", "success")
    return redirect(url_for("menu"))


# ---------------- VIEW CART ----------------

@app.route("/cart")
@login_required
def cart():

    cart_data = []
    total = 0

    for food_id, quantity in session.get("cart", {}).items():

        food = FOOD_MENU.get(int(food_id))

        if food:
            subtotal = food["price"] * quantity

            cart_data.append({
                "id": int(food_id),
                "name": food["name"],
                "price": food["price"],
                "quantity": quantity,
                "subtotal": subtotal,
                "emoji": food["emoji"]
            })

            total += subtotal

    return render_template(
        "cart.html",
        cart=cart_data,
        total=total
    )


# ---------------- UPDATE CART ----------------

@app.route("/update_cart/<int:food_id>", methods=["POST"])
@login_required
def update_cart(food_id):

    cart = session.get("cart", {})
    key = str(food_id)

    try:
        quantity = int(request.form.get("quantity", 1))
    except ValueError:
        quantity = 1

    if key in cart and food_id in FOOD_MENU:

        if quantity <= 0:
            cart.pop(key)
        else:
            cart[key] = min(quantity, 50)

    session["cart"] = cart

    return redirect(url_for("cart"))


# ---------------- REMOVE ITEM ----------------

@app.route("/remove_item/<int:food_id>", methods=["POST"])
@login_required
def remove_item(food_id):

    cart = session.get("cart", {})
    cart.pop(str(food_id), None)

    session["cart"] = cart

    flash("Item removed.", "success")
    return redirect(url_for("cart"))


# ---------------- PLACE ORDER ----------------

@app.route("/place_order", methods=["POST"])
@login_required
def place_order():

    cart = session.get("cart", {})

    if not cart:
        flash("Your cart is empty.", "warning")
        return redirect(url_for("cart"))

    order_items = []
    total = 0

    for food_id, quantity in cart.items():

        food = FOOD_MENU.get(int(food_id))

        if food and isinstance(quantity, int) and 1 <= quantity <= 50:

            subtotal = food["price"] * quantity
            total += subtotal

            order_items.append(
                f"{food['name']} x {quantity} = Rs. {subtotal}"
            )

    if not order_items:
        flash("Your cart contains no valid items.", "danger")
        return redirect(url_for("cart"))

    conn = get_db()

    conn.execute("""
        INSERT INTO orders (user_id, items, total)
        VALUES (?, ?, ?)
    """, (
        session["user_id"],
        "\n".join(order_items),
        total
    ))

    conn.commit()
    conn.close()

    session["cart"] = {}

    flash("Your order has been placed successfully!", "success")
    return redirect(url_for("orders"))


# ---------------- MY ORDERS ----------------

@app.route("/orders")
@login_required
def orders():

    conn = get_db()

    my_orders = conn.execute("""
        SELECT * FROM orders
        WHERE user_id = ?
        ORDER BY id DESC
    """, (session["user_id"],)).fetchall()

    conn.close()

    return render_template(
        "orders.html",
        orders=my_orders
    )


# ---------------- ADMIN DASHBOARD ----------------

@app.route("/admin")
@admin_required
def admin():

    conn = get_db()

    all_orders = conn.execute("""
        SELECT orders.*, users.name, users.email
        FROM orders
        JOIN users ON orders.user_id = users.id
        ORDER BY orders.id DESC
    """).fetchall()

    total_orders = conn.execute(
        "SELECT COUNT(*) FROM orders"
    ).fetchone()[0]

    total_users = conn.execute(
        "SELECT COUNT(*) FROM users WHERE role = 'student'"
    ).fetchone()[0]

    total_sales = conn.execute(
        "SELECT COALESCE(SUM(total), 0) FROM orders"
    ).fetchone()[0]

    conn.close()

    return render_template(
        "admin.html",
        orders=all_orders,
        total_orders=total_orders,
        total_users=total_users,
        total_sales=total_sales
    )


# ---------------- UPDATE ORDER STATUS ----------------

@app.route("/update_status/<int:order_id>", methods=["POST"])
@admin_required
def update_status(order_id):

    status = request.form.get("status")

    if status not in ["Pending", "Preparing", "Ready", "Completed", "Cancelled"]:
        flash("Invalid order status.", "danger")
        return redirect(url_for("admin"))

    conn = get_db()

    conn.execute("""
        UPDATE orders
        SET status = ?
        WHERE id = ?
    """, (status, order_id))

    conn.commit()
    conn.close()

    flash("Order status updated.", "success")
    return redirect(url_for("admin"))


# ---------------- START APPLICATION ----------------

if __name__ == "__main__":
    init_db()
    app.run(
        host="0.0.0.0",
        port=int(os.environ.get("PORT", 5000)),
        debug=False
    )

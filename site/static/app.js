import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const config = window.CANTEEN_CONFIG || {};
const root = document.querySelector("#app");
const accountBar = document.querySelector("#account-bar");
const notice = document.querySelector("#notice");
const statuses = ["Pending", "Preparing", "Ready", "Completed", "Cancelled"];
const money = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0
});

let client;
let currentUser = null;
let profile = null;
let foods = [];
let cart = {};
let activeView = "menu";
let noticeTimer;
let adminRefreshTimer;
let isPasswordRecovery = false;

function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[character]);
}

function showNotice(message, type = "info") {
    window.clearTimeout(noticeTimer);
    notice.hidden = false;
    notice.className = `notice notice-${type}`;
    notice.textContent = message;
    noticeTimer = window.setTimeout(() => {
        notice.hidden = true;
    }, 6000);
}

function setLoading(message = "Loading…") {
    root.innerHTML = `<section class="loading-state"><span class="loader" aria-hidden="true"></span><p>${escapeHtml(message)}</p></section>`;
}

function configIsReady() {
    return config.supabaseUrl?.startsWith("https://")
        && !config.supabaseUrl.includes("YOUR_PROJECT_ID")
        && config.supabaseAnonKey
        && !config.supabaseAnonKey.includes("YOUR_SUPABASE");
}

function renderAuth(mode = "login", {
    email = "",
    confirmationMessage = "",
    showResendConfirmation = true
} = {}) {
    const registering = mode === "register";
    accountBar.innerHTML = "";
    root.innerHTML = `
        <section class="auth-layout">
            <div class="auth-intro">
                <span class="eyebrow">YOUR CAMPUS, YOUR CANTEEN</span>
                <h1>Good food.<br><span>Easy pickup.</span></h1>
                <p>Order your campus favourites in a few taps. We’ll have them ready at the canteen.</p>
                <div class="intro-note"><span aria-hidden="true">✦</span> Simple ordering, less waiting.</div>
            </div>
            <div class="auth-card">
                <div class="auth-switch" role="group" aria-label="Account options">
                    <button class="switch-button ${registering ? "" : "active"}" data-view="login" type="button">Sign in</button>
                    <button class="switch-button ${registering ? "active" : ""}" data-view="register" type="button">Create account</button>
                </div>
                <h2>${registering ? "Join the canteen" : "Welcome back"}</h2>
                <p class="muted">${registering ? "Create your student account to start ordering." : "Sign in to browse the menu and see your orders."}</p>
                ${!registering && confirmationMessage ? `
                <div class="auth-confirmation" role="status">
                    <p>${escapeHtml(confirmationMessage)}</p>
                    ${showResendConfirmation ? `<button class="button button-secondary button-wide" data-action="resend-confirmation" data-email="${escapeHtml(email)}" type="button">Resend confirmation email</button>` : ""}
                </div>` : ""}
                <form id="auth-form" class="form-stack" data-mode="${registering ? "register" : "login"}">
                    ${registering ? `
                    <label>Full name
                        <input name="name" autocomplete="name" maxlength="80" required>
                    </label>
                    <label>Username
                        <input name="username" autocomplete="username" minlength="3" maxlength="30" required>
                    </label>` : ""}
                    <label>Email address
                        <input name="email" type="email" autocomplete="email" value="${escapeHtml(email)}" ${registering ? "" : "autofocus"} required>
                    </label>
                    <label>Password
                        <div class="password-field">
                            <input name="password" type="password" autocomplete="${registering ? "new-password" : "current-password"}" minlength="${registering ? "8" : "1"}" required>
                            <button class="password-toggle" data-action="toggle-password" type="button" aria-label="Show password" aria-pressed="false">Show</button>
                        </div>
                    </label>
                    <button class="button button-primary button-wide" type="submit">${registering ? "Create account" : "Sign in"}</button>
                </form>
                ${!registering ? `<button class="text-button" data-view="forgot-password" data-email="${escapeHtml(email)}" type="button">Forgot password?</button>` : ""}
                <p class="auth-footnote">Pickup orders only. Payment is made at the canteen.</p>
            </div>
        </section>`;
}

function renderForgotPassword(email = "") {
    accountBar.innerHTML = "";
    root.innerHTML = `
        <section class="auth-layout">
            <div class="auth-intro">
                <span class="eyebrow">ACCOUNT RECOVERY</span>
                <h1>Let’s get you<br><span>back in.</span></h1>
                <p>Enter the email address used for your account. We’ll send a secure link to reset your password.</p>
            </div>
            <div class="auth-card">
                <h2>Reset your password</h2>
                <p class="muted">We’ll email you a link to choose a new password.</p>
                <form id="forgot-password-form" class="form-stack">
                    <label>Email address
                        <input name="email" type="email" autocomplete="email" value="${escapeHtml(email)}" required>
                    </label>
                    <button class="button button-primary button-wide" type="submit">Send reset link</button>
                </form>
                <button class="text-button" data-view="login" data-email="${escapeHtml(email)}" type="button">Back to sign in</button>
            </div>
        </section>`;
}

function renderPasswordUpdate() {
    accountBar.innerHTML = "";
    root.innerHTML = `
        <section class="auth-layout">
            <div class="auth-intro">
                <span class="eyebrow">ACCOUNT RECOVERY</span>
                <h1>Choose a<br><span>new password.</span></h1>
                <p>Set a new password for your Campus Canteen account.</p>
            </div>
            <div class="auth-card">
                <h2>Set new password</h2>
                <p class="muted">Use at least 8 characters.</p>
                <form id="update-password-form" class="form-stack">
                    <label>New password
                        <input name="password" type="password" autocomplete="new-password" minlength="8" required>
                    </label>
                    <label>Confirm new password
                        <input name="confirm-password" type="password" autocomplete="new-password" minlength="8" required>
                    </label>
                    <button class="button button-primary button-wide" type="submit">Update password</button>
                </form>
            </div>
        </section>`;
}

function renderAccountBar(view = activeView) {
    if (!currentUser || !profile) {
        accountBar.innerHTML = "";
        return;
    }

    const links = profile.role === "admin"
        ? `<button class="nav-button ${view === "admin" ? "active" : ""}" data-view="admin" type="button">Orders dashboard</button>
           <button class="nav-button ${view === "admin-menu" ? "active" : ""}" data-view="admin-menu" type="button">Manage menu</button>`
        : `<button class="nav-button ${view === "menu" ? "active" : ""}" data-view="menu" type="button">Menu</button>
           <button class="nav-button ${view === "cart" ? "active" : ""}" data-view="cart" type="button">Cart <span class="cart-count">${cartCount()}</span></button>
           <button class="nav-button ${view === "orders" ? "active" : ""}" data-view="orders" type="button">My orders</button>`;
    accountBar.innerHTML = `
        <nav class="main-nav" aria-label="Main navigation">${links}</nav>
        <span class="account-name">${escapeHtml(profile.name)}</span>
        <button class="button button-quiet button-small" data-action="logout" type="button">Sign out</button>`;
}

function cartCount() {
    return Object.values(cart).reduce((sum, quantity) => sum + quantity, 0);
}

function renderMenu() {
    activeView = "menu";
    renderAccountBar();
    root.innerHTML = `
        <section class="page-heading">
            <div><span class="eyebrow">MADE FRESH ON CAMPUS</span><h1>What sounds good?</h1>
            <p>Choose your favourites and place a pickup order.</p></div>
            <button class="button button-primary" data-view="cart" type="button">View cart <span class="cart-count">${cartCount()}</span></button>
        </section>
        <section class="food-grid" aria-label="Canteen menu">
            ${foods.map((food) => `
                <article class="food-card">
                    <div class="food-art" aria-hidden="true">${escapeHtml(food.emoji)}</div>
                    <div class="food-info">
                        <h2>${escapeHtml(food.name)}</h2>
                        <p class="food-subtitle">Freshly prepared for pickup</p>
                        <div class="food-buy">
                            <strong>${money.format(food.price)}</strong>
                            <button class="button button-add" data-action="add" data-id="${food.id}" type="button" aria-label="Add ${escapeHtml(food.name)} to cart">Add <span aria-hidden="true">+</span></button>
                        </div>
                    </div>
                </article>`).join("")}
        </section>`;
}

function renderCart() {
    activeView = "cart";
    renderAccountBar();
    const items = Object.entries(cart)
        .map(([id, quantity]) => {
            const food = foods.find((item) => item.id === Number(id));
            return food ? { ...food, quantity } : null;
        })
        .filter(Boolean);

    if (items.length === 0) {
        root.innerHTML = `
            <section class="empty-state">
                <span class="empty-icon" aria-hidden="true">＋</span>
                <h1>Your cart is waiting</h1>
                <p>Add something tasty from the menu to get started.</p>
                <button class="button button-primary" data-view="menu" type="button">Browse the menu</button>
            </section>`;
        return;
    }

    const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    root.innerHTML = `
        <section class="page-heading">
            <div><span class="eyebrow">YOUR ORDER</span><h1>Your cart</h1><p>Review your items before placing your pickup order.</p></div>
            <button class="button button-secondary" data-view="menu" type="button">Continue browsing</button>
        </section>
        <div class="cart-layout">
            <section class="cart-list" aria-label="Cart items">
                ${items.map((item) => `
                    <article class="cart-item">
                        <div class="cart-item-art" aria-hidden="true">${escapeHtml(item.emoji)}</div>
                        <div class="cart-item-info"><h2>${escapeHtml(item.name)}</h2><p>${money.format(item.price)} each</p></div>
                        <div class="quantity-control" aria-label="Quantity for ${escapeHtml(item.name)}">
                            <button data-action="decrease" data-id="${item.id}" type="button" aria-label="Decrease quantity">−</button>
                            <span>${item.quantity}</span>
                            <button data-action="increase" data-id="${item.id}" type="button" aria-label="Increase quantity">+</button>
                        </div>
                        <strong class="item-total">${money.format(item.price * item.quantity)}</strong>
                        <button class="remove-button" data-action="remove" data-id="${item.id}" type="button" aria-label="Remove ${escapeHtml(item.name)}">Remove</button>
                    </article>`).join("")}
            </section>
            <aside class="summary-card">
                <h2>Order summary</h2>
                <div class="summary-line"><span>Items (${cartCount()})</span><span>${money.format(total)}</span></div>
                <div class="summary-line"><span>Pickup</span><span>At canteen</span></div>
                <div class="summary-total"><span>Total</span><strong>${money.format(total)}</strong></div>
                <button class="button button-primary button-wide" data-action="place-order" type="button">Place pickup order</button>
                <p class="summary-note">Pay when you collect your order at the canteen.</p>
            </aside>
        </div>`;
}

function orderItemsMarkup(items) {
    if (!Array.isArray(items) || items.length === 0) {
        return "<p class=\"muted\">No item details available.</p>";
    }
    return `<ul class="order-items">${items.map((item) => `
        <li><span>${escapeHtml(item.foods?.name || "Menu item")} <span class="muted">× ${item.quantity}</span></span>
        <strong>${money.format(item.unit_price * item.quantity)}</strong></li>`).join("")}</ul>`;
}

function orderCard(order, admin = false) {
    const customer = admin
        ? `<div class="customer-detail"><strong>${escapeHtml(order.profiles?.name || "Customer")}</strong><span>${escapeHtml(order.profiles?.email || "")}</span></div>`
        : "";
    const status = admin
        ? `<form class="status-form" data-order-id="${order.id}">
               <label class="sr-only" for="status-${order.id}">Update order ${order.id} status</label>
               <select id="status-${order.id}" name="status">${statuses.map((status) => `<option value="${status}" ${status === order.status ? "selected" : ""}>${status}</option>`).join("")}</select>
               <button class="button button-secondary button-small" type="submit">Save</button>
           </form>`
        : `<span class="status-pill status-${order.status.toLowerCase()}">${escapeHtml(order.status)}</span>`;
    return `
        <article class="order-card">
            <div class="order-topline">
                <div><span class="eyebrow">${admin ? "INCOMING ORDER" : "PICKUP ORDER"}</span><h2>Order #${escapeHtml(order.id.slice(0, 8).toUpperCase())}</h2></div>
                ${status}
            </div>
            ${customer}
            <p class="order-date">${escapeHtml(new Date(order.created_at).toLocaleString())}</p>
            ${orderItemsMarkup(order.order_items)}
            <div class="order-total"><span>Total</span><strong>${money.format(order.total)}</strong></div>
        </article>`;
}

async function loadCustomerOrders() {
    activeView = "orders";
    setLoading("Loading your orders…");
    const { data, error } = await client
        .from("orders")
        .select("id,total,status,created_at,order_items(quantity,unit_price,foods(name))")
        .eq("user_id", currentUser.id)
        .order("created_at", { ascending: false });
    if (error) throw error;

    renderAccountBar();
    root.innerHTML = `
        <section class="page-heading"><div><span class="eyebrow">ORDER HISTORY</span><h1>My orders</h1><p>Follow the status of your canteen pickup orders.</p></div></section>
        ${data.length ? `<section class="orders-list">${data.map((order) => orderCard(order)).join("")}</section>` : `
            <section class="empty-state"><span class="empty-icon" aria-hidden="true">✓</span><h2>No orders yet</h2><p>Your orders will show up here once you place one.</p><button class="button button-primary" data-view="menu" type="button">Browse the menu</button></section>`}`;
}

async function loadAdminDashboard() {
    activeView = "admin";
    if (!adminRefreshTimer) setLoading("Loading canteen orders…");
    const [{ data: orders, error: ordersError }, { count: studentCount, error: usersError }] = await Promise.all([
        client.from("orders")
            .select("id,total,status,created_at,profiles!orders_user_id_fkey(name,email),order_items(quantity,unit_price,foods(name))")
            .order("created_at", { ascending: false }),
        client.from("profiles").select("id", { count: "exact", head: true }).eq("role", "student")
    ]);
    if (ordersError) throw ordersError;
    if (usersError) throw usersError;

    const sales = orders.reduce((sum, order) => sum + Number(order.total), 0);
    renderAccountBar();
    root.innerHTML = `
        <section class="page-heading">
            <div><span class="eyebrow">CANTEEN CONTROL</span><h1>Orders dashboard</h1><p>Incoming website orders appear here for the canteen.</p></div>
            <button class="button button-secondary" data-action="refresh-admin" type="button">Refresh orders</button>
        </section>
        <section class="stats-grid" aria-label="Canteen statistics">
            <article class="stat-card"><span>Total orders</span><strong>${orders.length}</strong></article>
            <article class="stat-card"><span>Students</span><strong>${studentCount || 0}</strong></article>
            <article class="stat-card"><span>Order value</span><strong>${money.format(sales)}</strong></article>
        </section>
        <section class="orders-heading"><div><h2>All orders</h2><p>Update an order's status after preparing it.</p></div></section>
        ${orders.length ? `<section class="orders-list">${orders.map((order) => orderCard(order, true)).join("")}</section>` : `
            <section class="empty-state compact"><span class="empty-icon" aria-hidden="true">✓</span><h2>No orders received yet</h2><p>New customer orders will appear here.</p></section>`}`;

    if (!adminRefreshTimer) {
        adminRefreshTimer = window.setInterval(() => {
            if (profile?.role === "admin" && activeView === "admin") {
                loadAdminDashboard().catch(handleError);
            }
        }, 20000);
    }
}

async function loadAdminMenu() {
    if (profile?.role !== "admin") return;
    activeView = "admin-menu";
    setLoading("Loading menu management…");
    const { data: menu, error } = await client
        .from("foods")
        .select("id,name,price,emoji,is_available")
        .order("name");
    if (error) throw error;

    renderAccountBar();
    root.innerHTML = `
        <section class="page-heading">
            <div><span class="eyebrow">CANTEEN CONTROL</span><h1>Manage menu</h1><p>Add a food item to the student menu.</p></div>
        </section>
        <section class="menu-admin-layout">
            <form id="admin-food-form" class="menu-form">
                <h2>Add a food item</h2>
                <label>Food name
                    <input name="name" maxlength="80" autocomplete="off" required>
                </label>
                <label>Price (INR)
                    <input name="price" type="number" min="0" max="100000" step="1" inputmode="numeric" required>
                </label>
                <label>Food emoji
                    <input name="emoji" type="text" value="🍽️" maxlength="8" autocomplete="off" required>
                </label>
                <button class="button button-primary" type="submit">Add to menu</button>
            </form>
            <section class="menu-admin-list" aria-label="Current menu items">
                <div class="orders-heading"><div><h2>Current menu</h2><p>${menu.length} item${menu.length === 1 ? "" : "s"}</p></div></div>
                ${menu.length ? `<ul class="menu-item-list">${menu.map((food) => `
                    <li><span class="menu-item-emoji" aria-hidden="true">${escapeHtml(food.emoji)}</span>
                        <span class="menu-item-name">${escapeHtml(food.name)}${food.is_available ? "" : " <span class=\"muted\">(unavailable)</span>"}</span>
                        <strong>${money.format(food.price)}</strong></li>`).join("")}</ul>` : `<p class="muted">No menu items yet.</p>`}
            </section>
        </section>`;
}

async function onSession(session) {
    if (isPasswordRecovery) {
        renderPasswordUpdate();
        return;
    }
    currentUser = session?.user || null;
    if (!currentUser) {
        window.clearInterval(adminRefreshTimer);
        adminRefreshTimer = undefined;
        profile = null;
        cart = {};
        renderAuth();
        return;
    }

    setLoading("Preparing your canteen…");
    const { data, error } = await client
        .from("profiles")
        .select("id,name,email,role")
        .eq("id", currentUser.id)
        .single();
    if (error) throw error;
    profile = data;
    if (profile.role === "admin") {
        await loadAdminDashboard();
        return;
    }

    window.clearInterval(adminRefreshTimer);
    adminRefreshTimer = undefined;
    try {
        const savedCart = JSON.parse(window.localStorage.getItem(`canteen-cart:${currentUser.id}`) || "{}");
        cart = savedCart && typeof savedCart === "object" && !Array.isArray(savedCart)
            ? savedCart
            : {};
    } catch (error) {
        console.error(error);
        cart = {};
        showNotice("Your saved cart could not be read, so it was cleared.", "error");
    }

    const { data: menu, error: menuError } = await client
        .from("foods")
        .select("id,name,price,emoji")
        .eq("is_available", true)
        .order("id");
    if (menuError) throw menuError;
    foods = menu;
    const availableFoodIds = new Set(foods.map((food) => food.id));
    cart = Object.fromEntries(Object.entries(cart).filter(([id, quantity]) =>
        availableFoodIds.has(Number(id))
        && Number.isInteger(quantity)
        && quantity >= 1
        && quantity <= 50
    ));
    renderMenu();
}

async function submitAuth(form) {
    const values = new FormData(form);
    const email = String(values.get("email")).trim().toLowerCase();
    const password = String(values.get("password"));
    if (form.dataset.mode === "register") {
        const name = String(values.get("name")).trim();
        const username = String(values.get("username")).trim();
        if (name.length === 0 || username.length < 3) {
            showNotice("Enter your name and a username with at least 3 characters.", "error");
            return;
        }
        const { data, error } = await client.auth.signUp({
            email,
            password,
            options: {
                data: { name, username },
                emailRedirectTo: window.location.href
            }
        });
        if (error) throw error;
        if (!data.session) {
            renderAuth("login", {
                email,
                confirmationMessage: "Account created. Open the confirmation link we emailed you before signing in. Check your spam folder if it is missing."
            });
        }
        return;
    }

    const { error } = await client.auth.signInWithPassword({ email, password });
    if (error?.code === "email_not_confirmed") {
        renderAuth("login", {
            email,
            confirmationMessage: "This account's email is not confirmed yet. Open the confirmation link in your inbox, or resend it below."
        });
        return;
    }
    if (error?.code === "invalid_credentials") {
        showNotice("That email and password do not match. Check your details or reset your password.", "error");
        return;
    }
    if (error) throw error;
}

async function resendConfirmation(email) {
    const { error } = await client.auth.resend({
        type: "signup",
        email,
        options: { emailRedirectTo: window.location.href }
    });
    if (error) throw error;
    showNotice("Confirmation email sent. Open the latest link in your inbox, then sign in.", "success");
}

async function requestPasswordReset(form) {
    const email = String(new FormData(form).get("email")).trim().toLowerCase();
    const { error } = await client.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}${window.location.pathname}`
    });
    if (error) throw error;
    renderAuth("login", {
        email,
        confirmationMessage: "If an account uses that email, a password reset link is on its way. Check your inbox and spam folder.",
        showResendConfirmation: false
    });
}

async function updatePassword(form) {
    const values = new FormData(form);
    const password = String(values.get("password"));
    const confirmPassword = String(values.get("confirm-password"));
    if (password !== confirmPassword) {
        showNotice("The passwords do not match.", "error");
        return;
    }

    const { error } = await client.auth.updateUser({ password });
    if (error) throw error;
    isPasswordRecovery = false;
    const { data, error: sessionError } = await client.auth.getSession();
    if (sessionError) throw sessionError;
    await onSession(data.session);
    showNotice("Your password has been updated.", "success");
}

async function placeOrder() {
    const items = Object.entries(cart).map(([foodId, quantity]) => ({
        food_id: Number(foodId),
        quantity
    }));
    if (items.length === 0) {
        showNotice("Add an item before placing your order.", "error");
        return;
    }
    const { error } = await client.rpc("place_order", { p_items: items });
    if (error) throw error;
    cart = {};
    window.localStorage.removeItem(`canteen-cart:${currentUser.id}`);
    showNotice("Order placed! The canteen has received it.", "success");
    await loadCustomerOrders();
}

async function updateOrderStatus(form) {
    const orderId = form.dataset.orderId;
    const status = new FormData(form).get("status");
    if (!statuses.includes(status)) {
        showNotice("Choose a valid order status.", "error");
        return;
    }
    const { error } = await client.from("orders")
        .update({ status })
        .eq("id", orderId);
    if (error) throw error;
    showNotice("Order status updated.", "success");
    await loadAdminDashboard();
}

async function addMenuItem(form) {
    if (profile?.role !== "admin") return;
    const values = new FormData(form);
    const name = String(values.get("name")).trim();
    const price = Number(values.get("price"));
    const emoji = String(values.get("emoji")).trim();
    if (!name || name.length > 80 || !Number.isInteger(price) || price < 0 || price > 100000 || !emoji) {
        showNotice("Enter a food name, a whole-number price from 0 to 100,000, and an emoji.", "error");
        return;
    }

    const { error } = await client.from("foods").insert({ name, price, emoji });
    if (error) throw error;
    showNotice(`${name} was added to the menu.`, "success");
    await loadAdminMenu();
}

function handleError(error) {
    console.error(error);
    showNotice(error?.message || "Something went wrong. Please try again.", "error");
}

document.addEventListener("click", async (event) => {
    const viewButton = event.target.closest("[data-view]");
    if (viewButton) {
        const view = viewButton.dataset.view;
        if (view === "login" || view === "register") {
            renderAuth(view, { email: viewButton.dataset.email || "" });
        } else if (view === "forgot-password") {
            renderForgotPassword(viewButton.dataset.email || "");
        } else if (view === "menu") {
            renderMenu();
        } else if (view === "cart") {
            renderCart();
        } else if (view === "orders") {
            await loadCustomerOrders().catch(handleError);
        } else if (view === "admin" && profile?.role === "admin") {
            await loadAdminDashboard().catch(handleError);
        } else if (view === "admin-menu" && profile?.role === "admin") {
            await loadAdminMenu().catch(handleError);
        }
        return;
    }

    const actionButton = event.target.closest("[data-action]");
    if (!actionButton) return;
    const { action, id } = actionButton.dataset;
    try {
        if (action === "toggle-password") {
            const passwordInput = actionButton.parentElement.querySelector('input[name="password"]');
            const showingPassword = passwordInput.type === "password";
            passwordInput.type = showingPassword ? "text" : "password";
            actionButton.textContent = showingPassword ? "Hide" : "Show";
            actionButton.setAttribute("aria-label", `${showingPassword ? "Hide" : "Show"} password`);
            actionButton.setAttribute("aria-pressed", String(showingPassword));
        } else if (action === "add" || action === "increase") {
            const currentQuantity = cart[id] || 0;
            if (currentQuantity >= 50) {
                showNotice("You can order up to 50 of each item.", "error");
                return;
            }
            cart[id] = currentQuantity + 1;
            window.localStorage.setItem(`canteen-cart:${currentUser.id}`, JSON.stringify(cart));
            renderMenu();
            showNotice("Added to your cart.", "success");
        } else if (action === "decrease") {
            cart[id] = Math.max((cart[id] || 0) - 1, 0);
            if (cart[id] === 0) delete cart[id];
            window.localStorage.setItem(`canteen-cart:${currentUser.id}`, JSON.stringify(cart));
            renderCart();
        } else if (action === "remove") {
            delete cart[id];
            window.localStorage.setItem(`canteen-cart:${currentUser.id}`, JSON.stringify(cart));
            renderCart();
            showNotice("Item removed from cart.", "success");
        } else if (action === "place-order") {
            await placeOrder();
        } else if (action === "logout") {
            const { error } = await client.auth.signOut();
            if (error) throw error;
        } else if (action === "resend-confirmation") {
            const email = actionButton.dataset.email || root.querySelector('#auth-form input[name="email"]')?.value.trim();
            if (!email) {
                showNotice("Enter your email address first.", "error");
                return;
            }
            actionButton.disabled = true;
            try {
                await resendConfirmation(email);
            } finally {
                actionButton.disabled = false;
            }
        } else if (action === "refresh-admin") {
            await loadAdminDashboard();
        }
    } catch (error) {
        handleError(error);
    }
});

root.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.target;
    try {
        if (form.id === "auth-form" || form.id === "forgot-password-form" || form.id === "update-password-form") {
            const submitButton = form.querySelector('button[type="submit"]');
            const originalText = submitButton.textContent;
            submitButton.disabled = true;
            submitButton.textContent = form.id === "auth-form"
                ? (form.dataset.mode === "register" ? "Creating account…" : "Signing in…")
                : (form.id === "forgot-password-form" ? "Sending link…" : "Updating password…");
            try {
                if (form.id === "auth-form") {
                    await submitAuth(form);
                } else if (form.id === "forgot-password-form") {
                    await requestPasswordReset(form);
                } else {
                    await updatePassword(form);
                }
            } finally {
                submitButton.disabled = false;
                submitButton.textContent = originalText;
            }
        } else if (form.matches(".status-form")) {
            await updateOrderStatus(form);
        } else if (form.id === "admin-food-form") {
            const submitButton = form.querySelector('button[type="submit"]');
            submitButton.disabled = true;
            try {
                await addMenuItem(form);
            } finally {
                submitButton.disabled = false;
            }
        }
    } catch (error) {
        const submitButton = form.querySelector('button[type="submit"]');
        if (submitButton) submitButton.disabled = false;
        handleError(error);
    }
});

if (!configIsReady()) {
    accountBar.innerHTML = "";
    root.innerHTML = `
        <section class="setup-card">
            <span class="eyebrow">ONE-TIME SETUP</span>
            <h1>Connect your canteen website</h1>
            <p>Add your Supabase project URL and publishable/anon key in <code>site/static/config.js</code>, then deploy the GitHub Pages site again.</p>
            <p class="security-note">Use only the browser-safe publishable/anon key. Never expose a Supabase service role or secret key.</p>
        </section>`;
} else {
    try {
        client = createClient(config.supabaseUrl, config.supabaseAnonKey);
        client.auth.onAuthStateChange((event, session) => {
            if (event === "PASSWORD_RECOVERY") {
                isPasswordRecovery = true;
                renderPasswordUpdate();
                return;
            }
            window.setTimeout(() => onSession(session).catch(handleError), 0);
        });
        const { data, error } = await client.auth.getSession();
        if (error) throw error;
        await onSession(data.session);
    } catch (error) {
        handleError(error);
    }
}

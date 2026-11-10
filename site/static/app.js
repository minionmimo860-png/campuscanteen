import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const config = window.CANTEEN_CONFIG || {};
const isChefPage = document.body.dataset.page === "chef";
const root = document.querySelector("#app");
const accountBar = document.querySelector("#account-bar");
const notice = document.querySelector("#notice");
const statuses = ["Pending", "Accepted", "Preparing", "Ready for Pickup", "Out for Delivery", "Delivered", "Cancelled"];
const chefStatuses = ["Pending", "Accepted", "Preparing", "Ready for Pickup"];
const money = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0
});
const DELIVERY_CHARGE = 40;
let menuSearch = "";
let activeCategory = "all";
let menuSort = "featured";

let client;
let currentUser = null;
let profile = null;
let foods = [];
let cart = {};
let activeView = "menu";
let noticeTimer;
let adminRefreshTimer;
let isPasswordRecovery = false;
let adminOrders = [];
let adminOrderFilter = "all";
let adminOrderSearch = "";

function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[character]);
}

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidPhone(phone) {
    return /^\+?[0-9\s()-]{8,20}$/.test(phone.trim());
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

function renderChefLogin(mode = "login", {
    email = "",
    confirmationMessage = "",
    showResendConfirmation = true
} = {}) {
    const registering = mode === "register";
    accountBar.innerHTML = "";
    root.innerHTML = `
        <section class="auth-layout chef-auth-layout">
            <div class="auth-intro">
                <span class="eyebrow">CANTEEN KITCHEN</span>
                <h1>Kitchen orders.<br><span>Ready to make.</span></h1>
                <p>${registering ? "Create an account to request access to the kitchen queue." : "Sign in to see the dishes and quantities waiting to be prepared."}</p>
            </div>
            <div class="auth-card">
                <div class="auth-switch" role="group" aria-label="Chef account options">
                    <button class="switch-button ${registering ? "" : "active"}" data-view="login" type="button">Sign in</button>
                    <button class="switch-button ${registering ? "active" : ""}" data-view="register" type="button">Create account</button>
                </div>
                <h2>${registering ? "Create chef account" : "Chef sign in"}</h2>
                <p class="muted">${registering ? "The canteen owner must assign chef access after registration." : "Use the chef account provided by the canteen owner."}</p>
                ${confirmationMessage ? `<div class="auth-confirmation" role="status"><p>${escapeHtml(confirmationMessage)}</p>${showResendConfirmation ? `<button class="button button-secondary button-wide" data-action="resend-confirmation" data-email="${escapeHtml(email)}" type="button">Resend confirmation email</button>` : ""}</div>` : ""}
                <form id="auth-form" class="form-stack" data-mode="${registering ? "register" : "login"}">
                    ${registering ? `<label>Full name
                        <input name="name" autocomplete="name" maxlength="80" required>
                    </label>
                    <label>Username
                        <input name="username" autocomplete="username" minlength="3" maxlength="30" required>
                    </label>` : ""}
                    <label>Email address
                        <input name="email" type="email" autocomplete="email" value="${escapeHtml(email)}" required>
                    </label>
                    <label>Password
                        <div class="password-field">
                            <input name="password" type="password" autocomplete="${registering ? "new-password" : "current-password"}" minlength="${registering ? "8" : "1"}" required>
                            <button class="password-toggle" data-action="toggle-password" type="button" aria-label="Show password" aria-pressed="false">Show</button>
                        </div>
                    </label>
                    <button class="button button-primary button-wide" type="submit">${registering ? "Create account" : "Sign in to kitchen"}</button>
                </form>
                ${!registering ? `<button class="text-button" data-view="forgot-password" data-email="${escapeHtml(email)}" type="button">Forgot password?</button>` : ""}
                ${currentUser ? `<button class="button button-quiet button-wide" data-action="logout" type="button">Sign out</button>` : ""}
                <a class="text-button staff-return-link" href="./" data-action="switch-account" data-destination="./">Switch to customer sign in</a>
            </div>
        </section>`;
}

function renderAuth(mode = "login", {
    email = "",
    confirmationMessage = "",
    showResendConfirmation = true
} = {}) {
    if (isChefPage) {
        renderChefLogin(mode, { email, confirmationMessage, showResendConfirmation });
        return;
    }
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
                    <label>Email address
                        <input name="email" type="email" autocomplete="email" value="${escapeHtml(email)}" required>
                    </label>
                    <label>Phone number
                        <input name="phone" type="tel" autocomplete="tel" inputmode="tel" maxlength="20" required>
                    </label>
                    <label>Delivery address
                        <textarea name="delivery_address" rows="3" maxlength="250" required></textarea>
                    </label>
                    <label>Password
                        <div class="password-field">
                            <input name="password" type="password" autocomplete="new-password" minlength="8" required>
                            <button class="password-toggle" data-action="toggle-password" type="button" aria-label="Show password" aria-pressed="false">Show</button>
                        </div>
                    </label>
                    <label>Confirm password
                        <div class="password-field">
                            <input name="confirm-password" type="password" autocomplete="new-password" minlength="8" required>
                            <button class="password-toggle" data-action="toggle-password" type="button" aria-label="Show password" aria-pressed="false">Show</button>
                        </div>
                    </label>` : `
                    <label>Email address
                        <input name="email" type="email" autocomplete="email" value="${escapeHtml(email)}" autofocus required>
                    </label>
                    <label>Password
                        <div class="password-field">
                            <input name="password" type="password" autocomplete="current-password" minlength="1" required>
                            <button class="password-toggle" data-action="toggle-password" type="button" aria-label="Show password" aria-pressed="false">Show</button>
                        </div>
                    </label>`}
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
           <button class="nav-button ${view === "admin-inventory" ? "active" : ""}" data-view="admin-inventory" type="button">Inventory</button>
           <button class="nav-button ${view === "admin-menu" ? "active" : ""}" data-view="admin-menu" type="button">Manage menu</button>
           <button class="nav-button ${view === "admin-staff" ? "active" : ""}" data-view="admin-staff" type="button">Staff access</button>
           <button class="nav-button" data-action="switch-account" data-destination="./chef.html" type="button">Switch to chef</button>`
        : profile.role === "chef"
            ? `<button class="nav-button ${view === "chef-orders" ? "active" : ""}" data-view="chef-orders" type="button">Kitchen orders</button>
               <button class="nav-button ${view === "chef-menu" ? "active" : ""}" data-view="chef-menu" type="button">Menu</button>
               <button class="nav-button" data-action="switch-account" data-destination="./" type="button">Switch to customer</button>`
            : `<button class="nav-button ${view === "menu" ? "active" : ""}" data-view="menu" type="button">Menu</button>
           <button class="nav-button ${view === "cart" ? "active" : ""}" data-view="cart" type="button">Cart <span class="cart-count">${cartCount()}</span></button>
           <button class="nav-button ${view === "orders" ? "active" : ""}" data-view="orders" type="button">My orders</button>
           <button class="nav-button ${view === "profile" ? "active" : ""}" data-view="profile" type="button">Profile</button>
           <button class="nav-button" data-action="switch-account" data-destination="./chef.html" type="button">Switch to chef</button>`;
    accountBar.innerHTML = `
        <nav class="main-nav" aria-label="Main navigation">${links}</nav>
        <span class="account-name">${escapeHtml(profile.name)}</span>
        <button class="button button-quiet button-small" data-action="logout" type="button">Sign out</button>`;
}

function normalizeCartQuantity(value) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function cartCount() {
    return Object.values(cart).reduce((sum, quantity) => sum + normalizeCartQuantity(quantity), 0);
}

function renderMenu() {
    activeView = "menu";
    renderAccountBar();
    const categoryList = [...new Set(foods.map((food) => food.category || "Other"))].sort();
    const visibleFoods = [...foods]
        .filter((food) => {
            const matchesSearch = !menuSearch || (food.name || "").toLowerCase().includes(menuSearch.toLowerCase());
            const matchesCategory = activeCategory === "all" || (food.category || "Other") === activeCategory;
            return matchesSearch && matchesCategory;
        })
        .sort((a, b) => {
            if (menuSort === "price-low") return a.price - b.price;
            if (menuSort === "price-high") return b.price - a.price;
            if (menuSort === "name") return (a.name || "").localeCompare(b.name || "");
            return (a.popular ? -1 : 1) - (b.popular ? -1 : 1);
        });

    root.innerHTML = `
        <section class="page-heading">
            <div>
                <span class="eyebrow">MADE FRESH ON CAMPUS</span>
                <h1>Welcome back, ${escapeHtml(profile?.name?.split(" ")[0] || "Customer")}!</h1>
                <p>Choose your favourites and place a pickup order.</p>
            </div>
            <button class="button button-primary" data-view="cart" type="button">View cart <span class="cart-count">${cartCount()}</span></button>
        </section>
        <section class="dashboard-overview" aria-label="Customer dashboard overview">
            <article class="dashboard-card"><span>Featured</span><strong>${foods.filter((food) => food.featured).length}</strong></article>
            <article class="dashboard-card"><span>Popular</span><strong>${foods.filter((food) => food.popular).length}</strong></article>
            <article class="dashboard-card"><span>Categories</span><strong>${categoryList.length}</strong></article>
            <article class="dashboard-card"><span>Recent orders</span><strong>${profile ? "Ready" : "-"}</strong></article>
        </section>
        <section class="menu-tools" aria-label="Food filters">
            <label class="menu-search"><span class="sr-only">Search food</span><input id="food-search" type="search" placeholder="Search food by name" value="${escapeHtml(menuSearch)}"></label>
            <select id="food-sort" aria-label="Sort food by">
                <option value="featured" ${menuSort === "featured" ? "selected" : ""}>Featured</option>
                <option value="price-low" ${menuSort === "price-low" ? "selected" : ""}>Price: Low to high</option>
                <option value="price-high" ${menuSort === "price-high" ? "selected" : ""}>Price: High to low</option>
                <option value="name" ${menuSort === "name" ? "selected" : ""}>Name</option>
            </select>
        </section>
        <div class="category-pills" aria-label="Food categories">
            <button class="filter-button ${activeCategory === "all" ? "active" : ""}" data-category="all" type="button">All</button>
            ${categoryList.map((category) => `<button class="filter-button ${activeCategory === category ? "active" : ""}" data-category="${escapeHtml(category)}" type="button">${escapeHtml(category)}</button>`).join("")}
        </div>
        <section class="food-grid" aria-label="Canteen menu">
            ${visibleFoods.length ? visibleFoods.map((food) => `
                <article class="food-card ${food.is_available ? "" : "unavailable"}">
                    <div class="food-art" aria-hidden="true">${food.image_url ? `<img src="${escapeHtml(food.image_url)}" alt="${escapeHtml(food.name)}" loading="lazy">` : escapeHtml(food.emoji)}</div>
                    <div class="food-info">
                        <div class="food-meta-row"><span class="food-category">${escapeHtml(food.category || "Other")}</span>${food.is_available ? "" : '<span class="availability-pill unavailable">Unavailable</span>'}</div>
                        <h2>${escapeHtml(food.name)}</h2>
                        <p class="food-description">${escapeHtml(food.description || "Freshly prepared for pickup.")}</p>
                        <div class="food-buy">
                            <strong>${money.format(food.price)}</strong>
                            <button class="button button-add" data-action="add" data-id="${food.id}" type="button" ${food.is_available ? "" : "disabled"} aria-label="Add ${escapeHtml(food.name)} to cart">${food.is_available ? "Add" : "Sold out"}</button>
                        </div>
                    </div>
                </article>`).join("") : `<section class="empty-state"><span class="empty-icon" aria-hidden="true">⌕</span><h2>No food found</h2><p>Try another name or category filter.</p></section>`}
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

    const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const deliveryCharge = subtotal > 0 ? DELIVERY_CHARGE : 0;
    const total = subtotal + deliveryCharge;
    root.innerHTML = `
        <section class="page-heading">
            <div><span class="eyebrow">YOUR ORDER</span><h1>Your cart</h1><p>Review your items before placing your pickup order.</p></div>
            <button class="button button-secondary" data-view="menu" type="button">Continue browsing</button>
        </section>
        <div class="cart-layout">
            <section class="cart-list" aria-label="Cart items">
                ${items.map((item) => `
                    <article class="cart-item">
                        <div class="cart-item-art" aria-hidden="true">${item.image_url ? `<img src="${escapeHtml(item.image_url)}" alt="${escapeHtml(item.name)}" loading="lazy">` : escapeHtml(item.emoji)}</div>
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
                <div class="summary-line"><span>Items (${cartCount()})</span><span>${money.format(subtotal)}</span></div>
                <div class="summary-line"><span>Delivery</span><span>${money.format(deliveryCharge)}</span></div>
                <div class="summary-total"><span>Total</span><strong>${money.format(total)}</strong></div>
                <button class="button button-primary button-wide" data-action="checkout" type="button">Proceed to checkout</button>
                <p class="summary-note">Pay when you collect your order or use online payment if enabled.</p>
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
    const hasDeliveryDetails = order.delivery_address || order.phone || order.payment_method;
    const status = admin
        ? `<form class="status-form" data-order-id="${order.id}">
               <label class="sr-only" for="status-${order.id}">Update order ${order.id} status</label>
               <select id="status-${order.id}" name="status">${statuses.map((status) => `<option value="${status}" ${status === order.status ? "selected" : ""}>${status}</option>`).join("")}</select>
               <button class="button button-secondary button-small" type="submit">Save</button>
           </form>`
        : `<span class="status-pill status-${order.status.toLowerCase().replace(/\s+/g, "-")}">${escapeHtml(order.status)}</span>`;
    const actionRow = !admin && (order.status === "Pending" || order.status === "Accepted") ? `<button class="button button-secondary button-small" data-action="cancel-order" data-order-id="${order.id}" type="button">Cancel order</button>` : "";
    const reviewForm = !admin && order.status === "Delivered" ? `<form class="review-form" data-order-id="${order.id}" data-food-id="${order.order_items?.[0]?.food_id || ""}">
            <label>Rating
                <select name="rating">
                    <option value="5">5 - Excellent</option>
                    <option value="4">4 - Very good</option>
                    <option value="3">3 - Good</option>
                    <option value="2">2 - Fair</option>
                    <option value="1">1 - Poor</option>
                </select>
            </label>
            <label>Feedback
                <textarea name="comment" maxlength="250" rows="2" placeholder="Tell us how it was"></textarea>
            </label>
            <button class="button button-primary button-small" type="submit">Submit review</button>
        </form>` : "";
    return `
        <article class="order-card">
            <div class="order-topline">
                <div><span class="eyebrow">${admin ? "INCOMING ORDER" : "PICKUP ORDER"}</span><h2>Order #${escapeHtml(order.id.slice(0, 8).toUpperCase())}</h2></div>
                ${status}
            </div>
            ${customer}
            ${hasDeliveryDetails ? `<div class="customer-detail"><span>${escapeHtml(order.phone || "")}</span><span>${escapeHtml(order.delivery_address || "")}</span><span>${escapeHtml(order.payment_method || "")}</span></div>` : ""}
            <p class="order-date">${escapeHtml(new Date(order.created_at).toLocaleString())}</p>
            ${orderItemsMarkup(order.order_items)}
            <div class="order-total"><span>Total</span><strong>${money.format(order.total)}</strong></div>
            ${actionRow}
            ${reviewForm}
        </article>`;
}

function chefOrderCard(order) {
    return `
        <article class="order-card kitchen-order-card">
            <div class="order-topline">
                <div><span class="eyebrow">KITCHEN TICKET</span><h2>Order #${escapeHtml(order.id.slice(0, 8).toUpperCase())}</h2></div>
                <form class="status-form" data-order-id="${order.id}">
                    <label class="sr-only" for="chef-status-${order.id}">Update order ${order.id} status</label>
                    <select id="chef-status-${order.id}" name="status">${chefStatuses.map((status) => `<option value="${status}" ${status === order.status ? "selected" : ""}>${status}</option>`).join("")}</select>
                    <button class="button button-secondary button-small" type="submit">Save</button>
                </form>
            </div>
            <p class="order-date">Placed ${escapeHtml(new Date(order.created_at).toLocaleString())}</p>
            <ul class="order-items kitchen-items">${(order.order_items || []).map((item) => `
                <li><span>${escapeHtml(item.foods?.name || "Menu item")}</span><strong>× ${item.quantity}</strong></li>`).join("")}</ul>
        </article>`;
}

function adminOrderResultsMarkup() {
    const query = adminOrderSearch.trim().toLocaleLowerCase();
    const filteredOrders = adminOrders.filter((order) => {
        const matchesStatus = adminOrderFilter === "all" || order.status === adminOrderFilter;
        const searchableText = [
            order.id,
            order.profiles?.name,
            order.profiles?.email,
            ...(order.order_items || []).map((item) => item.foods?.name)
        ].join(" ").toLocaleLowerCase();
        return matchesStatus && (!query || searchableText.includes(query));
    });

    if (filteredOrders.length === 0) {
        const hasFilters = adminOrderFilter !== "all" || query;
        return `<div class="empty-state compact"><span class="empty-icon" aria-hidden="true">${hasFilters ? "⌕" : "✓"}</span><h2>${hasFilters ? "No matching orders" : "No orders received yet"}</h2><p>${hasFilters ? "Try a different search or status." : "New customer orders will appear here."}</p></div>`;
    }
    return `<section class="orders-list">${filteredOrders.map((order) => orderCard(order, true)).join("")}</section>`;
}

async function loadCustomerOrders() {
    activeView = "orders";
    setLoading("Loading your orders…");
    const { data, error } = await client
        .from("orders")
        .select("id,total,status,created_at,phone,delivery_address,payment_method,payment_status,order_items(quantity,unit_price,foods(name,id))")
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
    const [
        { data: orders, error: ordersError },
        { count: menuCount, error: menuError }
    ] = await Promise.all([
        client.from("orders")
            .select("id,total,status,created_at,profiles!orders_user_id_fkey(name,email),order_items(quantity,unit_price,foods(name))")
            .order("created_at", { ascending: false }),
        client.from("foods").select("id", { count: "exact", head: true }).eq("is_available", true)
    ]);
    if (ordersError) throw ordersError;
    if (menuError) throw menuError;

    adminOrders = orders;
    const now = new Date();
    const ordersToday = orders.filter((order) => {
        const createdAt = new Date(order.created_at);
        return createdAt.getFullYear() === now.getFullYear()
            && createdAt.getMonth() === now.getMonth()
            && createdAt.getDate() === now.getDate();
    });
    const activeOrders = orders.filter((order) => !["Completed", "Cancelled"].includes(order.status)).length;
    const todayOrderValue = ordersToday
        .filter((order) => order.status !== "Cancelled")
        .reduce((sum, order) => sum + Number(order.total), 0);
    renderAccountBar();
    root.innerHTML = `
        <section class="page-heading">
            <div><span class="eyebrow">CANTEEN CONTROL</span><h1>Orders dashboard</h1><p>Today’s service at a glance.</p></div>
            <button class="button button-secondary" data-action="refresh-admin" type="button">Refresh orders</button>
        </section>
        <section class="stats-grid" aria-label="Canteen statistics">
            <article class="stat-card"><span>Active orders</span><strong>${activeOrders}</strong></article>
            <article class="stat-card"><span>Orders today</span><strong>${ordersToday.length}</strong></article>
            <article class="stat-card"><span>Today's order value</span><strong>${money.format(todayOrderValue)}</strong></article>
            <article class="stat-card"><span>Available menu items</span><strong>${menuCount || 0}</strong></article>
        </section>
        <section class="orders-heading"><div><h2>Order queue</h2><p>Search by customer, order ID, or item.</p></div></section>
        <section class="admin-order-tools" aria-label="Filter orders">
            <label class="admin-order-search"><span class="sr-only">Search orders</span><input id="admin-order-search" type="search" placeholder="Search orders" value="${escapeHtml(adminOrderSearch)}"></label>
            <div class="admin-order-filters" role="group" aria-label="Filter by order status">
                ${["all", ...statuses].map((status) => `<button class="filter-button ${adminOrderFilter === status ? "active" : ""}" data-admin-filter="${status}" type="button">${status === "all" ? "All" : status}</button>`).join("")}
            </div>
        </section>
        <div id="admin-order-results">${adminOrderResultsMarkup()}</div>`;

    if (!adminRefreshTimer) {
        adminRefreshTimer = window.setInterval(() => {
            if (profile?.role === "admin" && activeView === "admin") {
                loadAdminDashboard().catch(handleError);
            } else if (profile?.role === "chef" && activeView === "chef-orders") {
                loadChefDashboard().catch(handleError);
            }
        }, 20000);
    }
}

async function loadChefDashboard() {
    if (profile?.role !== "chef") return;
    activeView = "chef-orders";
    if (!adminRefreshTimer) setLoading("Loading kitchen orders…");
    const { data: orders, error } = await client
        .from("orders")
        .select("id,status,created_at,phone,delivery_address,payment_method,payment_status,order_items(quantity,foods(name))")
        .order("created_at", { ascending: true });
    if (error) throw error;

    const activeOrders = orders.filter((order) => !["Completed", "Cancelled"].includes(order.status));
    const pendingCount = activeOrders.filter((order) => order.status === "Pending").length;
    const preparingCount = activeOrders.filter((order) => order.status === "Preparing").length;
    const readyCount = activeOrders.filter((order) => order.status === "Ready").length;
    renderAccountBar();
    root.innerHTML = `
        <section class="page-heading">
            <div><span class="eyebrow">CANTEEN KITCHEN</span><h1>Orders to prepare</h1><p>Incoming orders, oldest first.</p></div>
            <button class="button button-secondary" data-action="refresh-chef" type="button">Refresh orders</button>
        </section>
        <section class="stats-grid kitchen-stats" aria-label="Kitchen order counts">
            <article class="stat-card"><span>Waiting</span><strong>${pendingCount}</strong></article>
            <article class="stat-card"><span>Preparing</span><strong>${preparingCount}</strong></article>
            <article class="stat-card"><span>Ready for pickup</span><strong>${readyCount}</strong></article>
        </section>
        ${activeOrders.length ? `<section class="orders-list kitchen-orders" aria-label="Orders to prepare">${activeOrders.map(chefOrderCard).join("")}</section>` : `
            <section class="empty-state compact"><span class="empty-icon" aria-hidden="true">✓</span><h2>All caught up</h2><p>No orders need preparing right now.</p></section>`}`;

    if (!adminRefreshTimer) {
        adminRefreshTimer = window.setInterval(() => {
            if (profile?.role === "chef" && activeView === "chef-orders") {
                loadChefDashboard().catch(handleError);
            }
        }, 20000);
    }
}

async function loadChefMenu() {
    if (profile?.role !== "chef") return;
    activeView = "chef-menu";
    setLoading("Loading menu items…");
    const { data: menu, error } = await client
        .from("foods")
        .select("id,name,price,emoji,is_available")
        .order("name");
    if (error) throw error;

    renderAccountBar();
    root.innerHTML = `
        <section class="page-heading">
            <div><span class="eyebrow">CANTEEN KITCHEN</span><h1>Menu items</h1><p>Add a dish for customers to order.</p></div>
            <button class="button button-secondary" data-view="chef-orders" type="button">Kitchen orders</button>
        </section>
        <section class="menu-admin-layout">
            <form id="menu-add-form" class="menu-form">
                <h2>Add menu item</h2>
                <label>Food name
                    <input name="name" maxlength="80" autocomplete="off" required>
                </label>
                <label>Price (INR)
                    <input name="price" type="number" min="0" max="100000" step="1" inputmode="numeric" required>
                </label>
                <label>Starting stock
                    <input name="stock_quantity" type="number" min="0" step="1" inputmode="numeric" required>
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
                        <strong>${money.format(food.price)}</strong>
                        <button class="button button-secondary button-small" data-action="toggle-availability" data-id="${food.id}" data-available="${food.is_available}" type="button">${food.is_available ? "Mark sold out" : "Make available"}</button>
                        <details class="menu-edit">
                            <summary class="menu-edit-toggle">Edit item</summary>
                            <form class="menu-edit-form" data-food-id="${food.id}">
                                <label>Name <input name="name" value="${escapeHtml(food.name)}" maxlength="80" required></label>
                                <label>Price (INR) <input name="price" type="number" min="0" max="100000" step="1" value="${food.price}" required></label>
                                <label>Emoji <input name="emoji" value="${escapeHtml(food.emoji)}" maxlength="8" required></label>
                                <button class="button button-primary button-small" type="submit">Save changes</button>
                            </form>
                        </details></li>`).join("")}</ul>` : `<p class="muted">No menu items yet.</p>`}
            </section>
        </section>`;
}

async function loadAdminStaff() {
    if (profile?.role !== "admin") return;
    activeView = "admin-staff";
    setLoading("Loading staff access…");
    const { data: staff, error } = await client
        .from("profiles")
        .select("id,name,email,role")
        .in("role", ["student", "chef"])
        .order("name");
    if (error) throw error;

    renderAccountBar();
    root.innerHTML = `
        <section class="page-heading">
            <div><span class="eyebrow">CANTEEN CONTROL</span><h1>Staff access</h1><p>Assign kitchen access to registered accounts.</p></div>
        </section>
        <section class="staff-access-list" aria-label="Customer and chef accounts">
            ${staff.length ? staff.map((member) => `
                <article class="staff-access-row">
                    <div class="staff-identity"><strong>${escapeHtml(member.name)}</strong><span>${escapeHtml(member.email)}</span></div>
                    <form class="staff-role-form" data-profile-id="${escapeHtml(member.id)}">
                        <label>Access
                            <select name="role" aria-label="Access for ${escapeHtml(member.name)}">
                                <option value="student" ${member.role === "student" ? "selected" : ""}>Customer</option>
                                <option value="chef" ${member.role === "chef" ? "selected" : ""}>Chef</option>
                            </select>
                        </label>
                        <button class="button button-secondary button-small" type="submit">Save</button>
                    </form>
                </article>`).join("") : `<section class="empty-state compact"><span class="empty-icon" aria-hidden="true">✓</span><h2>No accounts yet</h2><p>Registered accounts will appear here.</p></section>`}
        </section>`;
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
            <div><span class="eyebrow">CANTEEN CONTROL</span><h1>Manage menu</h1><p>Add dishes and control what students can order.</p></div>
        </section>
        <section class="menu-admin-layout">
            <form id="menu-add-form" class="menu-form">
                <h2>Add a food item</h2>
                <label>Food name
                    <input name="name" maxlength="80" autocomplete="off" required>
                </label>
                <label>Price (INR)
                    <input name="price" type="number" min="0" max="100000" step="1" inputmode="numeric" required>
                </label>
                <label>Starting stock
                    <input name="stock_quantity" type="number" min="0" step="1" inputmode="numeric" required>
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
                        <strong>${money.format(food.price)}</strong>
                        <button class="button button-secondary button-small" data-action="toggle-availability" data-id="${food.id}" data-available="${food.is_available}" type="button">${food.is_available ? "Mark sold out" : "Make available"}</button>
                        <details class="menu-edit">
                            <summary class="menu-edit-toggle">Edit item</summary>
                            <form class="menu-edit-form" data-food-id="${food.id}">
                                <label>Name <input name="name" value="${escapeHtml(food.name)}" maxlength="80" required></label>
                                <label>Price (INR) <input name="price" type="number" min="0" max="100000" step="1" value="${food.price}" required></label>
                                <label>Emoji <input name="emoji" value="${escapeHtml(food.emoji)}" maxlength="8" required></label>
                                <button class="button button-primary button-small" type="submit">Save changes</button>
                            </form>
                        </details></li>`).join("")}</ul>` : `<p class="muted">No menu items yet.</p>`}
            </section>
        </section>`;
}

async function loadAdminInventory() {
    if (profile?.role !== "admin") return;
    activeView = "admin-inventory";
    setLoading("Loading canteen inventory…");
    const { data: inventory, error } = await client
        .from("foods")
        .select("id,name,price,emoji,image_url,description,category,is_available,stock_quantity")
        .order("name");
    if (error) throw error;

    const countedItems = inventory.filter((food) => food.stock_quantity !== null);
    const totalUnits = countedItems.reduce((sum, food) => sum + food.stock_quantity, 0);
    const lowStock = countedItems.filter((food) => food.stock_quantity > 0 && food.stock_quantity <= 5).length;
    const outOfStock = countedItems.filter((food) => food.stock_quantity === 0).length;
    renderAccountBar();
    root.innerHTML = `
        <section class="page-heading">
            <div><span class="eyebrow">CANTEEN CONTROL</span><h1>Inventory</h1><p>On-hand stock across your canteen menu.</p></div>
            <button class="button button-secondary" data-view="admin-menu" type="button">Manage menu</button>
        </section>
        <section class="stats-grid inventory-stats" aria-label="Inventory summary">
            <article class="stat-card"><span>Menu items</span><strong>${inventory.length}</strong></article>
            <article class="stat-card"><span>Units on hand</span><strong>${totalUnits}</strong></article>
            <article class="stat-card"><span>Low stock (1–5)</span><strong>${lowStock}</strong></article>
            <article class="stat-card"><span>Out of stock</span><strong>${outOfStock}</strong></article>
        </section>
        ${inventory.length ? `<section class="inventory-list" aria-label="Canteen stock">
            ${inventory.map((food) => {
                const status = food.stock_quantity === null
                    ? { label: "Not counted", className: "uncounted" }
                    : food.stock_quantity === 0
                        ? { label: "Out of stock", className: "out" }
                        : food.stock_quantity <= 5
                            ? { label: "Low stock", className: "low" }
                            : { label: "In stock", className: "good" };
                return `<article class="inventory-row">
                    <div class="inventory-product"><span class="menu-item-emoji" aria-hidden="true">${escapeHtml(food.emoji)}</span><div><h2>${escapeHtml(food.name)}</h2><p>${money.format(food.price)}${food.is_available ? "" : " · Not listed for ordering"}</p></div></div>
                    <div class="inventory-actions">
                        <span class="inventory-status inventory-${status.className}">${status.label}</span>
                        <form class="inventory-adjust-form" data-food-id="${food.id}">
                            <label>On hand <input name="stock_quantity" type="number" min="0" step="1" inputmode="numeric" value="${food.stock_quantity ?? ""}" aria-label="${escapeHtml(food.name)} quantity on hand" required></label>
                            <button class="button button-secondary button-small" type="submit">Save</button>
                        </form>
                    </div>
                </article>`;
            }).join("")}
        </section>` : `<section class="empty-state compact"><span class="empty-icon" aria-hidden="true">＋</span><h2>No menu items yet</h2><p>Add a dish to start tracking stock.</p><button class="button button-primary" data-view="admin-menu" type="button">Add menu item</button></section>`}`;
}

async function renderProfile() {
    activeView = "profile";
    setLoading("Loading your profile…");
    const { data, error } = await client
        .from("profiles")
        .select("id,name,email,phone,delivery_address")
        .eq("id", currentUser.id)
        .single();
    if (error) throw error;
    profile = { ...profile, ...data };
    renderAccountBar();
    root.innerHTML = `
        <section class="page-heading">
            <div><span class="eyebrow">MY PROFILE</span><h1>Account details</h1><p>Keep your contact and delivery information up to date.</p></div>
        </section>
        <section class="profile-layout">
            <form id="profile-form" class="checkout-form">
                <label>Full name
                    <input name="name" value="${escapeHtml(data.name || "")}" maxlength="80" required>
                </label>
                <label>Phone number
                    <input name="phone" value="${escapeHtml(data.phone || "")}" type="tel" inputmode="tel" maxlength="20" required>
                </label>
                <label>Delivery address
                    <textarea name="delivery_address" rows="4" maxlength="250" required>${escapeHtml(data.delivery_address || "")}</textarea>
                </label>
                <button class="button button-primary" type="submit">Save profile</button>
            </form>
            <form id="profile-password-form" class="checkout-form">
                <label>New password
                    <input name="password" type="password" minlength="8" required>
                </label>
                <label>Confirm password
                    <input name="confirm-password" type="password" minlength="8" required>
                </label>
                <button class="button button-secondary" type="submit">Update password</button>
            </form>
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
        .select("id,name,email,role,phone,delivery_address")
        .eq("id", currentUser.id)
        .single();
    if (error) throw error;
    profile = data;
    if (isChefPage && profile.role !== "chef") {
        window.clearInterval(adminRefreshTimer);
        adminRefreshTimer = undefined;
        renderChefLogin("login", {
            confirmationMessage: "This account does not have chef access. Ask the canteen owner to assign the chef role.",
            showResendConfirmation: false
        });
        return;
    }
    if (profile.role === "admin") {
        await loadAdminDashboard();
        return;
    }
    if (profile.role === "chef") {
        window.clearInterval(adminRefreshTimer);
        adminRefreshTimer = undefined;
        if (!isChefPage) {
            window.location.replace("./chef.html");
            return;
        }
        await loadChefDashboard();
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
        .select("id,name,price,emoji,image_url,description,category,is_available,featured,popular")
        .eq("is_available", true)
        .order("id");
    if (menuError) throw menuError;
    foods = menu;
    const availableFoodIds = new Set(foods.map((food) => food.id));
    cart = Object.fromEntries(Object.entries(cart).map(([id, quantity]) => [id, normalizeCartQuantity(quantity)])
        .filter(([id, quantity]) =>
            availableFoodIds.has(Number(id))
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
        const name = String(values.get("name") || "").trim();
        const phone = String(values.get("phone") || "").trim();
        const deliveryAddress = String(values.get("delivery_address") || "").trim();
        const confirmPassword = String(values.get("confirm-password") || "").trim();

        if (!name || !phone || !deliveryAddress || !email || !password) {
            showNotice("Please complete all registration fields.", "error");
            return;
        }
        if (!isValidEmail(email)) {
            showNotice("Enter a valid email address.", "error");
            return;
        }
        if (!isValidPhone(phone)) {
            showNotice("Enter a valid phone number.", "error");
            return;
        }
        if (password.length < 8) {
            showNotice("Password must be at least 8 characters long.", "error");
            return;
        }
        if (password !== confirmPassword) {
            showNotice("Passwords do not match.", "error");
            return;
        }
        if (deliveryAddress.length < 8) {
            showNotice("Please provide a complete delivery address.", "error");
            return;
        }

        const { data, error } = await client.auth.signUp({
            email,
            password,
            options: {
                data: { name, phone, delivery_address: deliveryAddress },
                emailRedirectTo: window.location.href
            }
        });
        if (error) {
            const message = error?.message || "";
            if (error?.code === "user_already_exists" || /already.*(registered|exists)|email.*exists/i.test(message)) {
                showNotice("An account with this email already exists. Please sign in or reset your password.", "error");
                return;
            }
            throw error;
        }
        if (!data.session) {
            renderAuth("login", {
                email,
                confirmationMessage: isChefPage
                    ? "Account created. Confirm your email, then ask the canteen owner to assign the chef role before you sign in."
                    : "Account created. Open the confirmation link we emailed you before signing in. Check your spam folder if it is missing."
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
    if (error) {
        const errorMessage = String(error.message || "").toLowerCase();
        if (error.status === 429 || error.code === "over_email_send_rate_limit" || errorMessage.includes("rate limit")) {
            showNotice("Supabase has temporarily limited password reset emails. Wait before trying again. If this keeps happening, configure custom SMTP in Supabase.", "error");
            return;
        }
        throw error;
    }
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

async function renderCheckout() {
    activeView = "checkout";
    if (!currentUser || !cart || Object.keys(cart).length === 0) {
        renderCart();
        showNotice("Your cart is empty. Add items before checkout.", "error");
        return;
    }

    const items = Object.entries(cart)
        .map(([id, quantity]) => {
            const food = foods.find((item) => item.id === Number(id));
            return food ? { ...food, quantity } : null;
        })
        .filter(Boolean);
    const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const deliveryCharge = subtotal > 0 ? DELIVERY_CHARGE : 0;
    const total = subtotal + deliveryCharge;

    root.innerHTML = `
        <section class="page-heading">
            <div><span class="eyebrow">CHECKOUT</span><h1>Complete your order</h1><p>Confirm delivery details and payment before placing your order.</p></div>
        </section>
        <section class="checkout-layout">
            <form id="checkout-form" class="checkout-form">
                <label>Customer name
                    <input name="name" value="${escapeHtml(profile?.name || "")}" maxlength="80" required>
                </label>
                <label>Contact number
                    <input name="phone" value="${escapeHtml(profile?.phone || "")}" type="tel" inputmode="tel" maxlength="20" required>
                </label>
                <label>Delivery address
                    <textarea name="delivery_address" rows="4" maxlength="250" required>${escapeHtml(profile?.delivery_address || "")}</textarea>
                </label>
                <label>Payment method
                    <select name="payment_method">
                        <option value="Cash on Delivery">Cash on Delivery</option>
                        <option value="Online Payment">Online Payment</option>
                    </select>
                </label>
                <button class="button button-primary button-wide" type="submit">Place order</button>
            </form>
            <aside class="summary-card">
                <h2>Order summary</h2>
                ${items.map((item) => `<div class="summary-line"><span>${escapeHtml(item.name)} × ${item.quantity}</span><span>${money.format(item.price * item.quantity)}</span></div>`).join("")}
                <div class="summary-line"><span>Subtotal</span><span>${money.format(subtotal)}</span></div>
                <div class="summary-line"><span>Delivery</span><span>${money.format(deliveryCharge)}</span></div>
                <div class="summary-total"><span>Total</span><strong>${money.format(total)}</strong></div>
            </aside>
        </section>`;
}

async function placeOrder(form) {
    const values = new FormData(form);
    const name = String(values.get("name") || "").trim();
    const phone = String(values.get("phone") || "").trim();
    const deliveryAddress = String(values.get("delivery_address") || "").trim();
    const paymentMethod = String(values.get("payment_method") || "Cash on Delivery").trim();
    const items = Object.entries(cart).map(([foodId, quantity]) => ({
        food_id: Number(foodId),
        quantity
    }));

    if (!name || !phone || !deliveryAddress) {
        showNotice("Enter your name, phone number, and delivery address before placing the order.", "error");
        return;
    }
    if (!isValidPhone(phone)) {
        showNotice("Enter a valid phone number.", "error");
        return;
    }
    if (deliveryAddress.length < 8) {
        showNotice("Enter a complete delivery address.", "error");
        return;
    }
    if (items.length === 0) {
        showNotice("Add an item before placing your order.", "error");
        return;
    }

    const { data: availableFoods, error: availabilityError } = await client
        .from("foods")
        .select("id,is_available")
        .in("id", items.map((item) => item.food_id));
    if (availabilityError) throw availabilityError;

    const unavailableItems = items.filter((item) => {
        const match = availableFoods.find((food) => food.id === item.food_id);
        return !match || !match.is_available;
    });
    if (unavailableItems.length) {
        showNotice("One or more selected items are no longer available. Please review your cart.", "error");
        return;
    }

    const { data: orderId, error } = await client.rpc("place_order", {
        p_items: items,
        p_phone: phone,
        p_delivery_address: deliveryAddress,
        p_payment_method: paymentMethod
    });
    if (error) throw error;

    const { error: profileError } = await client
        .from("profiles")
        .update({
            name,
            phone,
            delivery_address: deliveryAddress
        })
        .eq("id", currentUser.id);
    if (profileError) throw profileError;

    cart = {};
    window.localStorage.removeItem(`canteen-cart:${currentUser.id}`);
    showNotice("Order placed! The canteen has received it.", "success");
    await loadCustomerOrders();
}

async function updateOrderStatus(form) {
    const orderId = form.dataset.orderId;
    const status = new FormData(form).get("status");
    const allowedStatuses = profile?.role === "chef" ? chefStatuses : statuses;
    if (!allowedStatuses.includes(status)) {
        showNotice("Choose a valid order status.", "error");
        return;
    }
    const { error } = await client.from("orders")
        .update({ status })
        .eq("id", orderId);
    if (error) throw error;
    showNotice("Order status updated.", "success");
    if (profile?.role === "chef") {
        await loadChefDashboard();
    } else {
        await loadAdminDashboard();
    }
}

async function addMenuItem(form) {
    if (!profile || !["admin", "chef"].includes(profile.role)) return;
    const values = new FormData(form);
    const name = String(values.get("name")).trim();
    const price = Number(values.get("price"));
    const rawStockQuantity = String(values.get("stock_quantity") ?? "").trim();
    const stockQuantity = Number(rawStockQuantity);
    const emoji = String(values.get("emoji")).trim();
    const description = String(values.get("description") || "Freshly prepared for pickup.").trim();
    const category = String(values.get("category") || "Other").trim() || "Other";
    const imageUrl = String(values.get("image_url") || "").trim();
    const featured = values.get("featured") === "on";
    const popular = values.get("popular") === "on";
    if (!name || name.length > 80 || !Number.isInteger(price) || price < 0 || price > 100000 || !rawStockQuantity || !Number.isInteger(stockQuantity) || stockQuantity < 0 || !emoji) {
        showNotice("Enter a food name, a whole-number price, a stock count of zero or more, and an emoji.", "error");
        return;
    }

    const { error } = await client.from("foods").insert({ name, price, emoji, image_url: imageUrl || null, description: description || "Freshly prepared for pickup.", category, featured, popular, stock_quantity: stockQuantity });
    if (error) throw error;
    showNotice(`${name} was added to the menu.`, "success");
    if (profile.role === "chef") {
        await loadChefMenu();
    } else {
        await loadAdminMenu();
    }
}

async function updateMenuItem(form) {
    if (!profile || !["admin", "chef"].includes(profile.role)) return;
    const values = new FormData(form);
    const name = String(values.get("name") ?? "").trim();
    const price = Number(values.get("price"));
    const emoji = String(values.get("emoji") ?? "").trim();
    const description = String(values.get("description") ?? "Freshly prepared for pickup.").trim();
    const category = String(values.get("category") ?? "Other").trim() || "Other";
    const imageUrl = String(values.get("image_url") ?? "").trim();
    const featured = values.get("featured") === "on";
    const popular = values.get("popular") === "on";
    const foodId = Number(form.dataset.foodId);
    if (!name || name.length > 80 || !Number.isInteger(price) || price < 0 || price > 100000 || !emoji || !Number.isInteger(foodId)) {
        showNotice("Enter a food name, a whole-number price from 0 to 100,000, and an emoji.", "error");
        return;
    }

    const { error } = await client.from("foods")
        .update({ name, price, emoji, image_url: imageUrl || null, description: description || "Freshly prepared for pickup.", category, featured, popular })
        .eq("id", foodId);
    if (error) throw error;
    showNotice(`${name} was updated.`, "success");
    if (profile.role === "chef") {
        await loadChefMenu();
    } else {
        await loadAdminMenu();
    }
}

async function updateInventory(form) {
    if (profile?.role !== "admin") return;
    const values = new FormData(form);
    const rawQuantity = String(values.get("stock_quantity") ?? "").trim();
    const quantity = Number(rawQuantity);
    const foodId = Number(form.dataset.foodId);
    if (!rawQuantity || !Number.isInteger(quantity) || quantity < 0 || !Number.isInteger(foodId)) {
        showNotice("Enter a whole-number stock count of zero or more.", "error");
        return;
    }

    const { error } = await client.rpc("set_canteen_stock", {
        p_food_id: foodId,
        p_stock_quantity: quantity
    });
    if (error) throw error;
    showNotice("Inventory count updated.", "success");
    await loadAdminInventory();
}

async function updateStaffRole(form) {
    if (profile?.role !== "admin") return;
    const role = new FormData(form).get("role");
    const profileId = form.dataset.profileId;
    if (!["student", "chef"].includes(role) || !profileId) {
        showNotice("Choose customer or chef access.", "error");
        return;
    }
    const { error } = await client.rpc("set_canteen_staff_role", {
        p_profile_id: profileId,
        p_role: role
    });
    if (error) throw error;
    showNotice(role === "chef" ? "Chef access granted." : "Chef access removed.", "success");
    await loadAdminStaff();
}

async function setMenuAvailability(button) {
    if (!profile || !["admin", "chef"].includes(profile.role)) return;
    const foodId = Number(button.dataset.id);
    const isAvailable = button.dataset.available !== "true";
    const { error } = await client.from("foods")
        .update({ is_available: isAvailable })
        .eq("id", foodId);
    if (error) throw error;
    showNotice(isAvailable ? "Menu item is available to students." : "Menu item marked as sold out.", "success");
    if (profile.role === "chef") {
        await loadChefMenu();
    } else {
        await loadAdminMenu();
    }
}

function handleError(error) {
    console.error(error);
    showNotice(error?.message || "Something went wrong. Please try again.", "error");
}

document.addEventListener("click", async (event) => {
    const filterButton = event.target.closest("[data-admin-filter]");
    if (filterButton && profile?.role === "admin") {
        adminOrderFilter = filterButton.dataset.adminFilter;
        root.querySelectorAll("[data-admin-filter]").forEach((button) => {
            button.classList.toggle("active", button === filterButton);
        });
        root.querySelector("#admin-order-results").innerHTML = adminOrderResultsMarkup();
        return;
    }

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
        } else if (view === "profile") {
            await renderProfile().catch(handleError);
        } else if (view === "orders") {
            await loadCustomerOrders().catch(handleError);
        } else if (view === "admin" && profile?.role === "admin") {
            await loadAdminDashboard().catch(handleError);
        } else if (view === "chef-orders" && profile?.role === "chef") {
            await loadChefDashboard().catch(handleError);
        } else if (view === "chef-menu" && profile?.role === "chef") {
            await loadChefMenu().catch(handleError);
        } else if (view === "admin-inventory" && profile?.role === "admin") {
            await loadAdminInventory().catch(handleError);
        } else if (view === "admin-menu" && profile?.role === "admin") {
            await loadAdminMenu().catch(handleError);
        } else if (view === "admin-staff" && profile?.role === "admin") {
            await loadAdminStaff().catch(handleError);
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
            const currentQuantity = normalizeCartQuantity(cart[id]);
            if (currentQuantity >= 50) {
                showNotice("You can order up to 50 of each item.", "error");
                return;
            }
            cart[id] = currentQuantity + 1;
            window.localStorage.setItem(`canteen-cart:${currentUser.id}`, JSON.stringify(cart));
            renderMenu();
            showNotice("Added to your cart.", "success");
        } else if (action === "decrease") {
            const currentQuantity = normalizeCartQuantity(cart[id]);
            cart[id] = Math.max(currentQuantity - 1, 0);
            if (cart[id] === 0) delete cart[id];
            window.localStorage.setItem(`canteen-cart:${currentUser.id}`, JSON.stringify(cart));
            renderCart();
        } else if (action === "remove") {
            delete cart[id];
            window.localStorage.setItem(`canteen-cart:${currentUser.id}`, JSON.stringify(cart));
            renderCart();
            showNotice("Item removed from cart.", "success");
        } else if (action === "checkout") {
            await renderCheckout().catch(handleError);
        } else if (action === "place-order") {
            await placeOrder();
        } else if (action === "switch-account") {
            event.preventDefault();
            const destination = actionButton.dataset.destination;
            if (!destination) return;
            if (client) {
                const { data, error: sessionError } = await client.auth.getSession();
                if (sessionError) throw sessionError;
                if (data.session) {
                    const { error } = await client.auth.signOut();
                    if (error) throw error;
                }
            }
            window.location.assign(destination);
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
        } else if (action === "refresh-chef" && profile?.role === "chef") {
            await loadChefDashboard();
        } else if (action === "toggle-availability") {
            actionButton.disabled = true;
            try {
                await setMenuAvailability(actionButton);
            } finally {
                actionButton.disabled = false;
            }
        }
    } catch (error) {
        handleError(error);
    }
});

root.addEventListener("input", (event) => {
    if (event.target.id !== "admin-order-search") return;
    adminOrderSearch = event.target.value;
    root.querySelector("#admin-order-results").innerHTML = adminOrderResultsMarkup();
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
        } else if (form.id === "profile-form") {
            const submitButton = form.querySelector('button[type="submit"]');
            submitButton.disabled = true;
            try {
                await updateCustomerProfile(form);
            } finally {
                submitButton.disabled = false;
            }
        } else if (form.id === "profile-password-form") {
            const submitButton = form.querySelector('button[type="submit"]');
            submitButton.disabled = true;
            try {
                await updateCustomerPassword(form);
            } finally {
                submitButton.disabled = false;
            }
        } else if (form.matches(".staff-role-form")) {
            const submitButton = form.querySelector('button[type="submit"]');
            submitButton.disabled = true;
            try {
                await updateStaffRole(form);
            } finally {
                submitButton.disabled = false;
            }
        } else if (form.matches(".status-form")) {
            await updateOrderStatus(form);
        } else if (form.matches(".inventory-adjust-form")) {
            const submitButton = form.querySelector('button[type="submit"]');
            submitButton.disabled = true;
            try {
                await updateInventory(form);
            } finally {
                submitButton.disabled = false;
            }
        } else if (form.matches(".menu-edit-form")) {
            const submitButton = form.querySelector('button[type="submit"]');
            submitButton.disabled = true;
            try {
                await updateMenuItem(form);
            } finally {
                submitButton.disabled = false;
            }
        } else if (form.id === "menu-add-form") {
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

async function updateCustomerProfile(form) {
    const values = new FormData(form);
    const name = String(values.get("name") || "").trim();
    const phone = String(values.get("phone") || "").trim();
    const deliveryAddress = String(values.get("delivery_address") || "").trim();

    if (!name || !phone || !deliveryAddress) {
        showNotice("Fill in your name, phone number, and delivery address.", "error");
        return;
    }
    if (!isValidPhone(phone)) {
        showNotice("Enter a valid phone number.", "error");
        return;
    }

    const { error } = await client
        .from("profiles")
        .update({
            name,
            phone,
            delivery_address: deliveryAddress
        })
        .eq("id", currentUser.id);

    if (error) throw error;
    profile = { ...profile, name, phone, delivery_address: deliveryAddress };
    showNotice("Profile updated successfully.", "success");
    await renderProfile();
}

async function updateCustomerPassword(form) {
    const values = new FormData(form);
    const password = String(values.get("password") || "");
    const confirmPassword = String(values.get("confirm-password") || "");

    if (!password || password.length < 8) {
        showNotice("Choose a password with at least 8 characters.", "error");
        return;
    }
    if (password !== confirmPassword) {
        showNotice("Passwords do not match.", "error");
        return;
    }

    const { error } = await client.auth.updateUser({ password });
    if (error) throw error;
    showNotice("Password updated successfully.", "success");
    form.reset();
}

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

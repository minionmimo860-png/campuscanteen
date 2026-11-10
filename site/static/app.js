import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const config = window.CANTEEN_CONFIG || {};
const isAdminPage = document.body.dataset.page === "admin";
const root = document.querySelector("#app");
const accountBar = document.querySelector("#account-bar");
const notice = document.querySelector("#notice");
const statuses = ["Pending", "Accepted", "Preparing", "Ready", "Ready for Pickup", "Out for Delivery", "Delivered", "Completed", "Cancelled"];
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
let adminCustomerSearch = "";
let adminPaymentFilter = "all";
let adminReviewFilter = "all";
let adminFoodSearch = "";
let adminFoodCategory = "all";
let adminOrderDate = "";
let adminReportStart = "";
let adminReportEnd = "";
let adminDashboardCharts = [];
let adminSearchTimer;
let adminOrderNotificationsInitialized = false;
const adminSeenOrderIds = new Set();

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

function renderAdminLogin({ confirmationMessage = "" } = {}) {
    accountBar.innerHTML = "";
    root.innerHTML = `
        <section class="admin-login-layout">
            <div class="admin-login-intro">
                <span class="eyebrow">CAMPUS CANTEEN · ADMINISTRATION</span>
                <h1>Run the canteen<br><span>with confidence.</span></h1>
                <p>Manage your menu, monitor orders, and keep service running smoothly.</p>
            </div>
            <div class="auth-card admin-login-card">
                <span class="admin-login-mark" aria-hidden="true">C</span>
                <h2>Administrator sign in</h2>
                <p class="muted">Use your designated administrator account.</p>
                ${confirmationMessage ? `<div class="auth-confirmation" role="status"><p>${escapeHtml(confirmationMessage)}</p></div>` : ""}
                <form id="auth-form" class="form-stack" data-mode="login">
                    <label>Email address
                        <input name="email" type="email" autocomplete="username" required>
                    </label>
                    <label>Password
                        <div class="password-field">
                            <input name="password" type="password" autocomplete="current-password" required>
                            <button class="password-toggle" data-action="toggle-password" type="button" aria-label="Show password" aria-pressed="false">Show</button>
                        </div>
                    </label>
                    <button class="button button-primary button-wide" type="submit">Sign in to admin</button>
                </form>
                ${currentUser ? `<button class="button button-quiet button-wide" data-action="logout" type="button">Sign out of this account</button>` : ""}
                <a class="staff-return-link admin-login-return" href="./">Return to customer sign in</a>
            </div>
        </section>`;
}

function renderAuth(mode = "login", {
    email = "",
    confirmationMessage = "",
    showResendConfirmation = true
} = {}) {
    if (isAdminPage) {
        renderAdminLogin({ confirmationMessage });
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
                ${!registering ? `<button class="text-button" data-view="chef-login" type="button">Chef sign in</button>` : ""}
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
    if (isAdminPage) {
        accountBar.innerHTML = "";
        return;
    }
    if (!currentUser || !profile) {
        accountBar.innerHTML = "";
        return;
    }

    const links = profile.role === "admin"
        ? `<button class="nav-button ${view === "admin" ? "active" : ""}" data-view="admin" type="button">Orders dashboard</button>
           <button class="nav-button ${view === "admin-inventory" ? "active" : ""}" data-view="admin-inventory" type="button">Inventory</button>
           <button class="nav-button ${view === "admin-menu" ? "active" : ""}" data-view="admin-menu" type="button">Manage menu</button>
           <button class="nav-button ${view === "admin-staff" ? "active" : ""}" data-view="admin-staff" type="button">Staff access</button>
           <a class="nav-button" href="./chef.html">Open admin portal</a>`
        : profile.role === "chef"
            ? `<button class="nav-button ${view === "chef-orders" ? "active" : ""}" data-view="chef-orders" type="button">Kitchen orders</button>
               <button class="nav-button ${view === "chef-menu" ? "active" : ""}" data-view="chef-menu" type="button">Menu</button>`
            : `<button class="nav-button ${view === "menu" ? "active" : ""}" data-view="menu" type="button">Menu</button>
           <button class="nav-button ${view === "cart" ? "active" : ""}" data-view="cart" type="button">Cart <span class="cart-count">${cartCount()}</span></button>
           <button class="nav-button ${view === "orders" ? "active" : ""}" data-view="orders" type="button">My orders</button>
           <button class="nav-button ${view === "profile" ? "active" : ""}" data-view="profile" type="button">Profile</button>`;
    accountBar.innerHTML = `
        <nav class="main-nav" aria-label="Main navigation">${links}</nav>
        <span class="account-name">${escapeHtml(profile.name)}</span>
        <button class="button button-quiet button-small" data-action="logout" type="button">Sign out</button>`;
}

function renderAdminPortal(view, heading, content) {
    accountBar.innerHTML = "";
    adminDashboardCharts.forEach((chart) => chart.destroy());
    adminDashboardCharts = [];
    const navigation = [
        ["admin", "▦", "Dashboard"],
        ["admin-menu", "◈", "Food management"],
        ["admin-categories", "◉", "Categories"],
        ["admin-staff", "♧", "Staff access"],
        ["admin-orders", "▤", "Orders"],
        ["admin-customers", "♙", "Customers"],
        ["admin-payments", "◌", "Payments"],
        ["admin-inventory", "▣", "Inventory"],
        ["admin-reviews", "☆", "Reviews"],
        ["admin-reports", "▥", "Reports"],
        ["admin-settings", "⚙", "Settings"]
    ];
    root.innerHTML = `
        <div class="admin-portal">
            <aside class="admin-sidebar">
                <a class="admin-sidebar-brand" href="./chef.html"><span class="brand-mark">C</span><span>Campus Canteen<small>ADMIN CONSOLE</small></span></a>
                <nav aria-label="Admin navigation">
                    <span class="admin-nav-label">WORKSPACE</span>
                    ${navigation.map(([key, icon, label]) => `<button class="admin-nav-link ${view === key ? "active" : ""}" data-view="${key}" type="button"><span aria-hidden="true">${icon}</span>${label}</button>`).join("")}
                </nav>
                <div class="admin-sidebar-bottom">
                    <div class="admin-sidebar-user"><span class="admin-user-avatar">${escapeHtml((profile?.name || "A").slice(0, 1).toUpperCase())}</span><span><strong>${escapeHtml(profile?.name || "Administrator")}</strong><small>Administrator</small></span></div>
                    <button class="admin-nav-link admin-logout" data-action="logout" type="button"><span aria-hidden="true">↪</span>Sign out</button>
                </div>
            </aside>
            <section class="admin-workspace">
                <header class="admin-topbar"><div><span class="admin-mobile-label">CAMPUS CANTEEN</span><h1>${escapeHtml(heading)}</h1></div><div class="admin-topbar-user"><span class="admin-online-dot"></span>Admin workspace</div></header>
                <main class="admin-content">${content}</main>
            </section>
        </div>`;
}

function normalizeCartQuantity(value) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function cartCount() {
    return Object.values(cart).reduce((sum, quantity) => sum + normalizeCartQuantity(quantity), 0);
}

function notifyAdminOfNewOrders(orders) {
    if (!adminOrderNotificationsInitialized) {
        orders.forEach((order) => adminSeenOrderIds.add(order.id));
        adminOrderNotificationsInitialized = true;
        return;
    }

    const newOrders = orders.filter((order) => !adminSeenOrderIds.has(order.id));
    orders.forEach((order) => adminSeenOrderIds.add(order.id));
    if (!newOrders.length) return;

    const latestOrder = newOrders[0];
    const customerName = latestOrder.profiles?.name || "A customer";
    const orderLabel = latestOrder.id.slice(0, 8).toUpperCase();
    showNotice(
        newOrders.length === 1
            ? `New order from ${customerName} (#${orderLabel}). Open Orders to review it.`
            : `${newOrders.length} new orders received. Latest: ${customerName} (#${orderLabel}).`,
        "success"
    );
}

async function checkForNewAdminOrders() {
    if (profile?.role !== "admin") return;
    const { data: orders, error } = await client
        .from("orders")
        .select("id,created_at,profiles!orders_user_id_fkey(name)")
        .order("created_at", { ascending: false })
        .limit(100);
    if (error) throw error;
    notifyAdminOfNewOrders(orders);
}

function renderMenu() {
    activeView = "menu";
    renderAccountBar();
    const categoryList = [...new Set(foods.map((food) => food.category || "Other"))].sort();
    const categoryIcons = {
        all: "🥗",
        burger: "🍔",
        dessert: "🍰",
        fruit: "🥑",
        fruits: "🥑",
        meat: "🥩",
        pasta: "🍝",
        pastas: "🍝",
        pizza: "🍕",
        pizzas: "🍕",
        salad: "🥗",
        sandwich: "🥪",
        sandwiches: "🥪",
        sushi: "🍣"
    };
    const categoryIcon = (category) => categoryIcons[category.toLowerCase()] || "🍽️";
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
    const cartItems = Object.entries(cart)
        .map(([id, quantity]) => {
            const food = foods.find((item) => item.id === Number(id));
            return food ? { ...food, quantity: normalizeCartQuantity(quantity) } : null;
        })
        .filter((item) => item && item.quantity > 0);
    const subtotal = cartItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const deliveryCharge = subtotal > 0 ? DELIVERY_CHARGE : 0;
    const total = subtotal + deliveryCharge;
    const initials = (profile?.name || "Customer")
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0].toUpperCase())
        .join("");

    root.innerHTML = `
        <div class="customer-dashboard-layout">
            <section class="customer-menu-panel" aria-label="Canteen menu">
                <div class="customer-menu-toolbar">
                    <div class="customer-menu-title">
                        <span class="eyebrow">MADE FRESH ON CAMPUS</span>
                        <h1>Order something</h1>
                    </div>
                    <div class="customer-menu-controls">
                        <label class="menu-search"><span class="search-icon" aria-hidden="true">⌕</span><span class="sr-only">Search food</span><input id="food-search" type="search" placeholder="Search dishes" value="${escapeHtml(menuSearch)}"></label>
                        <label class="sr-only" for="food-sort">Sort food by</label>
                        <select id="food-sort" aria-label="Sort food by">
                            <option value="featured" ${menuSort === "featured" ? "selected" : ""}>Featured</option>
                            <option value="price-low" ${menuSort === "price-low" ? "selected" : ""}>Price: Low to high</option>
                            <option value="price-high" ${menuSort === "price-high" ? "selected" : ""}>Price: High to low</option>
                            <option value="name" ${menuSort === "name" ? "selected" : ""}>Name</option>
                        </select>
                    </div>
                </div>
                <div class="category-pills" role="group" aria-label="Food categories">
                    <button class="filter-button ${activeCategory === "all" ? "active" : ""}" data-category="all" type="button"><span aria-hidden="true">${categoryIcon("all")}</span>All</button>
                    ${categoryList.map((category) => `<button class="filter-button ${activeCategory === category ? "active" : ""}" data-category="${escapeHtml(category)}" type="button"><span aria-hidden="true">${categoryIcon(category)}</span>${escapeHtml(category)}</button>`).join("")}
                </div>
                <div class="menu-section-heading"><h2>${menuSort === "featured" && activeCategory === "all" && !menuSearch ? "Popular dishes" : "Explore the menu"}</h2><span class="menu-result-count">${visibleFoods.length} ${visibleFoods.length === 1 ? "dish" : "dishes"}</span></div>
                <section class="food-grid" aria-label="Canteen menu">
                    ${visibleFoods.length ? visibleFoods.map((food) => `
                        <article class="food-card ${food.is_available ? "" : "unavailable"}">
                            <div class="food-art" aria-hidden="true">${food.image_url ? `<img src="${escapeHtml(food.image_url)}" alt="" loading="lazy">` : `<span>${escapeHtml(food.emoji)}</span>`}</div>
                            <div class="food-info">
                                <div class="food-meta-row"><span class="food-category">${escapeHtml(food.category || "Other")}</span>${food.is_available ? "" : '<span class="availability-pill unavailable">Unavailable</span>'}</div>
                                <h2>${escapeHtml(food.name)}</h2>
                                <p class="food-description">${escapeHtml(food.description || "Freshly prepared for pickup.")}</p>
                                <div class="food-buy">
                                    <strong>${money.format(food.price)}</strong>
                                    <button class="button button-add" data-action="add" data-id="${food.id}" type="button" ${food.is_available ? "" : "disabled"} aria-label="Add ${escapeHtml(food.name)} to cart">${cart[food.id] ? `Added · ${normalizeCartQuantity(cart[food.id])}` : "Add +"}</button>
                                </div>
                            </div>
                        </article>`).join("") : `<section class="empty-state"><span class="empty-icon" aria-hidden="true">⌕</span><h2>No food found</h2><p>Try another name or category filter.</p></section>`}
                </section>
            </section>
            <aside class="customer-order-panel" aria-label="Your order">
                <div class="customer-profile">
                    <span class="customer-avatar" aria-hidden="true">${escapeHtml(initials)}</span>
                    <span class="customer-profile-name">${escapeHtml(profile?.name || "Customer")}</span>
                    <button class="order-cart-count" data-view="cart" type="button" aria-label="Open cart with ${cartCount()} items"><span aria-hidden="true">▣</span><span class="cart-count">${cartCount()}</span></button>
                </div>
                <div class="customer-order-heading"><h2>My order</h2><button class="text-icon-button" data-view="cart" type="button" aria-label="Edit your order">✎</button></div>
                ${cartItems.length ? `<ul class="customer-order-items">
                    ${cartItems.map((item) => `
                        <li>
                            <span class="order-item-art" aria-hidden="true">${item.image_url ? `<img src="${escapeHtml(item.image_url)}" alt="" loading="lazy">` : escapeHtml(item.emoji)}</span>
                            <span class="customer-order-item-name"><strong>${escapeHtml(item.name)}</strong><span>${item.quantity} × ${money.format(item.price)}</span></span>
                            <span class="customer-order-item-total">${money.format(item.price * item.quantity)}</span>
                            <span class="customer-order-quantity" aria-label="Quantity for ${escapeHtml(item.name)}">
                                <button data-action="decrease" data-id="${item.id}" type="button" aria-label="Decrease ${escapeHtml(item.name)} quantity">−</button>
                                <span>${item.quantity}</span>
                                <button data-action="increase" data-id="${item.id}" type="button" aria-label="Increase ${escapeHtml(item.name)} quantity">+</button>
                            </span>
                        </li>`).join("")}
                </ul>` : `<div class="customer-order-empty"><span aria-hidden="true">＋</span><p>Your order is empty.</p><span>Add a dish to get started.</span></div>`}
                <div class="customer-order-summary">
                    <div class="summary-line"><span>Subtotal</span><span>${money.format(subtotal)}</span></div>
                    <div class="summary-line"><span>Delivery</span><span>${money.format(deliveryCharge)}</span></div>
                    <div class="summary-total"><span>Total amount</span><strong>${money.format(total)}</strong></div>
                    <button class="button button-primary button-wide customer-checkout" data-action="checkout" type="button" ${cartItems.length ? "" : "disabled"}>Checkout</button>
                    <p class="summary-note">Review your delivery details at checkout.</p>
                </div>
            </aside>
        </div>`;
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
    const nextStatus = {
        Pending: "Accepted",
        Accepted: "Preparing",
        Preparing: "Ready for Pickup"
    }[order.status];
    return `
        <article class="order-card kitchen-order-card">
            <div class="order-topline">
                <div><span class="eyebrow">KITCHEN TICKET</span><h2>Order #${escapeHtml(order.id.slice(0, 8).toUpperCase())}</h2></div>
                ${nextStatus ? `<form class="status-form" data-order-id="${escapeHtml(order.id)}"><input type="hidden" name="status" value="${nextStatus}"><button class="button button-primary button-small" type="submit">${nextStatus === "Accepted" ? "Accept order" : nextStatus === "Preparing" ? "Start preparing" : "Mark ready"}</button></form>` : `<span class="status-pill">${escapeHtml(order.status)}</span>`}
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
    if (!adminRefreshTimer) setLoading("Loading admin dashboard…");
    const [
        { data: orders, error: ordersError },
        { count: foodCount, error: menuError },
        { data: customers, error: customerError }
    ] = await Promise.all([
        client.from("orders")
            .select("id,total,status,created_at,payment_status,profiles!orders_user_id_fkey(name,email),order_items(quantity,unit_price,foods(name))")
            .order("created_at", { ascending: false }),
        client.from("foods").select("id", { count: "exact", head: true }),
        client.from("profiles").select("id,name,email,created_at,phone").eq("role", "student").order("created_at", { ascending: false })
    ]);
    if (ordersError) throw ordersError;
    if (menuError) throw menuError;
    if (customerError) throw customerError;

    notifyAdminOfNewOrders(orders);
    adminOrders = orders;
    const now = new Date();
    const ordersToday = orders.filter((order) => {
        const createdAt = new Date(order.created_at);
        return createdAt.getFullYear() === now.getFullYear()
            && createdAt.getMonth() === now.getMonth()
            && createdAt.getDate() === now.getDate();
    });
    const pendingCount = orders.filter((order) => order.status === "Pending").length;
    const completedCount = orders.filter((order) => ["Delivered", "Completed"].includes(order.status)).length;
    const cancelledCount = orders.filter((order) => order.status === "Cancelled").length;
    const revenueOrders = orders.filter((order) => ["Delivered", "Completed"].includes(order.status) && order.payment_status === "Paid");
    const revenue = revenueOrders.reduce((sum, order) => sum + Number(order.total), 0);
    const inPeriod = (date, days) => now - new Date(date) < days * 24 * 60 * 60 * 1000 && new Date(date) <= now;
    const paidToday = revenueOrders.filter((order) => {
        const date = new Date(order.created_at);
        return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
    }).reduce((sum, order) => sum + Number(order.total), 0);
    const paidWeek = revenueOrders.filter((order) => inPeriod(order.created_at, 7)).reduce((sum, order) => sum + Number(order.total), 0);
    const paidMonth = revenueOrders.filter((order) => {
        const date = new Date(order.created_at);
        return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
    }).reduce((sum, order) => sum + Number(order.total), 0);
    const statusCounts = statuses.map((status) => orders.filter((order) => order.status === status).length);
    const popularItems = new Map();
    for (const order of orders.filter((item) => item.status !== "Cancelled")) {
        for (const item of order.order_items || []) {
            const name = item.foods?.name || "Menu item";
            popularItems.set(name, (popularItems.get(name) || 0) + Number(item.quantity));
        }
    }
    const popularRows = [...popularItems.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    const dailyLabels = Array.from({ length: 7 }, (_, index) => {
        const date = new Date(now);
        date.setDate(now.getDate() - (6 - index));
        return date;
    });
    const dailyRevenue = dailyLabels.map((date) => revenueOrders.filter((order) => {
        const orderDate = new Date(order.created_at);
        return orderDate.getFullYear() === date.getFullYear()
            && orderDate.getMonth() === date.getMonth()
            && orderDate.getDate() === date.getDate();
    }).reduce((sum, order) => sum + Number(order.total), 0));
    const chartLabels = dailyLabels.map((date) => date.toLocaleDateString(undefined, { weekday: "short" }));
    adminDashboardCharts.forEach((chart) => chart.destroy());
    adminDashboardCharts = [];
    renderAdminPortal("admin", "Dashboard", `
        <div class="admin-page-heading"><div><span class="admin-kicker">OVERVIEW</span><h2>Good ${now.getHours() < 12 ? "morning" : now.getHours() < 18 ? "afternoon" : "evening"}, ${escapeHtml(profile?.name?.split(" ")[0] || "Admin")}</h2><p>Here’s what’s happening at your canteen today.</p></div><button class="button button-secondary" data-action="refresh-admin" type="button">↻ Refresh</button></div>
        <section class="admin-summary-grid" aria-label="Business summary">
            ${[
                ["Customers", customers.length, "♙", "Registered accounts"],
                ["Food items", foodCount || 0, "◈", "Across your menu"],
                ["Total orders", orders.length, "▤", `${ordersToday.length} placed today`],
                ["Pending orders", pendingCount, "◷", "Need attention"],
                ["Completed", completedCount, "✓", "Delivered orders"],
                ["Cancelled", cancelledCount, "×", "Cancelled orders"],
                ["Total revenue", money.format(revenue), "₹", "Paid, completed orders"]
            ].map(([label, value, icon, caption]) => `<article class="admin-summary-card"><span class="admin-summary-icon">${icon}</span><div><span>${label}</span><strong>${value}</strong><small>${caption}</small></div></article>`).join("")}
        </section>
        <section class="admin-revenue-strip" aria-label="Revenue periods">
            <article><span>Today</span><strong>${money.format(paidToday)}</strong></article>
            <article><span>Last 7 days</span><strong>${money.format(paidWeek)}</strong></article>
            <article><span>This month</span><strong>${money.format(paidMonth)}</strong></article>
            <p>Revenue includes paid orders that have been delivered or completed.</p>
        </section>
        <section class="admin-chart-grid">
            <article class="admin-panel admin-chart-panel"><div class="admin-panel-heading"><div><h3>Revenue overview</h3><p>Paid, completed sales · last 7 days</p></div></div><div class="admin-chart-wrap"><canvas id="admin-revenue-chart" aria-label="Daily revenue chart" role="img"></canvas></div></article>
            <article class="admin-panel admin-chart-panel"><div class="admin-panel-heading"><div><h3>Order status</h3><p>Current order distribution</p></div></div><div class="admin-chart-wrap admin-doughnut-wrap"><canvas id="admin-status-chart" aria-label="Order status chart" role="img"></canvas></div></article>
        </section>
        <section class="admin-dashboard-lower">
            <article class="admin-panel"><div class="admin-panel-heading"><div><h3>Popular food items</h3><p>Units in non-cancelled orders</p></div><button class="admin-inline-link" data-view="admin-menu" type="button">Manage menu →</button></div>${popularRows.length ? `<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Food item</th><th>Units</th></tr></thead><tbody>${popularRows.map(([name, quantity]) => `<tr><td>${escapeHtml(name)}</td><td>${quantity}</td></tr>`).join("")}</tbody></table></div>` : `<p class="admin-empty-note">Food sales will appear here as orders come in.</p>`}</article>
            <article class="admin-panel"><div class="admin-panel-heading"><div><h3>Recent registrations</h3><p>Newest customer accounts</p></div><button class="admin-inline-link" data-view="admin-customers" type="button">View customers →</button></div>${customers.length ? `<div class="admin-recent-list">${customers.slice(0, 5).map((customer) => `<div><span class="admin-user-avatar">${escapeHtml((customer.name || "C").slice(0, 1).toUpperCase())}</span><span><strong>${escapeHtml(customer.name)}</strong><small>${escapeHtml(customer.email)}</small></span><time>${escapeHtml(new Date(customer.created_at).toLocaleDateString())}</time></div>`).join("")}</div>` : `<p class="admin-empty-note">No customer accounts yet.</p>`}</article>
        </section>
        <section class="admin-panel admin-recent-orders"><div class="admin-panel-heading"><div><h3>Recent orders</h3><p>Latest activity from the canteen</p></div><button class="admin-inline-link" data-view="admin-orders" type="button">View all orders →</button></div>${orders.length ? `<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Order</th><th>Customer</th><th>Date</th><th>Total</th><th>Status</th></tr></thead><tbody>${orders.slice(0, 6).map((order) => `<tr><td>#${escapeHtml(order.id.slice(0, 8).toUpperCase())}</td><td>${escapeHtml(order.profiles?.name || "Customer")}</td><td>${escapeHtml(new Date(order.created_at).toLocaleDateString())}</td><td>${money.format(order.total)}</td><td><span class="admin-status-badge">${escapeHtml(order.status)}</span></td></tr>`).join("")}</tbody></table></div>` : `<p class="admin-empty-note">New orders will appear here.</p>`}</section>`);

    let ChartConstructor = window.Chart;
    if (!ChartConstructor) {
        try {
            ({ Chart: ChartConstructor } = await import("https://cdn.jsdelivr.net/npm/chart.js@4.4.7/+esm"));
        } catch (error) {
            console.error(error);
            showNotice("Charts could not load. Check your connection and refresh the admin dashboard.", "error");
        }
    }
    if (ChartConstructor) {
        const revenueCanvas = root.querySelector("#admin-revenue-chart");
        const statusCanvas = root.querySelector("#admin-status-chart");
        if (revenueCanvas && statusCanvas) {
            adminDashboardCharts = [
                new ChartConstructor(revenueCanvas, {
                    type: "line",
                    data: { labels: chartLabels, datasets: [{ label: "Revenue", data: dailyRevenue, borderColor: "#168a61", backgroundColor: "rgba(22,138,97,.12)", fill: true, tension: .35, pointRadius: 3, pointBackgroundColor: "#168a61" }] },
                    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { callback: (value) => money.format(value) }, grid: { color: "#eff2ee" } }, x: { grid: { display: false } } } }
                }),
                new ChartConstructor(statusCanvas, {
                    type: "doughnut",
                    data: { labels: statuses, datasets: [{ data: statusCounts, backgroundColor: ["#e7b54a", "#88a6e8", "#9d8bd8", "#4aaf81", "#6dbbc1", "#679b79", "#de7b74"], borderWidth: 0 }] },
                    options: { responsive: true, maintainAspectRatio: false, cutout: "68%", plugins: { legend: { position: "bottom", labels: { usePointStyle: true, boxWidth: 8, padding: 12 } } } }
                })
            ];
        }
    }

    if (!adminRefreshTimer) {
        adminRefreshTimer = window.setInterval(() => {
            if (profile?.role === "admin") {
                if (activeView === "admin") {
                    loadAdminDashboard().catch(handleError);
                } else {
                    checkForNewAdminOrders().catch(handleError);
                }
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

function adminOrderTableMarkup() {
    const query = adminOrderSearch.trim().toLocaleLowerCase();
    const filteredOrders = adminOrders.filter((order) => {
        const searchable = [order.id, order.profiles?.name, order.profiles?.email, order.phone, order.payment_method]
            .concat((order.order_items || []).map((item) => item.foods?.name))
            .join(" ").toLocaleLowerCase();
        const matchesStatus = adminOrderFilter === "all" || order.status === adminOrderFilter;
        const matchesSearch = !query || searchable.includes(query);
        const matchesDate = !adminOrderDate || new Date(order.created_at).toISOString().slice(0, 10) === adminOrderDate;
        return matchesStatus && matchesSearch && matchesDate;
    });
    if (!filteredOrders.length) return `<div class="admin-empty-note">No orders match these filters.</div>`;
    const nextStatuses = {
        Pending: ["Accepted", "Cancelled"],
        Accepted: ["Preparing", "Cancelled"],
        Preparing: ["Ready for Pickup"],
        Ready: ["Out for Delivery", "Delivered"],
        "Ready for Pickup": ["Out for Delivery", "Delivered"],
        "Out for Delivery": ["Delivered"]
    };
    return `<div class="admin-table-wrap"><table class="admin-table admin-orders-table">
        <thead><tr><th>Order / placed</th><th>Customer / contact</th><th>Items</th><th>Total / payment</th><th>Status</th><th>Update status</th></tr></thead>
        <tbody>${filteredOrders.map((order) => {
            const choices = nextStatuses[order.status] || [];
            return `<tr>
                <td><strong>#${escapeHtml(order.id.slice(0, 8).toUpperCase())}</strong><small>${escapeHtml(new Date(order.created_at).toLocaleString())}</small></td>
                <td><strong>${escapeHtml(order.profiles?.name || "Customer")}</strong><small>${escapeHtml(order.phone || order.profiles?.email || "")}</small><details class="admin-order-details"><summary>Contact & address</summary><div><span>${escapeHtml(order.profiles?.email || "")}</span><span>${escapeHtml(order.delivery_address || "No delivery address")}</span></div></details></td>
                <td><details class="admin-order-details"><summary>${(order.order_items || []).reduce((sum, item) => sum + Number(item.quantity), 0)} item(s)</summary><div>${(order.order_items || []).map((item) => `<span>${escapeHtml(item.foods?.name || "Menu item")} × ${item.quantity}</span>`).join("")}</div></details></td>
                <td><strong>${money.format(order.total)}</strong><small>${escapeHtml(order.payment_method || "Payment not specified")} · ${escapeHtml(order.payment_status || "Pending")}</small></td>
                <td><span class="admin-status-badge">${escapeHtml(order.status)}</span></td>
                <td>${choices.length ? `<form class="admin-order-form" data-order-id="${escapeHtml(order.id)}"><select name="status" aria-label="Change status for order ${escapeHtml(order.id.slice(0, 8))}" required><option value="">Choose action…</option>${choices.map((status) => `<option value="${status}">${status}</option>`).join("")}</select><input name="cancellation_reason" maxlength="300" placeholder="Reason if cancelling" aria-label="Cancellation reason" hidden><button class="button button-primary button-small" type="submit">Update</button></form>` : `<span class="muted">No further actions</span>`}</td>
            </tr>${order.status === "Cancelled" && order.cancellation_reason ? `<tr class="admin-cancellation-row"><td colspan="6"><strong>Cancellation reason:</strong> ${escapeHtml(order.cancellation_reason)}</td></tr>` : ""}`;
        }).join("")}</tbody>
    </table></div>`;
}

async function loadAdminOrders() {
    activeView = "admin-orders";
    setLoading("Loading orders…");
    const { data, error } = await client.from("orders")
        .select("id,total,status,created_at,phone,delivery_address,payment_method,payment_status,cancellation_reason,profiles!orders_user_id_fkey(name,email),order_items(quantity,unit_price,foods(name))")
        .order("created_at", { ascending: false });
    if (error) throw error;
    adminOrders = data;
    renderAdminPortal("admin-orders", "Orders", `
        <div class="admin-page-heading"><div><span class="admin-kicker">ORDER MANAGEMENT</span><h2>All orders</h2><p>Review order details and move orders through the service workflow.</p></div><button class="button button-secondary" data-action="refresh-admin-orders" type="button">↻ Refresh</button></div>
        <section class="admin-panel admin-filter-panel"><div class="admin-filter-controls">
            <label class="admin-order-search"><span class="sr-only">Search orders</span><input id="admin-order-search" type="search" placeholder="Search ID, customer, phone or item" value="${escapeHtml(adminOrderSearch)}"></label>
            <label class="admin-date-filter">Order date<input id="admin-order-date" type="date" value="${escapeHtml(adminOrderDate)}"></label>
        </div><div class="admin-order-filters" role="group" aria-label="Filter by order status">${["all", ...statuses].map((status) => `<button class="filter-button ${adminOrderFilter === status ? "active" : ""}" data-admin-filter="${status}" type="button">${status === "all" ? "All" : status}</button>`).join("")}</div></section>
        <section class="admin-panel"><div class="admin-panel-heading"><div><h3>Order queue</h3><p>${data.length} total orders · Cancellation requires a reason.</p></div></div><div id="admin-order-table-results">${adminOrderTableMarkup()}</div></section>`);
}

async function loadAdminCustomers() {
    activeView = "admin-customers";
    setLoading("Loading customers…");
    const [{ data: customers, error: customerError }, { data: orders, error: orderError }] = await Promise.all([
        client.from("profiles").select("id,name,email,username,phone,delivery_address,created_at").eq("role", "student").order("created_at", { ascending: false }),
        client.from("orders").select("id,user_id,total,status,created_at,payment_method,payment_status").order("created_at", { ascending: false })
    ]);
    if (customerError) throw customerError;
    if (orderError) throw orderError;
    const query = adminCustomerSearch.trim().toLocaleLowerCase();
    const filtered = customers.filter((customer) => [customer.name, customer.email, customer.username, customer.phone].join(" ").toLocaleLowerCase().includes(query));
    renderAdminPortal("admin-customers", "Customers", `
        <div class="admin-page-heading"><div><span class="admin-kicker">CUSTOMER DIRECTORY</span><h2>Customers</h2><p>Registered accounts and their order history. Passwords are never accessible here.</p></div></div>
        <section class="admin-panel">
            <div class="admin-panel-heading"><div><h3>${customers.length} registered customers</h3><p>Search by name, email or contact number.</p></div><label class="admin-inline-search"><span class="sr-only">Search customers</span><input id="admin-customer-search" type="search" value="${escapeHtml(adminCustomerSearch)}" placeholder="Search customers"></label></div>
            ${filtered.length ? `<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Customer</th><th>Contact</th><th>Registered</th><th>Orders</th><th>History / address</th></tr></thead><tbody>${filtered.map((customer) => {
                const customerOrders = orders.filter((order) => order.user_id === customer.id);
                return `<tr><td><strong>${escapeHtml(customer.name)}</strong><small>@${escapeHtml(customer.username || "")}</small></td><td><strong>${escapeHtml(customer.email)}</strong><small>${escapeHtml(customer.phone || "Phone not provided")}</small></td><td>${escapeHtml(new Date(customer.created_at).toLocaleDateString())}</td><td>${customerOrders.length}</td><td><details class="admin-customer-details"><summary>View details</summary><div><span><strong>Address:</strong> ${escapeHtml(customer.delivery_address || "Not provided")}</span><strong>Order history</strong>${customerOrders.length ? customerOrders.map((order) => `<span>#${escapeHtml(order.id.slice(0, 8).toUpperCase())} · ${escapeHtml(new Date(order.created_at).toLocaleDateString())} · ${escapeHtml(order.status)} · ${money.format(order.total)} · ${escapeHtml(order.payment_status || "Payment pending")}</span>`).join("") : "<span>No orders placed.</span>"}</div></details></td></tr>`;
            }).join("")}</tbody></table></div>` : `<p class="admin-empty-note">No customers match your search.</p>`}
        </section>
        <p class="admin-capability-note">Account suspension and reactivation require a trusted server-side Supabase Auth Admin API integration; this browser-only app does not expose privileged service credentials.</p>`);
}

async function loadAdminPayments() {
    activeView = "admin-payments";
    setLoading("Loading payment records…");
    const { data, error } = await client.from("payments")
        .select("id,order_id,user_id,amount,method,status,provider_reference,created_at,profiles(name,email)")
        .order("created_at", { ascending: false });
    if (error) throw error;
    const rows = data.filter((payment) => adminPaymentFilter === "all"
        || (adminPaymentFilter === "cod" && payment.method === "Cash on Delivery")
        || payment.status === adminPaymentFilter);
    renderAdminPortal("admin-payments", "Payments", `
        <div class="admin-page-heading"><div><span class="admin-kicker">PAYMENT RECORDS</span><h2>Payments</h2><p>Payment status is read-only here. Online payments must only be confirmed by a verified payment provider.</p></div></div>
        <section class="admin-panel"><div class="admin-panel-heading"><div><h3>${data.length} payment records</h3><p>Filter by status or cash on delivery.</p></div></div>
            <div class="admin-order-filters">${[["all","All payments"],["Pending","Pending"],["Paid","Paid"],["Failed","Failed"],["Refunded","Refunded"],["cod","Cash on delivery"]].map(([value,label]) => `<button class="filter-button ${adminPaymentFilter === value ? "active" : ""}" data-payment-filter="${value}" type="button">${label}</button>`).join("")}</div>
            ${rows.length ? `<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Payment / order</th><th>Customer</th><th>Method</th><th>Amount</th><th>Status</th><th>Reference / date</th></tr></thead><tbody>${rows.map((payment) => `<tr><td><strong>#${escapeHtml(payment.order_id.slice(0, 8).toUpperCase())}</strong><small>${escapeHtml(payment.id.slice(0, 8).toUpperCase())}</small></td><td><strong>${escapeHtml(payment.profiles?.name || "Customer")}</strong><small>${escapeHtml(payment.profiles?.email || "")}</small></td><td>${escapeHtml(payment.method)}</td><td><strong>${money.format(payment.amount)}</strong></td><td><span class="admin-status-badge">${escapeHtml(payment.status)}</span></td><td>${escapeHtml(payment.provider_reference || "No provider reference")}<small>${escapeHtml(new Date(payment.created_at).toLocaleString())}</small></td></tr>`).join("")}</tbody></table></div>` : `<p class="admin-empty-note">No payments match this filter.</p>`}
        </section>
        <p class="admin-capability-note">Never mark an online payment as paid manually. Payment confirmation must come from a verified gateway webhook.</p>`);
}

async function loadAdminCategories() {
    activeView = "admin-categories";
    setLoading("Loading categories…");
    const [{ data: categories, error: categoryError }, { data: foods, error: foodError }] = await Promise.all([
        client.from("categories").select("id,name").order("name"),
        client.from("foods").select("id,name,category,category_id").order("name")
    ]);
    if (categoryError) throw categoryError;
    if (foodError) throw foodError;
    renderAdminPortal("admin-categories", "Categories", `
        <div class="admin-page-heading"><div><span class="admin-kicker">MENU ORGANIZATION</span><h2>Categories</h2><p>Organize dishes and keep customer menu filters useful.</p></div></div>
        <section class="admin-two-column">
            <form id="admin-category-form" class="admin-panel admin-form-panel"><h3>Add category</h3><p class="muted">Category names are shared with food menu items.</p><label>Category name<input name="name" maxlength="60" placeholder="e.g. Breakfast" required></label><button class="button button-primary" type="submit">Add category</button></form>
            <section class="admin-panel"><div class="admin-panel-heading"><div><h3>Existing categories</h3><p>${categories.length} categories</p></div></div>
                ${categories.length ? `<div class="admin-category-list">${categories.map((category) => {
                    const used = foods.filter((food) => food.category_id === category.id || food.category === category.name).length;
                    return `<article class="admin-category-row"><form class="admin-category-edit" data-category-id="${category.id}"><label><span class="sr-only">Category name</span><input name="name" maxlength="60" value="${escapeHtml(category.name)}" required></label><button class="button button-secondary button-small" type="submit">Rename</button></form><div class="admin-category-usage">${used} food item${used === 1 ? "" : "s"} assigned</div><button class="button button-secondary button-small" data-action="delete-category" data-id="${category.id}" data-name="${escapeHtml(category.name)}" ${used ? "disabled title=\"Reassign food items before deleting this category\"" : ""} type="button">Delete</button></article>`;
                }).join("")}</div>` : `<p class="admin-empty-note">No categories have been created.</p>`}
            </section>
        </section>
        <p class="admin-capability-note">Categories in use cannot be deleted. Reassign or remove their food items first.</p>`);
}

async function loadAdminReviews() {
    activeView = "admin-reviews";
    setLoading("Loading customer reviews…");
    const { data, error } = await client.from("reviews")
        .select("id,user_id,order_id,food_id,rating,comment,is_hidden,moderation_reason,created_at,profiles(name,email),foods(name)")
        .order("created_at", { ascending: false });
    if (error) throw error;
    const rows = data.filter((review) => adminReviewFilter === "all"
        || (adminReviewFilter === "visible" && !review.is_hidden)
        || (adminReviewFilter === "hidden" && review.is_hidden));
    renderAdminPortal("admin-reviews", "Reviews", `
        <div class="admin-page-heading"><div><span class="admin-kicker">CUSTOMER FEEDBACK</span><h2>Reviews</h2><p>Monitor ratings and moderate inappropriate feedback with a recorded reason.</p></div></div>
        <section class="admin-panel"><div class="admin-panel-heading"><div><h3>${data.length} reviews</h3><p>Moderation changes are recorded with timestamp and administrator.</p></div></div>
            <div class="admin-order-filters">${[["all","All reviews"],["visible","Visible"],["hidden","Hidden"]].map(([value,label]) => `<button class="filter-button ${adminReviewFilter === value ? "active" : ""}" data-review-filter="${value}" type="button">${label}</button>`).join("")}</div>
            ${rows.length ? `<div class="admin-review-list">${rows.map((review) => `<article class="admin-review-card"><div class="admin-review-top"><span class="admin-rating">${"★".repeat(review.rating)}${"☆".repeat(5 - review.rating)}</span><span class="admin-status-badge">${review.is_hidden ? "Hidden" : "Visible"}</span></div><h3>${escapeHtml(review.foods?.name || "Menu item")}</h3><p>${escapeHtml(review.comment || "No written feedback.")}</p><small>${escapeHtml(review.profiles?.name || "Customer")} · ${escapeHtml(review.profiles?.email || "")} · ${escapeHtml(new Date(review.created_at).toLocaleDateString())}</small>${review.is_hidden ? `<p class="admin-moderation-reason"><strong>Moderation reason:</strong> ${escapeHtml(review.moderation_reason || "Not recorded")}</p>` : ""}<form class="admin-review-form" data-review-id="${escapeHtml(review.id)}" data-hidden="${review.is_hidden}">${review.is_hidden ? "" : `<label class="sr-only">Moderation reason<input name="reason" maxlength="300" placeholder="Reason required to hide this review"></label>`}<button class="button ${review.is_hidden ? "button-secondary" : "button-danger"} button-small" type="submit">${review.is_hidden ? "Restore review" : "Hide review"}</button></form></article>`).join("")}</div>` : `<p class="admin-empty-note">No reviews match this filter.</p>`}
        </section>`);
}

async function loadAdminReports() {
    activeView = "admin-reports";
    setLoading("Loading reports…");
    const [{ data, error }, { data: payments, error: paymentError }] = await Promise.all([
        client.from("orders")
            .select("id,user_id,total,status,created_at,payment_method,payment_status,profiles(name,email),order_items(quantity,foods(name))")
            .order("created_at", { ascending: false }),
        client.from("payments").select("id,amount,status,created_at").order("created_at", { ascending: false })
    ]);
    if (error) throw error;
    if (paymentError) throw paymentError;
    const filtered = data.filter((order) => {
        const date = new Date(order.created_at).toISOString().slice(0, 10);
        return (!adminReportStart || date >= adminReportStart) && (!adminReportEnd || date <= adminReportEnd);
    });
    const paid = filtered.filter((order) => ["Delivered", "Completed"].includes(order.status) && order.payment_status === "Paid");
    const sum = paid.reduce((total, order) => total + Number(order.total), 0);
    const completed = filtered.filter((order) => ["Delivered", "Completed"].includes(order.status)).length;
    const cancelled = filtered.filter((order) => order.status === "Cancelled").length;
    const customerCount = new Set(filtered.map((order) => order.user_id)).size;
    const filteredPayments = payments.filter((payment) => {
        const date = new Date(payment.created_at).toISOString().slice(0, 10);
        return (!adminReportStart || date >= adminReportStart) && (!adminReportEnd || date <= adminReportEnd);
    });
    const popular = new Map();
    filtered.filter((order) => order.status !== "Cancelled").forEach((order) => (order.order_items || []).forEach((item) => {
        const name = item.foods?.name || "Menu item";
        popular.set(name, (popular.get(name) || 0) + Number(item.quantity));
    }));
    const paymentSummary = ["Paid", "Pending", "Failed", "Refunded"].map((status) => {
        const matching = filteredPayments.filter((payment) => payment.status === status);
        return `<tr><td>${status}</td><td>${matching.length}</td><td>${money.format(matching.reduce((total, payment) => total + Number(payment.amount), 0))}</td></tr>`;
    }).join("");
    renderAdminPortal("admin-reports", "Reports", `
        <div class="admin-page-heading"><div><span class="admin-kicker">BUSINESS INTELLIGENCE</span><h2>Reports</h2><p>Review order activity and paid revenue. Cancelled and unpaid orders are excluded from revenue.</p></div><div class="admin-report-actions"><button class="button button-secondary" data-action="export-report" type="button">Export CSV</button><button class="button button-secondary" data-action="print-report" type="button">Print report</button></div></div>
        <section class="admin-panel admin-filter-panel"><div class="admin-filter-controls"><label class="admin-date-filter">From<input id="admin-report-start" type="date" value="${escapeHtml(adminReportStart)}"></label><label class="admin-date-filter">To<input id="admin-report-end" type="date" value="${escapeHtml(adminReportEnd)}"></label><button class="button button-quiet button-small" data-action="clear-report-date" type="button">Clear dates</button></div></section>
        <section class="admin-summary-grid admin-report-summary"><article class="admin-summary-card"><span class="admin-summary-icon">▤</span><div><span>Total orders</span><strong>${filtered.length}</strong><small>Within selected range</small></div></article><article class="admin-summary-card"><span class="admin-summary-icon">♙</span><div><span>Customers ordering</span><strong>${customerCount}</strong><small>Unique customers</small></div></article><article class="admin-summary-card"><span class="admin-summary-icon">✓</span><div><span>Completed orders</span><strong>${completed}</strong><small>Delivered or completed</small></div></article><article class="admin-summary-card"><span class="admin-summary-icon">×</span><div><span>Cancelled orders</span><strong>${cancelled}</strong><small>Within selected range</small></div></article><article class="admin-summary-card"><span class="admin-summary-icon">₹</span><div><span>Paid revenue</span><strong>${money.format(sum)}</strong><small>Paid, completed orders only</small></div></article></section>
        <section class="admin-two-column">
            <article class="admin-panel"><div class="admin-panel-heading"><div><h3>Popular food items</h3><p>Quantity sold in non-cancelled orders</p></div></div>${popular.size ? `<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Food item</th><th>Quantity</th></tr></thead><tbody>${[...popular.entries()].sort((a,b) => b[1] - a[1]).map(([name, quantity]) => `<tr><td>${escapeHtml(name)}</td><td>${quantity}</td></tr>`).join("")}</tbody></table></div>` : `<p class="admin-empty-note">No order data for this range.</p>`}</article>
            <article class="admin-panel"><div class="admin-panel-heading"><div><h3>Payment summary</h3><p>Payment records within the selected range</p></div></div><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Status</th><th>Transactions</th><th>Amount</th></tr></thead><tbody>${paymentSummary}</tbody></table></div></article>
        </section>`);
}

async function exportAdminReport() {
    if (profile?.role !== "admin") return;
    const { data, error } = await client.from("orders")
        .select("id,total,status,created_at,payment_method,payment_status")
        .order("created_at", { ascending: false });
    if (error) throw error;
    const rows = data.filter((order) => {
        const date = new Date(order.created_at).toISOString().slice(0, 10);
        return (!adminReportStart || date >= adminReportStart) && (!adminReportEnd || date <= adminReportEnd);
    });
    const csvCell = (value) => {
        let text = String(value ?? "");
        if (/^[=+\-@]/.test(text)) text = `'${text}`;
        return `"${text.replace(/"/g, '""')}"`;
    };
    const csv = [
        ["Order ID", "Date", "Status", "Total", "Payment method", "Payment status", "Counted as revenue"],
        ...rows.map((order) => [order.id, order.created_at, order.status, order.total, order.payment_method, order.payment_status, ["Delivered", "Completed"].includes(order.status) && order.payment_status === "Paid" ? "Yes" : "No"])
    ].map((row) => row.map(csvCell).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `canteen-report-${adminReportStart || "all"}-to-${adminReportEnd || new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
}

async function loadAdminSettings() {
    activeView = "admin-settings";
    setLoading("Loading administrator settings…");
    const [{ data, error }, { data: restaurant, error: restaurantError }] = await Promise.all([
        client.from("profiles").select("name,email,phone").eq("id", currentUser.id).single(),
        client.from("restaurant_settings").select("name,contact_phone,address,opening_hours").eq("id", 1).single()
    ]);
    if (error) throw error;
    if (restaurantError) throw restaurantError;
    renderAdminPortal("admin-settings", "Settings", `
        <div class="admin-page-heading"><div><span class="admin-kicker">ACCOUNT & PREFERENCES</span><h2>Settings</h2><p>Manage your administrator profile and secure your account.</p></div></div>
        <section class="admin-two-column">
            <form id="admin-profile-form" class="admin-panel admin-form-panel"><h3>Administrator profile</h3><label>Full name<input name="name" maxlength="80" value="${escapeHtml(data.name)}" required></label><label>Email address<input name="email" type="email" value="${escapeHtml(data.email)}" required><small>Supabase will verify any email change before it takes effect.</small></label><label>Phone<input name="phone" type="tel" maxlength="20" value="${escapeHtml(data.phone || "")}"></label><button class="button button-primary" type="submit">Save profile</button></form>
            <form id="admin-password-form" class="admin-panel admin-form-panel"><h3>Change password</h3><p class="muted">Choose at least 8 characters.</p><label>New password<input name="password" type="password" minlength="8" autocomplete="new-password" required></label><label>Confirm password<input name="confirm-password" type="password" minlength="8" autocomplete="new-password" required></label><button class="button button-primary" type="submit">Update password</button></form>
        </section>
        <form id="admin-restaurant-form" class="admin-panel admin-form-panel"><h3>Restaurant information</h3><p>Shared canteen contact details for administration.</p><div class="admin-food-fields"><label>Restaurant name<input name="name" maxlength="100" value="${escapeHtml(restaurant.name)}" required></label><label>Contact phone<input name="contact_phone" maxlength="20" value="${escapeHtml(restaurant.contact_phone || "")}"></label><label>Address<input name="address" maxlength="250" value="${escapeHtml(restaurant.address || "")}"></label><label>Opening hours<input name="opening_hours" maxlength="120" value="${escapeHtml(restaurant.opening_hours || "")}" placeholder="e.g. Mon–Fri, 8 am–5 pm"></label></div><button class="button button-primary" type="submit">Save restaurant information</button></form>`);
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

    renderAdminPortal("admin-staff", "Staff access", `
        <div class="admin-page-heading"><div><span class="admin-kicker">ACCESS CONTROL</span><h2>Staff access</h2><p>Assign kitchen access to registered accounts.</p></div></div>
        <section class="admin-panel staff-access-list" aria-label="Customer and chef accounts">
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
        </section>`);
}

async function loadAdminMenu() {
    if (profile?.role !== "admin") return;
    activeView = "admin-menu";
    setLoading("Loading menu management…");
    const [{ data: menu, error: menuError }, { data: categories, error: categoryError }] = await Promise.all([
        client.from("foods").select("id,name,price,emoji,image_url,description,category,is_available,stock_quantity,featured,popular").order("name"),
        client.from("categories").select("name").order("name")
    ]);
    if (menuError) throw menuError;
    if (categoryError) throw categoryError;
    const visible = menu.filter((food) => {
        const matchesSearch = `${food.name} ${food.description || ""}`.toLocaleLowerCase().includes(adminFoodSearch.toLocaleLowerCase());
        return matchesSearch && (adminFoodCategory === "all" || food.category === adminFoodCategory);
    });
    const editorFields = (food = {}) => `
        <label>Food name<input name="name" value="${escapeHtml(food.name || "")}" maxlength="80" required></label>
        <label>Price (INR)<input name="price" type="number" min="0" max="100000" step="1" value="${food.price ?? ""}" required></label>
        <label>Category<input name="category" list="admin-category-options" value="${escapeHtml(food.category || "")}" maxlength="60" required></label>
        <label>Emoji<input name="emoji" value="${escapeHtml(food.emoji || "🍽️")}" maxlength="8" required></label>
        <label>Description<input name="description" value="${escapeHtml(food.description || "")}" maxlength="250"></label>
        <label>Image URL<input name="image_url" type="url" inputmode="url" placeholder="https://…" value="${escapeHtml(food.image_url || "")}"></label>
        <label>Upload image<input name="image_file" type="file" accept="image/jpeg,image/png,image/webp,image/avif"></label>
        <label class="admin-checkbox-label"><input name="featured" type="checkbox" ${food.featured ? "checked" : ""}> Featured</label>
        <label class="admin-checkbox-label"><input name="popular" type="checkbox" ${food.popular ? "checked" : ""}> Popular</label>`;
    renderAdminPortal("admin-menu", "Food management", `
        <div class="admin-page-heading"><div><span class="admin-kicker">MENU MANAGEMENT</span><h2>Food items</h2><p>Add dishes, update prices, control availability and edit menu details.</p></div></div>
        <datalist id="admin-category-options">${categories.map((category) => `<option value="${escapeHtml(category.name)}">`).join("")}</datalist>
        <form id="menu-add-form" class="admin-panel admin-food-add-form">
            <div class="admin-panel-heading"><div><h3>Add a food item</h3><p>Images must be JPG, PNG, WebP or AVIF, up to 5 MB.</p></div></div>
            <div class="admin-food-fields">${editorFields()}</div>
            <button class="button button-primary" type="submit">Add food item</button>
        </form>
        <section class="admin-panel admin-food-list"><div class="admin-panel-heading"><div><h3>Current menu</h3><p>${visible.length} of ${menu.length} items</p></div><div class="admin-filter-controls"><label class="admin-inline-search"><span class="sr-only">Search menu</span><input id="admin-food-search" type="search" value="${escapeHtml(adminFoodSearch)}" placeholder="Search food items"></label><select id="admin-food-category" aria-label="Filter by category"><option value="all">All categories</option>${categories.map((category) => `<option value="${escapeHtml(category.name)}" ${adminFoodCategory === category.name ? "selected" : ""}>${escapeHtml(category.name)}</option>`).join("")}</select></div></div>
            ${visible.length ? `<div class="admin-food-items">${visible.map((food) => `<details class="admin-food-item"><summary><span class="menu-item-emoji">${escapeHtml(food.emoji)}</span><span class="admin-food-item-name"><strong>${escapeHtml(food.name)}</strong><small>${escapeHtml(food.category || "Other")} · ${money.format(food.price)} · ${food.is_available ? "Available" : "Unavailable"}</small></span><span class="admin-status-badge">${food.is_available ? "Available" : "Sold out"}</span></summary><div class="admin-food-item-body"><form class="menu-edit-form admin-food-edit" data-food-id="${food.id}"><div class="admin-food-fields">${editorFields(food)}</div><button class="button button-primary button-small" type="submit">Save changes</button></form><div class="admin-food-actions"><button class="button button-secondary button-small" data-action="toggle-availability" data-id="${food.id}" data-available="${food.is_available}" type="button">${food.is_available ? "Mark unavailable" : "Make available"}</button><button class="button button-danger button-small" data-action="delete-food" data-id="${food.id}" data-name="${escapeHtml(food.name)}" type="button">Delete item</button></div></div></details>`).join("")}</div>` : `<p class="admin-empty-note">No menu items match these filters.</p>`}
        </section>`);
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
    renderAdminPortal("admin-inventory", "Inventory", `
        <div class="admin-page-heading"><div><span class="admin-kicker">STOCK CONTROL</span><h2>Inventory</h2><p>On-hand stock across your canteen menu.</p></div><button class="button button-secondary" data-view="admin-menu" type="button">Manage menu</button></div>
        <section class="stats-grid inventory-stats" aria-label="Inventory summary">
            <article class="stat-card"><span>Menu items</span><strong>${inventory.length}</strong></article>
            <article class="stat-card"><span>Units on hand</span><strong>${totalUnits}</strong></article>
            <article class="stat-card"><span>Low stock (1–5)</span><strong>${lowStock}</strong></article>
            <article class="stat-card"><span>Out of stock</span><strong>${outOfStock}</strong></article>
        </section>
        <section class="admin-panel">${inventory.length ? `<section class="inventory-list" aria-label="Canteen stock">
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
        </section>` : `<section class="empty-state compact"><span class="empty-icon" aria-hidden="true">＋</span><h2>No menu items yet</h2><p>Add a dish to start tracking stock.</p><button class="button button-primary" data-view="admin-menu" type="button">Add menu item</button></section>`}</section>`);
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
        adminOrderNotificationsInitialized = false;
        adminSeenOrderIds.clear();
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
    if (isAdminPage && profile.role !== "admin") {
        window.clearInterval(adminRefreshTimer);
        adminRefreshTimer = undefined;
        renderAdminLogin({ confirmationMessage: "This account does not have administrator access. Ask the canteen owner to assign the admin role." });
        return;
    }
    if (profile.role === "admin") {
        await loadAdminDashboard();
        return;
    }
    if (profile.role === "chef") {
        window.clearInterval(adminRefreshTimer);
        adminRefreshTimer = undefined;
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
            <aside class="summary-card checkout-summary">
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
    const allowedStatuses = profile?.role === "chef" ? ["Accepted", "Preparing", "Ready for Pickup"] : statuses;
    if (!allowedStatuses.includes(status)) {
        showNotice("Choose a valid order status.", "error");
        return;
    }
    const { error } = await client.rpc("set_canteen_order_status", {
        p_order_id: orderId,
        p_status: status,
        p_cancellation_reason: null
    });
    if (error) throw error;
    showNotice("Order status updated.", "success");
    if (profile?.role === "chef") {
        await loadChefDashboard();
    } else {
        await loadAdminDashboard();
    }
}

async function updateAdminOrderStatus(form) {
    if (profile?.role !== "admin") return;
    const status = String(new FormData(form).get("status") || "");
    const reason = String(new FormData(form).get("cancellation_reason") || "").trim();
    const order = adminOrders.find((item) => item.id === form.dataset.orderId);
    const transitions = {
        Pending: ["Accepted", "Cancelled"],
        Accepted: ["Preparing", "Cancelled"],
        Preparing: ["Ready for Pickup"],
        Ready: ["Out for Delivery", "Delivered"],
        "Ready for Pickup": ["Out for Delivery", "Delivered"],
        "Out for Delivery": ["Delivered"]
    };
    if (!order || !transitions[order.status]?.includes(status)) {
        showNotice("That order status transition is not allowed.", "error");
        return;
    }
    if (status === "Cancelled" && reason.length < 5) {
        showNotice("Enter a cancellation reason of at least 5 characters.", "error");
        form.querySelector('[name="cancellation_reason"]').focus();
        return;
    }
    if (status === "Cancelled" && !window.confirm("Cancel this order? This action cannot be undone.")) return;
    const { error } = await client.rpc("set_canteen_order_status", {
        p_order_id: order.id,
        p_status: status,
        p_cancellation_reason: status === "Cancelled" ? reason : null
    });
    if (error) throw error;
    showNotice("Order status updated.", "success");
    await loadAdminOrders();
}

async function moderateAdminReview(form) {
    if (profile?.role !== "admin") return;
    const hidden = form.dataset.hidden === "true";
    const reason = hidden ? null : String(new FormData(form).get("reason") || "").trim();
    if (!hidden && reason.length < 5) {
        showNotice("Enter a moderation reason of at least 5 characters.", "error");
        form.querySelector('[name="reason"]').focus();
        return;
    }
    const { error } = await client.rpc("moderate_canteen_review", {
        p_review_id: form.dataset.reviewId,
        p_hidden: !hidden,
        p_reason: reason
    });
    if (error) throw error;
    showNotice(hidden ? "Review restored." : "Review hidden and moderation reason recorded.", "success");
    await loadAdminReviews();
}

async function addAdminCategory(form) {
    if (profile?.role !== "admin") return;
    const name = String(new FormData(form).get("name") || "").trim();
    if (!name || name.length > 60) {
        showNotice("Category names must contain 1 to 60 characters.", "error");
        return;
    }
    const { error } = await client.from("categories").insert({ name });
    if (error) throw error;
    showNotice("Category added.", "success");
    await loadAdminCategories();
}

async function renameAdminCategory(form) {
    if (profile?.role !== "admin") return;
    const name = String(new FormData(form).get("name") || "").trim();
    const categoryId = Number(form.dataset.categoryId);
    if (!name || name.length > 60 || !Number.isInteger(categoryId)) {
        showNotice("Category names must contain 1 to 60 characters.", "error");
        return;
    }
    const { error } = await client.rpc("rename_canteen_category", {
        p_category_id: categoryId,
        p_name: name
    });
    if (error) throw error;
    showNotice("Category and assigned food items were updated.", "success");
    await loadAdminCategories();
}

async function resolveFoodImage(values) {
    const file = values.get("image_file");
    if (!(file instanceof File) || file.size === 0) {
        const imageUrl = String(values.get("image_url") || "").trim();
        if (imageUrl && !/^https:\/\/\S+$/i.test(imageUrl)) throw new Error("Food image URLs must use HTTPS.");
        return imageUrl || null;
    }
    const allowedTypes = new Map([
        ["image/jpeg", "jpg"],
        ["image/png", "png"],
        ["image/webp", "webp"],
        ["image/avif", "avif"]
    ]);
    const extension = allowedTypes.get(file.type);
    if (!extension || file.size > 5 * 1024 * 1024) {
        throw new Error("Choose a JPG, PNG, WebP or AVIF image no larger than 5 MB.");
    }
    const path = `${currentUser.id}/${crypto.randomUUID()}.${extension}`;
    const { error } = await client.storage.from("canteen-food-images").upload(path, file, {
        contentType: file.type,
        cacheControl: "3600",
        upsert: false
    });
    if (error) throw error;
    return client.storage.from("canteen-food-images").getPublicUrl(path).data.publicUrl;
}

function canteenStoragePath(imageUrl) {
    if (!imageUrl) return null;
    try {
        const url = new URL(imageUrl);
        const projectUrl = new URL(config.supabaseUrl);
        const prefix = "/storage/v1/object/public/canteen-food-images/";
        if (url.origin !== projectUrl.origin || !url.pathname.startsWith(prefix)) return null;
        return decodeURIComponent(url.pathname.slice(prefix.length));
    } catch (error) {
        console.error(error);
        return null;
    }
}

async function removeCanteenImage(imageUrl) {
    const path = canteenStoragePath(imageUrl);
    if (!path) return;
    const { error } = await client.storage.from("canteen-food-images").remove([path]);
    if (error) throw error;
}

async function addMenuItem(form) {
    if (!profile || !["admin", "chef"].includes(profile.role)) return;
    const values = new FormData(form);
    const name = String(values.get("name")).trim();
    const price = Number(values.get("price"));
    const rawStockQuantity = String(values.get("stock_quantity") ?? "").trim();
    const stockQuantity = rawStockQuantity ? Number(rawStockQuantity) : null;
    const emoji = String(values.get("emoji")).trim();
    const description = String(values.get("description") || "Freshly prepared for pickup.").trim();
    const category = String(values.get("category") || "Other").trim() || "Other";
    const imageUrl = await resolveFoodImage(values);
    const featured = values.get("featured") === "on";
    const popular = values.get("popular") === "on";
    if (!name || name.length > 80 || !Number.isInteger(price) || price < 0 || price > 100000 || !emoji
        || category.length > 60 || description.length > 250
        || (rawStockQuantity && (!Number.isInteger(stockQuantity) || stockQuantity < 0))
        || (imageUrl && !/^https:\/\/\S+$/i.test(imageUrl))) {
        showNotice("Enter valid food details, optional non-negative stock, and an HTTPS image URL.", "error");
        return;
    }

    const { error } = await client.from("foods").insert({ name, price, emoji, image_url: imageUrl, description: description || "Freshly prepared for pickup.", category, featured, popular, stock_quantity: stockQuantity, is_available: stockQuantity !== 0 });
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
    const imageUrl = await resolveFoodImage(values);
    const featured = values.get("featured") === "on";
    const popular = values.get("popular") === "on";
    const foodId = Number(form.dataset.foodId);
    if (!name || name.length > 80 || !Number.isInteger(price) || price < 0 || price > 100000 || !emoji
        || category.length > 60 || description.length > 250 || (imageUrl && !/^https:\/\/\S+$/i.test(imageUrl))
        || !Number.isInteger(foodId)) {
        showNotice("Enter valid food details and an HTTPS image URL.", "error");
        return;
    }

    let oldImageUrl = null;
    if (profile.role === "admin") {
        const { data: existingFood, error: existingFoodError } = await client.from("foods").select("image_url").eq("id", foodId).single();
        if (existingFoodError) throw existingFoodError;
        oldImageUrl = existingFood.image_url;
    }
    const { error } = await client.from("foods")
        .update({ name, price, emoji, image_url: imageUrl || null, description: description || "Freshly prepared for pickup.", category, featured, popular })
        .eq("id", foodId);
    if (error) throw error;
    if (oldImageUrl && oldImageUrl !== imageUrl) await removeCanteenImage(oldImageUrl);
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
    if (profile.role === "admin" && isAvailable) {
        const { data: food, error: foodError } = await client.from("foods").select("stock_quantity").eq("id", foodId).single();
        if (foodError) throw foodError;
        if (food.stock_quantity === 0) {
            showNotice("Add stock in Inventory before making this item available.", "error");
            return;
        }
    }
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
    const categoryButton = event.target.closest("[data-category]");
    if (categoryButton && activeView === "menu") {
        activeCategory = categoryButton.dataset.category || "all";
        renderMenu();
        return;
    }

    const filterButton = event.target.closest("[data-admin-filter]");
    if (filterButton && profile?.role === "admin") {
        adminOrderFilter = filterButton.dataset.adminFilter;
        root.querySelectorAll("[data-admin-filter]").forEach((button) => {
            button.classList.toggle("active", button === filterButton);
        });
        const results = root.querySelector("#admin-order-results");
        if (results) results.innerHTML = adminOrderResultsMarkup();
        const adminResults = root.querySelector("#admin-order-table-results");
        if (adminResults) adminResults.innerHTML = adminOrderTableMarkup();
        return;
    }

    const paymentFilter = event.target.closest("[data-payment-filter]");
    if (paymentFilter && profile?.role === "admin") {
        adminPaymentFilter = paymentFilter.dataset.paymentFilter;
        await loadAdminPayments().catch(handleError);
        return;
    }

    const reviewFilter = event.target.closest("[data-review-filter]");
    if (reviewFilter && profile?.role === "admin") {
        adminReviewFilter = reviewFilter.dataset.reviewFilter;
        await loadAdminReviews().catch(handleError);
        return;
    }

    const viewButton = event.target.closest("[data-view]");
    if (viewButton) {
        const view = viewButton.dataset.view;
        if (view === "login" || view === "register") {
            renderAuth(view, { email: viewButton.dataset.email || "" });
        } else if (view === "chef-login") {
            renderChefLogin("login");
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
        } else if (view === "admin-orders" && profile?.role === "admin") {
            await loadAdminOrders().catch(handleError);
        } else if (view === "admin-customers" && profile?.role === "admin") {
            await loadAdminCustomers().catch(handleError);
        } else if (view === "admin-payments" && profile?.role === "admin") {
            await loadAdminPayments().catch(handleError);
        } else if (view === "admin-categories" && profile?.role === "admin") {
            await loadAdminCategories().catch(handleError);
        } else if (view === "admin-reviews" && profile?.role === "admin") {
            await loadAdminReviews().catch(handleError);
        } else if (view === "admin-reports" && profile?.role === "admin") {
            await loadAdminReports().catch(handleError);
        } else if (view === "admin-settings" && profile?.role === "admin") {
            await loadAdminSettings().catch(handleError);
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
            activeView === "cart" ? renderCart() : renderMenu();
            showNotice("Added to your cart.", "success");
        } else if (action === "decrease") {
            const currentQuantity = normalizeCartQuantity(cart[id]);
            cart[id] = Math.max(currentQuantity - 1, 0);
            if (cart[id] === 0) delete cart[id];
            window.localStorage.setItem(`canteen-cart:${currentUser.id}`, JSON.stringify(cart));
            activeView === "menu" ? renderMenu() : renderCart();
        } else if (action === "remove") {
            delete cart[id];
            window.localStorage.setItem(`canteen-cart:${currentUser.id}`, JSON.stringify(cart));
            activeView === "menu" ? renderMenu() : renderCart();
            showNotice("Item removed from cart.", "success");
        } else if (action === "checkout") {
            await renderCheckout().catch(handleError);
        } else if (action === "place-order") {
            await placeOrder();
        } else if (action === "cancel-order") {
            const orderId = actionButton.dataset.orderId;
            if (!orderId || !window.confirm("Cancel this order? This action cannot be undone.")) return;
            const { error } = await client.rpc("cancel_canteen_customer_order", { p_order_id: orderId });
            if (error) throw error;
            showNotice("Order cancelled.", "success");
            await loadCustomerOrders();
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
        } else if (action === "refresh-admin-orders") {
            await loadAdminOrders();
        } else if (action === "delete-food") {
            if (!window.confirm(`Delete "${actionButton.dataset.name}"? This is only allowed when it has no order or review history.`)) return;
            const { data: food, error: foodError } = await client.from("foods").select("image_url").eq("id", Number(id)).single();
            if (foodError) throw foodError;
            const { error } = await client.rpc("delete_canteen_food", { p_food_id: Number(id) });
            if (error) throw error;
            await removeCanteenImage(food.image_url);
            showNotice("Food item deleted.", "success");
            await loadAdminMenu();
        } else if (action === "delete-category") {
            if (!window.confirm(`Delete the unused "${actionButton.dataset.name}" category?`)) return;
            const { error } = await client.rpc("delete_canteen_category", { p_category_id: Number(id) });
            if (error) throw error;
            showNotice("Category deleted.", "success");
            await loadAdminCategories();
        } else if (action === "export-report") {
            await exportAdminReport();
        } else if (action === "print-report") {
            window.print();
        } else if (action === "clear-report-date") {
            adminReportStart = "";
            adminReportEnd = "";
            await loadAdminReports();
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
    if (event.target.id === "admin-order-search") {
        adminOrderSearch = event.target.value;
        const dashboardResults = root.querySelector("#admin-order-results");
        if (dashboardResults) dashboardResults.innerHTML = adminOrderResultsMarkup();
        const orderResults = root.querySelector("#admin-order-table-results");
        if (orderResults) orderResults.innerHTML = adminOrderTableMarkup();
    } else if (event.target.id === "admin-customer-search") {
        adminCustomerSearch = event.target.value;
        const cursor = event.target.selectionStart;
        window.clearTimeout(adminSearchTimer);
        adminSearchTimer = window.setTimeout(() => {
            if (activeView !== "admin-customers") return;
            loadAdminCustomers().then(() => {
                const search = root.querySelector("#admin-customer-search");
                if (!search) return;
                search.focus();
                if (cursor !== null) search.setSelectionRange(cursor, cursor);
            }).catch(handleError);
        }, 220);
    } else if (event.target.id === "admin-food-search") {
        adminFoodSearch = event.target.value;
        const cursor = event.target.selectionStart;
        window.clearTimeout(adminSearchTimer);
        adminSearchTimer = window.setTimeout(() => {
            if (activeView !== "admin-menu") return;
            loadAdminMenu().then(() => {
                const search = root.querySelector("#admin-food-search");
                if (!search) return;
                search.focus();
                if (cursor !== null) search.setSelectionRange(cursor, cursor);
            }).catch(handleError);
        }, 220);
    } else if (event.target.id === "food-search") {
        const cursor = event.target.selectionStart;
        menuSearch = event.target.value;
        renderMenu();
        const searchInput = root.querySelector("#food-search");
        searchInput.focus();
        if (cursor !== null) searchInput.setSelectionRange(cursor, cursor);
    }
});

root.addEventListener("change", (event) => {
    if (event.target.name === "status" && event.target.form?.matches(".admin-order-form")) {
        const reason = event.target.form.querySelector('[name="cancellation_reason"]');
        reason.hidden = event.target.value !== "Cancelled";
        reason.required = event.target.value === "Cancelled";
        return;
    }
    if (event.target.id === "food-sort") {
        menuSort = event.target.value;
        renderMenu();
    } else if (event.target.id === "admin-order-date") {
        adminOrderDate = event.target.value;
        if (activeView === "admin-reports") {
            loadAdminReports().catch(handleError);
        } else if (activeView === "admin-orders") {
            const results = root.querySelector("#admin-order-table-results");
            if (results) results.innerHTML = adminOrderTableMarkup();
        }
    } else if (event.target.id === "admin-report-start") {
        adminReportStart = event.target.value;
        if (adminReportEnd && adminReportStart > adminReportEnd) {
            adminReportEnd = adminReportStart;
        }
        loadAdminReports().catch(handleError);
    } else if (event.target.id === "admin-report-end") {
        adminReportEnd = event.target.value;
        if (adminReportStart && adminReportEnd < adminReportStart) {
            adminReportStart = adminReportEnd;
        }
        loadAdminReports().catch(handleError);
    } else if (event.target.id === "admin-food-category") {
        adminFoodCategory = event.target.value;
        loadAdminMenu().catch(handleError);
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
        } else if (form.matches(".admin-order-form")) {
            const submitButton = form.querySelector('button[type="submit"]');
            submitButton.disabled = true;
            try {
                await updateAdminOrderStatus(form);
            } finally {
                submitButton.disabled = false;
            }
        } else if (form.matches(".admin-review-form")) {
            const submitButton = form.querySelector('button[type="submit"]');
            submitButton.disabled = true;
            try {
                await moderateAdminReview(form);
            } finally {
                submitButton.disabled = false;
            }
        } else if (form.id === "admin-category-form") {
            const submitButton = form.querySelector('button[type="submit"]');
            submitButton.disabled = true;
            try {
                await addAdminCategory(form);
            } finally {
                submitButton.disabled = false;
            }
        } else if (form.matches(".admin-category-edit")) {
            const submitButton = form.querySelector('button[type="submit"]');
            submitButton.disabled = true;
            try {
                await renameAdminCategory(form);
            } finally {
                submitButton.disabled = false;
            }
        } else if (form.id === "admin-profile-form") {
            const values = new FormData(form);
            const name = String(values.get("name") || "").trim();
            const email = String(values.get("email") || "").trim().toLowerCase();
            const phone = String(values.get("phone") || "").trim();
            if (!name || name.length > 80 || !isValidEmail(email) || (phone && !isValidPhone(phone))) {
                showNotice("Enter a valid name, email and phone number.", "error");
                return;
            }
            const emailChanged = email !== String(profile?.email || currentUser.email || "").toLowerCase();
            if (emailChanged) {
                const { error: authError } = await client.auth.updateUser({ email });
                if (authError) throw authError;
            }
            const { error } = await client.from("profiles").update({ name, phone: phone || null }).eq("id", currentUser.id);
            if (error) throw error;
            profile = { ...profile, name, phone };
            showNotice(emailChanged ? "Profile updated. Confirm the email change using the link Supabase sent you." : "Administrator profile updated.", "success");
            await loadAdminSettings();
        } else if (form.id === "admin-restaurant-form") {
            const values = new FormData(form);
            const name = String(values.get("name") || "").trim();
            const contactPhone = String(values.get("contact_phone") || "").trim();
            const address = String(values.get("address") || "").trim();
            const openingHours = String(values.get("opening_hours") || "").trim();
            if (!name || name.length > 100 || (contactPhone && !isValidPhone(contactPhone))
                || address.length > 250 || openingHours.length > 120) {
                showNotice("Check the restaurant name, phone, address and opening hours.", "error");
                return;
            }
            const { error } = await client.from("restaurant_settings").upsert({
                id: 1,
                name,
                contact_phone: contactPhone || null,
                address: address || null,
                opening_hours: openingHours || null,
                updated_at: new Date().toISOString()
            }, { onConflict: "id" });
            if (error) throw error;
            showNotice("Restaurant information saved.", "success");
            await loadAdminSettings();
        } else if (form.id === "admin-password-form") {
            const values = new FormData(form);
            const password = String(values.get("password") || "");
            const confirmation = String(values.get("confirm-password") || "");
            if (password.length < 8 || password !== confirmation) {
                showNotice(password.length < 8 ? "Password must be at least 8 characters." : "Passwords do not match.", "error");
                return;
            }
            const { error } = await client.auth.updateUser({ password });
            if (error) throw error;
            showNotice("Administrator password updated.", "success");
            form.reset();
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

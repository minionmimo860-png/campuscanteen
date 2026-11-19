const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const htmlEntities: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
}

function escapeHtml(value: unknown) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => htmlEntities[character]);
}

Deno.serve(async (request) => {
    if (request.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }
    if (request.method !== "POST") {
        return jsonResponse({ error: "Method not allowed." }, 405);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    const fromAddress = Deno.env.get("ADMIN_NOTIFICATION_FROM");
    if (!supabaseUrl || !serviceRoleKey || !resendApiKey || !fromAddress) {
        console.error("Admin order email secrets are not fully configured.");
        return jsonResponse({ error: "Admin email notifications are not configured." }, 503);
    }

    const authorization = request.headers.get("Authorization");
    if (!authorization?.startsWith("Bearer ")) {
        return jsonResponse({ error: "Authentication is required." }, 401);
    }

    const authResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
        headers: {
            apikey: serviceRoleKey,
            Authorization: authorization
        }
    });
    if (!authResponse.ok) {
        return jsonResponse({ error: "The signed-in user could not be verified." }, 401);
    }
    const user = await authResponse.json();

    let payload: { order_id?: unknown };
    try {
        payload = await request.json();
    } catch {
        return jsonResponse({ error: "A valid JSON request body is required." }, 400);
    }
    const orderId = typeof payload.order_id === "string" ? payload.order_id : "";
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(orderId)) {
        return jsonResponse({ error: "A valid order ID is required." }, 400);
    }

    const restHeaders = {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`
    };
    const orderUrl = new URL(`${supabaseUrl}/rest/v1/orders`);
    orderUrl.searchParams.set("id", `eq.${orderId}`);
    orderUrl.searchParams.set(
        "select",
        "id,user_id,total,status,created_at,phone,fulfillment_type,payment_method,profiles!orders_user_id_fkey(name),order_items(quantity,unit_price,foods(name))"
    );
    const orderResponse = await fetch(orderUrl, { headers: restHeaders });
    if (!orderResponse.ok) {
        console.error("Could not load an order for its admin email.", orderResponse.status);
        return jsonResponse({ error: "The order details could not be loaded." }, 502);
    }
    const orders = await orderResponse.json();
    const order = Array.isArray(orders) ? orders[0] : null;
    if (!order || order.user_id !== user.id) {
        return jsonResponse({ error: "The order was not found for this user." }, 404);
    }

    const adminsUrl = new URL(`${supabaseUrl}/rest/v1/profiles`);
    adminsUrl.searchParams.set("role", "eq.admin");
    adminsUrl.searchParams.set("select", "email");
    const adminsResponse = await fetch(adminsUrl, { headers: restHeaders });
    if (!adminsResponse.ok) {
        console.error("Could not load admin email recipients.", adminsResponse.status);
        return jsonResponse({ error: "Admin email recipients could not be loaded." }, 502);
    }
    const admins = await adminsResponse.json();
    const recipients = Array.isArray(admins)
        ? admins.map((admin) => admin.email).filter((email) => typeof email === "string" && email.includes("@"))
        : [];
    if (!recipients.length) {
        console.error("No admin email recipients are configured.");
        return jsonResponse({ error: "No admin email recipients are configured." }, 503);
    }

    const orderLabel = String(order.id).slice(0, 8).toUpperCase();
    const customerName = order.profiles?.name || "A customer";
    const items = Array.isArray(order.order_items) ? order.order_items : [];
    const itemRows = items.map((item) =>
        `<li>${escapeHtml(item.foods?.name || "Menu item")} × ${escapeHtml(item.quantity)}</li>`
    ).join("");
    const textItems = items.map((item) =>
        `- ${String(item.foods?.name || "Menu item")} x ${String(item.quantity)}`
    ).join("\n");
    const fulfillment = order.fulfillment_type === "takeaway" ? "Takeaway (packed)" : "Receive at the canteen";
    const emailResponse = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${resendApiKey}`,
            "Idempotency-Key": `order-${order.id}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            from: fromAddress,
            to: recipients,
            subject: `New canteen order #${orderLabel}`,
            text: [
                `New order #${orderLabel}`,
                `Customer: ${customerName}`,
                `Phone: ${order.phone || "Not provided"}`,
                `Collection: ${fulfillment}`,
                `Total: ${order.total}`,
                `Payment: ${order.payment_method || "Not specified"}`,
                "Items:",
                textItems
            ].join("\n"),
            html: `<h1>New canteen order #${orderLabel}</h1>
                <p><strong>Customer:</strong> ${escapeHtml(customerName)}<br>
                <strong>Phone:</strong> ${escapeHtml(order.phone || "Not provided")}<br>
                <strong>Collection:</strong> ${escapeHtml(fulfillment)}<br>
                <strong>Total:</strong> ${escapeHtml(order.total)}<br>
                <strong>Payment:</strong> ${escapeHtml(order.payment_method || "Not specified")}</p>
                <h2>Items</h2><ul>${itemRows}</ul>`
        })
    });
    if (!emailResponse.ok) {
        console.error("Email provider rejected an admin order notification.", emailResponse.status);
        return jsonResponse({ error: "The email provider could not send the admin notification." }, 502);
    }

    return jsonResponse({ sent: true });
});

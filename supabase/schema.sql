create extension if not exists pgcrypto;

create table if not exists public.profiles (
    id uuid primary key references auth.users (id) on delete cascade,
    name text not null,
    username text not null,
    email text not null,
    role text not null default 'student' check (role in ('student', 'admin')),
    created_at timestamptz not null default now()
);

create table if not exists public.foods (
    id integer primary key,
    name text not null,
    price integer not null check (price >= 0),
    emoji text not null,
    is_available boolean not null default true
);

create sequence if not exists public.foods_id_seq;
alter sequence public.foods_id_seq owned by public.foods.id;
alter table public.foods alter column id set default nextval('public.foods_id_seq');

create table if not exists public.orders (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references public.profiles (id),
    total integer not null check (total >= 0),
    status text not null default 'Pending'
        check (status in ('Pending', 'Preparing', 'Ready', 'Completed', 'Cancelled')),
    created_at timestamptz not null default now()
);

create table if not exists public.order_items (
    order_id uuid not null references public.orders (id) on delete cascade,
    food_id integer not null references public.foods (id),
    quantity integer not null check (quantity between 1 and 50),
    unit_price integer not null check (unit_price >= 0),
    primary key (order_id, food_id)
);

insert into public.foods (id, name, price, emoji) values
    (1, 'Tea - Red Milk', 10, '☕'),
    (2, 'Plain Paratha', 30, '🫓'),
    (3, 'Pori (2 Pcs)', 30, '🍞'),
    (5, 'Allu Paratha', 40, '🥔'),
    (6, 'Veg Roll', 40, '🌯'),
    (7, 'Egg Roll', 50, '🌯'),
    (8, 'Chicken Roll', 70, '🌯'),
    (9, 'Veg Chow', 40, '🍜'),
    (10, 'Egg Chow', 50, '🍜'),
    (11, 'Chicken Chow', 70, '🍜'),
    (12, 'Chicken Lollipop (2 Pcs)', 60, '🍗'),
    (13, 'Chicken Dry Fry (3 Pcs)', 60, '🍗'),
    (14, 'Chicken Pakoda (2 Pcs)', 50, '🥘'),
    (15, 'Veg Pakoda (3 Pcs)', 40, '🥔'),
    (16, 'Veg Fried Rice', 40, '🍚'),
    (17, 'Egg Fried Rice', 50, '🍚'),
    (18, 'Chicken Fried Rice', 70, '🍚')
on conflict (id) do update
set name = excluded.name,
    price = excluded.price,
    emoji = excluded.emoji;

select setval('public.foods_id_seq', coalesce(max(id), 0) + 1, false)
from public.foods;

create or replace function public.is_canteen_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1
        from public.profiles
        where id = (select auth.uid())
          and role = 'admin'
    );
$$;

create or replace function public.create_canteen_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    profile_name text;
    profile_username text;
begin
    profile_name := coalesce(
        nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
        split_part(new.email, '@', 1)
    );
    profile_username := coalesce(
        nullif(trim(new.raw_user_meta_data ->> 'username'), ''),
        'user_' || substr(new.id::text, 1, 8)
    );

    insert into public.profiles (id, name, username, email)
    values (new.id, profile_name, profile_username, new.email);

    return new;
end;
$$;

drop trigger if exists on_canteen_auth_user_created on auth.users;
create trigger on_canteen_auth_user_created
    after insert on auth.users
    for each row execute procedure public.create_canteen_profile();

create or replace function public.place_order(p_items jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    new_order_id uuid;
    item_count integer;
    unique_item_count integer;
    matched_item_count integer;
    order_total integer;
begin
    if auth.uid() is null then
        raise exception 'Sign in before placing an order.';
    end if;

    if jsonb_typeof(p_items) is distinct from 'array' then
        raise exception 'Order items must be an array.';
    end if;

    if jsonb_array_length(p_items) = 0 then
        raise exception 'Add at least one item to your order.';
    end if;

    select count(*), count(distinct item.food_id)
    into item_count, unique_item_count
    from jsonb_to_recordset(p_items) as item(food_id integer, quantity integer);

    if item_count = 0 or item_count <> unique_item_count then
        raise exception 'Order items are invalid.';
    end if;

    if exists (
        select 1
        from jsonb_to_recordset(p_items) as item(food_id integer, quantity integer)
        where item.quantity not between 1 and 50
    ) then
        raise exception 'Each quantity must be between 1 and 50.';
    end if;

    select count(*), coalesce(sum(food.price * item.quantity), 0)
    into matched_item_count, order_total
    from jsonb_to_recordset(p_items) as item(food_id integer, quantity integer)
    join public.foods as food
      on food.id = item.food_id
     and food.is_available;

    if matched_item_count <> item_count then
        raise exception 'An item is unavailable. Refresh the menu and try again.';
    end if;

    insert into public.orders (user_id, total)
    values ((select auth.uid()), order_total)
    returning id into new_order_id;

    insert into public.order_items (order_id, food_id, quantity, unit_price)
    select new_order_id, food.id, item.quantity, food.price
    from jsonb_to_recordset(p_items) as item(food_id integer, quantity integer)
    join public.foods as food
      on food.id = item.food_id
     and food.is_available;

    return new_order_id;
end;
$$;

alter table public.profiles enable row level security;
alter table public.foods enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;

drop policy if exists "Profiles visible to owner and admins" on public.profiles;
create policy "Profiles visible to owner and admins"
    on public.profiles for select to authenticated
    using (id = (select auth.uid()) or (select public.is_canteen_admin()));

drop policy if exists "Available menu is public" on public.foods;
create policy "Available menu is public"
    on public.foods for select to anon, authenticated
    using (is_available);

drop policy if exists "Admins can view all menu items" on public.foods;
create policy "Admins can view all menu items"
    on public.foods for select to authenticated
    using ((select public.is_canteen_admin()));

drop policy if exists "Admins can add menu items" on public.foods;
create policy "Admins can add menu items"
    on public.foods for insert to authenticated
    with check ((select public.is_canteen_admin()));

drop policy if exists "Customers and admins can view orders" on public.orders;
create policy "Customers and admins can view orders"
    on public.orders for select to authenticated
    using (user_id = (select auth.uid()) or (select public.is_canteen_admin()));

drop policy if exists "Admins can update order status" on public.orders;
create policy "Admins can update order status"
    on public.orders for update to authenticated
    using ((select public.is_canteen_admin()))
    with check ((select public.is_canteen_admin()));

drop policy if exists "Customers and admins can view order items" on public.order_items;
create policy "Customers and admins can view order items"
    on public.order_items for select to authenticated
    using (
        (select public.is_canteen_admin())
        or exists (
            select 1
            from public.orders
            where public.orders.id = order_items.order_id
              and public.orders.user_id = (select auth.uid())
        )
    );

revoke all on public.profiles, public.foods, public.orders, public.order_items
    from anon, authenticated;
grant select on public.foods to anon, authenticated;
grant insert (name, price, emoji) on public.foods to authenticated;
revoke all on sequence public.foods_id_seq from public, anon, authenticated;
grant usage on sequence public.foods_id_seq to authenticated;
grant select on public.profiles to authenticated;
grant select on public.orders to authenticated;
grant update (status) on public.orders to authenticated;
grant select on public.order_items to authenticated;
revoke all on function public.is_canteen_admin() from public, anon;
grant execute on function public.is_canteen_admin() to authenticated;
revoke all on function public.place_order(jsonb) from public, anon;
grant execute on function public.place_order(jsonb) to authenticated;

revoke all on function public.create_canteen_profile() from public, anon, authenticated;

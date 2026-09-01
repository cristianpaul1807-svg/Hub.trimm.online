-- Réplica mínima del esquema de Trimm para validar las migraciones del Hub.
-- Las columnas se han copiado de la estructura real de producción.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $r$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $r$;

CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;

CREATE TABLE public.businesses (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid, name text, description text, email text, phone text, address text, profile_photo_url text, cover_photo_url text, whatsapp_url text, instagram_url text, slug text, created_at timestamptz, deposit_type text, deposit_value numeric, cancellation_policy text, stripe_account_id text, city text, gallery_links uuid[], whatsapp text, category_legacy text, subscription_status text, stripe_customer_id text, stripe_subscription_id text, subscription_end_date timestamptz, setup_status text, payment_policy text, country text, stripe_details_submitted boolean, stripe_payouts_enabled boolean, pos_methods jsonb, stripe_status jsonb, stripe_charges_enabled boolean, stripe_onboarding_completed_at timestamptz, payment_policy_type text, deposit_fixed_amount numeric, deposit_percent integer, pos_methods_enabled jsonb, currency text, current_period_end timestamptz, default_reader_id text, default_reader_label text, default_location_id text, category text, region text, latitude double precision, longitude double precision, plan text, trial_ends_at timestamptz, promoter_id uuid, timezone text, public_slug text, plan_type text, trial_active boolean, trial_start_date timestamptz, trial_end_date timestamptz, subscribed_at timestamptz, payments_step_skipped boolean);

CREATE TABLE public.clients (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, name text, email text, phone text, created_at timestamptz, preferencia_email boolean, preferencia_sms boolean, address text, city text, instagram_url text, gallery_links uuid[], business_id uuid, avatar_url text);

CREATE TABLE public.business_clients (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid, client_id uuid, notes text, last_service timestamptz);

CREATE TABLE public.appointments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid, client_id uuid, staff_id uuid, service_id uuid, appointment_date timestamptz, start_time timestamptz, end_time timestamptz, status text, price numeric, created_at timestamptz, confirmation_sent_at timestamptz, reminder_sent_at timestamptz, stripe_payment_intent_id text, deposit_paid boolean, deposit_amount_paid numeric, reschedule_count integer, cancelled_at timestamptz, cancel_reason text, platform_fee numeric, google_event_id text, google_sync_state text, expected_amount numeric, payment_status text, payment_method text, extra_amount numeric, is_quick_sale boolean, paid_amount numeric, paid_at timestamptz, transaction_id text, client_user_id uuid, cashier_user_id uuid, total_price numeric, last_error text, expires_at timestamptz, duration_minutes integer, category_id uuid);

-- Tablas que faltaban para el análisis de composición del negocio.
-- Mismas columnas que producción.
CREATE TABLE public.services (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid, name text, description text, duration_minutes integer, price numeric, active boolean, created_at timestamptz, buffer_time integer, category_id uuid);
CREATE TABLE public.appointment_services (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), appointment_id uuid, service_id uuid, price_snapshot numeric, duration_snapshot integer, created_at timestamptz);
CREATE TABLE public.business_working_hours (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid, day_of_week integer, open_time time, close_time time, break_start time, break_end time);
CREATE TABLE public.business_closed_days (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid, closed_date date, note text, created_at timestamptz);
CREATE TABLE public.notification_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid, appointment_id uuid, type text, status text, recipient text, error_message text, sent_at timestamptz, retry_count integer);
CREATE TABLE public.loyalty_programs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid, is_active boolean, points_to_reward integer, discount_percentage integer, created_at timestamptz, updated_at timestamptz);
CREATE TABLE public.staff (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid, name text, email text, phone text, avatar_url text, active boolean, created_at timestamptz, user_id uuid, role text, google_sync_enabled boolean, google_auth_status text, google_calendar_id text, google_refresh_token_encrypted text, google_last_sync_at timestamptz);

CREATE TABLE public.loyalty_cards (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid, client_id uuid, unique_code text, current_points integer, total_cycles_completed integer, wallet_pass_url text, last_point_at timestamptz, created_at timestamptz, updated_at timestamptz);

CREATE TABLE public.loyalty_transactions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), card_id uuid, business_id uuid, appointment_id uuid, transaction_type text, points_before integer, points_after integer, discount_applied numeric, performed_by uuid, note text, created_at timestamptz);

CREATE TABLE public.profiles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, role text);

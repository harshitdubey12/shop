# Razorpay Route marketplace backend (FastAPI)

End-to-end flow: **vendor application → admin approve → Razorpay linked account (`POST /v2/accounts`) → customer checkout order → webhook → capture + Route transfer → booking `paid`**.

## Important Razorpay API facts

1. **`POST /v1/payments/:id/capture`** accepts only `amount` and `currency`. It does **not** accept a `transfers` array.
2. Vendor split after capture uses **`POST /v1/payments/:id/transfers`** with the linked account id (`acc_...`). This service runs capture (if needed) then transfers in one code path from **`payment.captured`** / **`order.paid`** webhooks.
3. Optional shortcut: **`POST /api/v1/razorpay/route/orders`** embeds `transfers` on the **order** so Razorpay can split when the charge settles (no separate transfer call). The main booking flow uses **plain orders + webhook split** as requested.

## Environment

Copy `backend/.env.example` to `backend/.env` and set at least:

- `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`
- `RAZORPAY_WEBHOOK_SECRET` (from Dashboard → Webhooks)
- `ADMIN_API_KEY` (your own secret; send as `X-Admin-Key`)
- `DATABASE_URL` (default SQLite path is fine for dev)

For **`POST /api/v1/admin/vendor/{id}/approve`**, Razorpay requires a full **`profile`** and **`legal_info`** object. Either:

- send them in the JSON body, or  
- set `DEFAULT_ROUTE_ACCOUNT_PROFILE_JSON` and `DEFAULT_ROUTE_ACCOUNT_LEGAL_JSON` (valid JSON objects).

Use real PAN, address, and business data from your compliance process; placeholders will fail live validation.

## Run

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload --port 8088
```

- OpenAPI: `http://127.0.0.1:8088/docs`
- Webhook URL (configure in Razorpay): `https://<your-host>/razorpay/webhook`

## Marketplace (India barber / shop flows)

SQL tables: `salon_bookings`, `slot_holds`, `slot_history`, `waitlist_entries`, `reminder_jobs`. Extended `vendors` with rating, rates, badges JSON, availability JSON, city code.

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/v1/marketplace/fee-preview` | Service INR + slot → platform fee (first booking free, peak band, deposit hint) |
| POST | `/api/v1/marketplace/slot-hold` | TTL lock to prevent double booking |
| POST | `/api/v1/marketplace/salon-bookings` | Commit hold → salon row (masked phone hash anti-bypass) |
| POST | `/api/v1/marketplace/salon-bookings/{id}/phase1-checkout` | Razorpay order for **platform fee only** |
| POST | `/api/v1/marketplace/salon-bookings/{id}/barber-decision` | Accept / reject when not auto-confirmed |
| POST | `/api/v1/marketplace/waitlist` | Waitlist for dropped slots |
| POST | `/api/v1/marketplace/vendor/availability` | JSON availability / break payload |

Admin: `GET /api/v1/admin/dashboard/summary`, `GET /api/v1/admin/dashboard/trust-leaderboard`, `POST /api/v1/admin/dashboard/slot-sweep`.

Webhook: `payment.captured` updates `salon_bookings.payment_status` to `platform_fee_paid` when the order matches a salon Phase 1 fee payment (before legacy Route booking handling).

Delete `data/app.db` after schema changes during active dev.

## Main HTTP routes

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/v1/vendors/application` | Vendor self-serve registration (`pending`) |
| POST | `/api/v1/admin/vendor/{id}/approve` | Create linked account + store `razorpay_account_id` |
| POST | `/api/v1/admin/vendor/{id}/reject` | Mark vendor `rejected` |
| GET | `/api/v1/admin/vendors` | List vendors (`X-Admin-Key`) |
| GET | `/api/v1/admin/bookings` | List bookings (`X-Admin-Key`) |
| POST | `/api/v1/bookings/checkout` | Create booking + Razorpay order (server-side totals) |
| POST | `/razorpay/webhook` | Signature verify + `payment.captured` / `order.paid` handling |
| POST | `/api/v1/razorpay/route/...` | Legacy/alternate Route helpers (quote, order+transfers, capture+transfer) |

## Booking fields (persisted)

`base_price_inr`, `platform_fee_inr`, `total_amount_inr`, `vendor_payout_inr`, matching paise columns, `razorpay_order_id`, `razorpay_payment_id`, `status` (`created` → `awaiting_payment` → `paid` / `failed`), `transfer_error`.

## Security

- Keys only in environment.
- Webhook body verified with `X-Razorpay-Signature` + `RAZORPAY_WEBHOOK_SECRET`.
- Admin routes require `X-Admin-Key`.
- Set `ROUTE_INTERNAL_API_KEY` and `X-Route-Internal-Key` for checkout and legacy route endpoints in production.

## HTTPS

Terminate TLS at your reverse proxy (nginx, Cloud Run, ELB, etc.); the app serves HTTP locally.

# Sports Event Manager — Setup Guide

## Prerequisites
- Node.js 20+
- Docker Desktop
- Azure CLI (`az`)
- Supabase CLI (`npx supabase`)
- A Twilio account with a phone number

---

## 1. Local development

```bash
# Clone and install
git clone https://github.com/your-org/sports-event-manager
cd sports-event-manager
npm install

# Copy env template and fill in your dev Supabase + Twilio values
cp .env.local.example .env.local

# Run locally
npm run dev
# or via Docker:
docker compose up
```

---

## 2. Supabase — dev project

1. Go to supabase.com → New project → name it `sports-event-manager-dev`
2. Copy the project URL and anon key into `.env.local`
3. Copy the service role key into `.env.local` (keep this secret)
4. Run migrations:

```bash
npx supabase db push --db-url postgresql://postgres:[password]@db.[project-ref].supabase.co:5432/postgres
# or via Supabase CLI linked project:
npx supabase link --project-ref your-dev-project-ref
npx supabase db push
```

5. Enable Phone Auth in Supabase dashboard:
   - Authentication → Providers → Phone → Enable
   - Set your Twilio Account SID, Auth Token, and phone number

---

## 3. Supabase — prod project

Repeat step 2 with a new project named `sports-event-manager-prod`.

---

## 4. Azure — dev environment

```bash
# Login
az login

# Create resource group
az group create --name sports-event-manager-dev-rg --location swedencentral

# Create Azure Container Registry
az acr create \
  --resource-group sports-event-manager-dev-rg \
  --name sportsevtmgrdev \
  --sku Basic

# Create Container Apps environment
az containerapp env create \
  --name sports-event-manager-dev-env \
  --resource-group sports-event-manager-dev-rg \
  --location swedencentral

# Create the Container App (first deploy)
az containerapp create \
  --name sports-event-manager-dev \
  --resource-group sports-event-manager-dev-rg \
  --environment sports-event-manager-dev-env \
  --image sportsevtmgrdev.azurecr.io/sports-event-manager:dev-latest \
  --target-port 3000 \
  --ingress external \
  --registry-server sportsevtmgrdev.azurecr.io
```

---

## 5. Azure — prod environment

Repeat step 4 with `-prod` suffixes and `swedencentral` (or your preferred region).

---

## 6. GitHub Actions secrets

Add these secrets to your GitHub repo (Settings → Secrets → Actions):

| Secret | Description |
|--------|-------------|
| `REGISTRY_LOGIN_SERVER` | e.g. `sportsevtmgrdev.azurecr.io` |
| `REGISTRY_USERNAME` | ACR username |
| `REGISTRY_PASSWORD` | ACR password |
| `AZURE_RESOURCE_GROUP_DEV` | `sports-event-manager-dev-rg` |
| `AZURE_RESOURCE_GROUP_PROD` | `sports-event-manager-prod-rg` |
| `DEV_SUPABASE_URL` | Dev project URL |
| `DEV_SUPABASE_ANON_KEY` | Dev anon key |
| `DEV_SUPABASE_SERVICE_ROLE_KEY` | Dev service role key |
| `PROD_SUPABASE_URL` | Prod project URL |
| `PROD_SUPABASE_ANON_KEY` | Prod anon key |
| `PROD_SUPABASE_SERVICE_ROLE_KEY` | Prod service role key |
| `TWILIO_ACCOUNT_SID` | From console.twilio.com |
| `TWILIO_AUTH_TOKEN` | From console.twilio.com |
| `TWILIO_PHONE_NUMBER` | Your Twilio number e.g. `+46...` |
| `DEV_APP_URL` | Your dev Container App URL |
| `PROD_APP_URL` | Your prod Container App URL |

---

## 7. Deployment flow

| Trigger | Target |
|---------|--------|
| Push to `main` | Dev environment |
| Push a tag `v*.*.*` (e.g. `v1.0.0`) | Prod environment |

```bash
# Deploy to prod
git tag v1.0.0
git push origin v1.0.0
```

---

## 8. Generate TypeScript types from Supabase

After running migrations, regenerate the types file:

```bash
npx supabase gen types typescript \
  --project-id your-dev-project-ref \
  > src/types/database.ts
```

Repeat for prod when the schema changes.

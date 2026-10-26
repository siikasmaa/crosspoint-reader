# CrossPoint OTA Worker

A Cloudflare Worker that serves firmware updates for CrossPoint Reader devices. Uses R2 for firmware binary storage.

No account ids, tokens or domains are committed. Everything deployment-specific comes from the environment or a `.env` file in the repository root (see `.env.example`).

## Setup

### 1. Configure credentials

Copy `.env.example` to `.env` in the repository root and fill in:

| Variable | Purpose |
|---|---|
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account to deploy into |
| `CLOUDFLARE_API_TOKEN` | API token with Workers Scripts and R2 edit permissions |
| `OTA_ROUTE_PATTERN` | Optional custom domain route, e.g. `ota.example.com/*` |
| `OTA_SERVER_URL` | Default OTA URL baked into the firmware (see below) |

### 2. Create the R2 bucket

```bash
cd tools/ota-worker
npm ci
npx wrangler r2 bucket create crosspoint-firmware
```

### 3. Deploy the worker

```bash
npm run deploy
```

`deploy.mjs` loads `.env`, then runs `wrangler deploy`, adding `--routes $OTA_ROUTE_PATTERN` when set. Without a route the worker is reachable at `https://crosspoint-ota.<your-subdomain>.workers.dev`.

### 4. Point the firmware at the worker

Set `OTA_SERVER_URL` in `.env` to `<worker url>/releases/latest` and rebuild. The value becomes the firmware's default "OTA Server URL" setting, which can still be changed on the device under Settings → System. Leave it empty to default to the upstream GitHub releases API.

The device's HTTP client cannot validate every certificate chain, so an `http://` URL on a custom domain is the most reliable choice. The worker mirrors the request protocol in the firmware download URL it returns.

## Uploading firmware

CI does this automatically (see `.github/workflows`). Manually:

```bash
cd tools/ota-worker
pio run -e gh_release -d ../..
SIZE=$(stat -c%s ../../.pio/build/gh_release/firmware.bin)
npx wrangler r2 object put crosspoint-firmware/firmware.bin \
  --file=../../.pio/build/gh_release/firmware.bin --content-type=application/octet-stream
echo "{\"version\": \"1.3.0\", \"size\": $SIZE}" > /tmp/version.json
npx wrangler r2 object put crosspoint-firmware/version.json \
  --file=/tmp/version.json --content-type=application/json
```

## CI configuration

The workflows read these GitHub repository **secrets**:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

and these repository **variables**:

- `OTA_SERVER_URL` – baked into CI firmware builds and shown as the deployment environment URL
- `OTA_ROUTE_PATTERN` – optional custom domain route for the worker

## API endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/releases/latest` | GET | Returns update metadata (GitHub releases API format) |
| `/firmware.bin` | GET | Downloads the firmware binary |
| `/health` | GET | Health check |

### Response format (`/releases/latest`)

```json
{
  "tag_name": "1.3.0",
  "assets": [
    {
      "name": "firmware.bin",
      "browser_download_url": "https://crosspoint-ota.example.workers.dev/firmware.bin",
      "size": 1234567
    }
  ]
}
```

This matches the GitHub Releases API format that the device's `OtaUpdater` expects.

## R2 bucket layout

```
crosspoint-firmware/
  firmware.bin    — the firmware binary
  version.json    — {"version": "1.3.0", "size": 1234567}
```

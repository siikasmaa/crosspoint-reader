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

The `deploy-ota` job in `.github/workflows/ci.yml` does this on every push to the fork's working branch: it takes the `default` (ESP32-C3 X3/X4) build from the CI matrix, uploads it as `firmware.bin` and writes `version.json` with `<platformio.ini version>-<short sha>`, e.g. `1.6.5-abc1234`. The firmware built in the same run carries the identical `CROSSPOINT_VERSION` (via `CROSSPOINT_BUILD_SHA`), so a device that has installed that build sees no further update until the next push. Only the `default` env is served; the other boards (sticky, x4pro, x4c, papermono) are built in CI but not published here.

Manually, from the repository root:

```bash
CROSSPOINT_BUILD_SHA=$(git rev-parse HEAD) pio run -e default
BASE=$(sed -n 's/^version[[:space:]]*=[[:space:]]*//p' platformio.ini | head -n1)
VERSION="$BASE-$(git rev-parse --short=7 HEAD)"
SIZE=$(stat -c%s .pio/build/default/firmware.bin)
cd tools/ota-worker
npx wrangler r2 object put crosspoint-firmware/firmware.bin \
  --file=../../.pio/build/default/firmware.bin --content-type=application/octet-stream
echo "{\"version\": \"$VERSION\", \"size\": $SIZE}" > /tmp/version.json
npx wrangler r2 object put crosspoint-firmware/version.json \
  --file=/tmp/version.json --content-type=application/json
```

## CI configuration

- `ci.yml` – builds all boards; on pushes to `customisation`/`customisation-v2` the `deploy-ota` job uploads the `default` build to R2 and redeploys the worker (GitHub environment `ota-worker`).
- `deploy-worker.yml` – redeploys only the worker when `tools/ota-worker/**` changes, or via workflow_dispatch.

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
  "tag_name": "1.6.5-abc1234",
  "assets": [
    {
      "name": "firmware.bin",
      "browser_download_url": "https://crosspoint-ota.example.workers.dev/firmware.bin",
      "size": 1234567
    }
  ]
}
```

This is the GitHub Releases API shape the device's `OtaUpdater` parses. Note the asset name: upstream CrossPoint (1.6+) looks for `crosspoint-<tag>-<device>.bin` in real GitHub releases, while the fork's `OtaUpdater` looks for a fixed `firmware.bin` whenever a custom OTA server URL is configured. The worker always serves exactly one asset named `firmware.bin`, so keep that name if you change either side.

## R2 bucket layout

```
crosspoint-firmware/
  firmware.bin    — the firmware binary (default/ESP32-C3 env)
  version.json    — {"version": "1.6.5-abc1234", "size": 1234567}
```

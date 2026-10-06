# CrossPoint OTA Worker

A Cloudflare Worker that serves firmware updates for CrossPoint Reader devices. Uses R2 for firmware binary storage.

## Setup

### 1. Create R2 bucket

```bash
npx wrangler r2 bucket create crosspoint-firmware
```

### 2. Deploy the worker

```bash
cd tools/ota-worker
npx wrangler deploy
```

Note the worker URL (e.g., `https://crosspoint-ota.<your-subdomain>.workers.dev`).

### 3. Set WORKER_URL

```bash
npx wrangler secret put WORKER_URL
# Enter: https://crosspoint-ota.<your-subdomain>.workers.dev
```

### 4. Configure the device

Set the OTA Server URL in the device's web settings to:
```
https://crosspoint-ota.<your-subdomain>.workers.dev/releases/latest
```

## Uploading firmware

```bash
# Build and upload a new release
./upload.sh 1.3.0
```

This will:
1. Build the `gh_release` environment with PlatformIO
2. Upload `firmware.bin` to R2
3. Upload `version.json` with version and size metadata

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
  version.json   — {"version": "1.3.0", "size": 1234567}
```

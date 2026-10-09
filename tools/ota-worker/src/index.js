/**
 * CrossPoint OTA Update Worker
 *
 * Serves firmware update metadata in the same JSON format as the GitHub
 * Releases API, so the device's OtaUpdater can consume it without changes.
 *
 * Firmware binaries are stored in a Cloudflare R2 bucket.
 *
 * Expected R2 layout:
 *   firmware.bin          — the latest firmware binary
 *   version.json          — {"version": "1.3.0", "size": 1234567}
 *
 * Alternatively, set FIRMWARE_VERSION in wrangler.toml and the worker
 * will read the binary size from R2 at request time.
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    // Make the request origin available for building download URLs
    env._requestOrigin = url.origin;

    // CORS headers for browser-based tools
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, User-Agent",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // GET /releases/latest — metadata (matches GitHub releases API shape)
    if (url.pathname === "/releases/latest" || url.pathname === "/") {
      return handleLatestRelease(env, corsHeaders);
    }

    // GET /firmware.bin — direct binary download
    if (url.pathname === "/firmware.bin") {
      return handleFirmwareDownload(env, corsHeaders);
    }

    // GET /health — simple health check
    if (url.pathname === "/health") {
      return new Response(JSON.stringify({ status: "ok" }), {
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    return new Response("Not Found", { status: 404, headers: corsHeaders });
  },
};

async function handleLatestRelease(env, corsHeaders) {
  try {
    // Try to read version.json from R2 first
    let version = env.FIRMWARE_VERSION || "0.0.0";
    let size = 0;

    const versionObj = await env.FIRMWARE_BUCKET.get("version.json");
    if (versionObj) {
      const versionData = JSON.parse(await versionObj.text());
      version = versionData.version || version;
      size = versionData.size || 0;
    }

    // If size not in version.json, get it from the firmware binary metadata
    if (size === 0) {
      const firmwareHead = await env.FIRMWARE_BUCKET.head("firmware.bin");
      if (firmwareHead) {
        size = firmwareHead.size;
      } else {
        return new Response(
          JSON.stringify({ error: "No firmware.bin found in bucket" }),
          {
            status: 404,
            headers: { "Content-Type": "application/json", ...corsHeaders },
          }
        );
      }
    }

    // Build download URL using the same protocol as the incoming request
    // so HTTP requests get HTTP firmware URLs and HTTPS gets HTTPS.
    const requestProto = new URL(env._requestOrigin).protocol;
    let baseUrl = env.WORKER_URL || env._requestOrigin;
    baseUrl = baseUrl.replace(/^https?:/, requestProto);
    const downloadUrl = `${baseUrl}/firmware.bin`;

    // Response matches GitHub releases API shape exactly
    const response = {
      tag_name: version,
      assets: [
        {
          name: "firmware.bin",
          browser_download_url: downloadUrl,
          size: size,
        },
      ],
    };

    const body = JSON.stringify(response);
    return new Response(body, {
      headers: {
        "Content-Type": "application/json",
        "Content-Length": new TextEncoder().encode(body).length.toString(),
        ...corsHeaders,
      },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Internal error", detail: err.message }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }
}

async function handleFirmwareDownload(env, corsHeaders) {
  try {
    const object = await env.FIRMWARE_BUCKET.get("firmware.bin");
    if (!object) {
      return new Response("firmware.bin not found", {
        status: 404,
        headers: corsHeaders,
      });
    }

    return new Response(object.body, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": object.size.toString(),
        "Content-Disposition": 'attachment; filename="firmware.bin"',
        ...corsHeaders,
      },
    });
  } catch (err) {
    return new Response("Download failed", {
      status: 500,
      headers: corsHeaders,
    });
  }
}

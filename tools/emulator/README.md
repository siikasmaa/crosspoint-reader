# CrossPoint Reader Emulator

Browser-based e-reader emulator that simulates the CrossPoint Reader's 800x480 e-ink display. Use it for visual testing of EPUB rendering without the physical device.

## Usage

1. Open `index.html` in any modern browser (no build step needed).
2. Click **Open EPUB** or drag-and-drop an `.epub` file onto the page.
3. Navigate pages with the on-screen buttons or arrow keys (Left/Right).
4. Open **Settings** to adjust font, size, margins, line spacing, alignment, and orientation.

## Features

- EPUB parsing via JSZip (loaded from CDN)
- Canvas rendering at 800x480 (landscape) or 480x800 (portrait)
- E-ink paper simulation (warm gray background, monochrome text)
- Floyd-Steinberg dithering toggle for images
- Justified, left, center, or right text alignment
- Chapter navigation via dropdown
- Settings persisted to localStorage

## Limitations

- Font rendering differs from the actual device (browser fonts vs embedded bitmap fonts).
- Complex CSS, tables, SVG content, and DRM-protected EPUBs are not supported.
- Image layout is approximate; the real firmware has a different scaling pipeline.
- This is a visual approximation tool, not a pixel-perfect replica of the device output.

## Dependencies

- [JSZip 3.10.1](https://stuk.github.io/jszip/) (loaded from CDN at runtime)
- No npm, no build tools required

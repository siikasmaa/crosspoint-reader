#include "CoverThumbTarget.h"

#include <Bitmap.h>
#include <GfxRenderer.h>
#include <HalStorage.h>

namespace fui = freeink::ui;

fui::BitmapRef CoverThumbTarget::coverThumbRef(const char* path, const int slotWidth, const int height) {
  fui::BitmapRef ref;
  ref.data = reinterpret_cast<const uint8_t*>(path);
  ref.width = static_cast<uint16_t>(slotWidth);
  ref.height = static_cast<uint16_t>(height);
  ref.format = fui::BitmapFormat::NativeBmp;
  ref.progmem = false;
  return ref;
}

void CoverThumbTarget::bitmap(const fui::Rect rect, const fui::BitmapRef bitmap, const fui::BitmapMode mode,
                              const fui::Paint foreground, const fui::Rotation rotation) {
  if (bitmap.format != fui::BitmapFormat::NativeBmp) {
    inner.bitmap(rect, bitmap, mode, foreground, rotation);
    return;
  }
  if (!bitmap || rect.empty()) return;

  // Streamed row by row from the card; the only pixel storage is one scratch
  // row inside drawBitmap, released before this returns. Pixels go through
  // drawPixel, so the component's clip (partial trailing rows) still applies.
  HalFile file;
  if (!Storage.openFileForRead("THUMB", reinterpret_cast<const char*>(bitmap.data), file)) return;
  Bitmap bmp(file);
  if (bmp.parseHeaders() != BmpReaderError::Ok || bmp.getWidth() <= 0 || bmp.getHeight() <= 0) return;
  // The component centres its square slot on the row; keep the taller
  // thumbnail on that same centre line, flush with the slot's left edge.
  const int y = rect.y + (rect.height - bitmap.height) / 2;
  renderer.drawBitmap(bmp, rect.x, y, bitmap.width, bitmap.height);
}

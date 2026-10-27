#pragma once

// cppcheck-suppress-file passedByValue ; freeink::ui::DrawTarget's virtuals take Rect/Paint/Style by value

#include <FreeInkUIGfxRenderer.h>

class GfxRenderer;

// The DrawTarget every FUI screen renders through. Everything forwards to the
// font-bound GfxRendererTarget except bitmaps tagged BitmapFormat::NativeBmp:
// their `data` is a NUL-terminated SD path to a cached 1-bit cover thumbnail,
// streamed from the card into the slot the component laid out. A list row can
// show its cover that way without any decoded pixels living in RAM between
// frames (see ListCoverThumbs).
class CoverThumbTarget final : public freeink::ui::DrawTarget {
 public:
  CoverThumbTarget(freeink::ui::GfxRendererTarget& inner, const GfxRenderer& renderer)
      : inner(inner), renderer(renderer) {}

  // Row icon the target streams from `path` at draw time. The component
  // reserves a square `slotWidth` box, so the label shifts right by exactly
  // the thumbnail's width; the thumbnail itself fits `height` tall, centred
  // on that box. `path` must stay valid until the row has been drawn.
  static freeink::ui::BitmapRef coverThumbRef(const char* path, int slotWidth, int height);

  freeink::ui::Rect clipRect() const override { return inner.clipRect(); }
  bool setClipRect(const freeink::ui::Rect rect) override { return inner.setClipRect(rect); }
  freeink::ui::Size measureText(const freeink::ui::FontId font, const char* text,
                                const freeink::ui::TextStyle style) const override {
    return inner.measureText(font, text, style);
  }
  int16_t lineHeight(const freeink::ui::FontId font) const override { return inner.lineHeight(font); }
  void fill(const freeink::ui::Rect rect, const freeink::ui::Paint paint, const uint8_t radius = 0,
            const uint8_t corners = freeink::ui::CornersAll) override {
    inner.fill(rect, paint, radius, corners);
  }
  void stroke(const freeink::ui::Rect rect, const freeink::ui::Paint paint, const uint8_t width,
              const uint8_t radius = 0, const uint8_t corners = freeink::ui::CornersAll) override {
    inner.stroke(rect, paint, width, radius, corners);
  }
  void line(const freeink::ui::Point from, const freeink::ui::Point to, const uint8_t width,
            const freeink::ui::Paint paint) override {
    inner.line(from, to, width, paint);
  }
  void triangle(const freeink::ui::Point a, const freeink::ui::Point b, const freeink::ui::Point c,
                const freeink::ui::Paint paint) override {
    inner.triangle(a, b, c, paint);
  }
  void text(const freeink::ui::Rect rect, const char* text, const freeink::ui::TextStyle style) override {
    inner.text(rect, text, style);
  }
  void bitmap(freeink::ui::Rect rect, freeink::ui::BitmapRef bitmap, freeink::ui::BitmapMode mode,
              freeink::ui::Paint foreground = freeink::ui::Paint::solid(freeink::ui::Color::Black),
              freeink::ui::Rotation rotation = freeink::ui::Rotation::None) override;

 private:
  freeink::ui::GfxRendererTarget& inner;
  const GfxRenderer& renderer;
};

#include "ListCoverThumbs.h"

#include <Epub.h>
#include <FsHelpers.h>
#include <HalStorage.h>
#include <Logging.h>
#include <Memory.h>
#include <Xtc.h>

#include <cstdio>
#include <functional>

#include "CrossPointSettings.h"
#include "components/UiAppHelpers.h"

namespace fui = freeink::ui;

namespace ListCoverThumbs {

bool enabled() {
  return SETTINGS.uiTheme == CrossPointSettings::LYRA || SETTINGS.uiTheme == CrossPointSettings::LYRA_3_COVERS;
}

int rowThumbHeight(UiAppHost::UiScreen& screen) {
  // The Library's row recipe: body label, small subtitle, 32 px icon. The
  // width only matters for wrapping, which a one-character label never does.
  fui::ListProps props;
  props.labelText = screen.theme().bodyText;
  props.labelText.maxLines = 1;
  const fui::ListProps themed = screen.resolveListProps(props);
  fui::ListItem sample;
  sample.label = "A";
  sample.subtitle = "A";
  sample.icon = listIconFor(UIIcon::Book, 32);
  const int rowHeight = fui::measureListRow(screen.target(), nullptr, 400, themed, sample).height;
  const int height = boxHeightForRow(rowHeight);
  return height > 0 ? height : 0;
}

bool thumbPathFor(const std::string& bookPath, const int height, char* out, const size_t outSize) {
  const char* kind = nullptr;
  if (FsHelpers::hasEpubExtension(bookPath)) {
    kind = "epub";
  } else if (FsHelpers::hasXtcExtension(bookPath)) {
    kind = "xtc";
  } else {
    return false;
  }
  // Same key as the Epub/Xtc constructors derive, without building either
  // (they carry parsers and several strings) for every row drawn.
  const auto hash = static_cast<unsigned long>(std::hash<std::string>{}(bookPath));
  const int written = snprintf(out, outSize, "/.crosspoint/%s_%lu/thumb_%d.bmp", kind, hash, height);
  return written > 0 && static_cast<size_t>(written) < outSize;
}

bool cachedThumbPath(const std::string& bookPath, const int height, char* out, const size_t outSize) {
  return thumbPathFor(bookPath, height, out, outSize) && Storage.exists(out);
}

bool generate(const std::string& bookPath, const int height) {
  // One parser at a time, on the heap: both objects exceed the task stack budget.
  if (FsHelpers::hasEpubExtension(bookPath)) {
    auto epub = makeUniqueNoThrow<Epub>(bookPath, "/.crosspoint");
    if (!epub) {
      LOG_ERR("THUMB", "OOM: EPUB cover");
      return false;
    }
    return epub->generateThumbBmpFromSource(height);
  }
  if (FsHelpers::hasXtcExtension(bookPath)) {
    auto xtc = makeUniqueNoThrow<Xtc>(bookPath, "/.crosspoint");
    if (!xtc) {
      LOG_ERR("THUMB", "OOM: XTC cover");
      return false;
    }
    return xtc->load() && xtc->generateThumbBmp(height);
  }
  return false;
}

}  // namespace ListCoverThumbs

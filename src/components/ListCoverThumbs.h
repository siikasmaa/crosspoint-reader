#pragma once

#include <cstddef>
#include <string>

#include "components/UiAppHost.h"

// Cover thumbnails in Lyra list rows. A book row whose thumbnail is already
// cached under /.crosspoint/<epub|xtc>_<hash>/thumb_<height>.bmp shows it in
// place of the file-type icon (see CoverThumbTarget); the file browser never
// generates one, the Library does for its recently opened books only.
namespace ListCoverThumbs {

// "/.crosspoint/epub_" + 10 digits + "/thumb_" + height + ".bmp" + NUL.
constexpr size_t PATH_BUF_SIZE = 64;

// Lyra rows only; every other theme keeps its file-type icons.
bool enabled();

// Height of the thumbnail a title + author row holds: the screen's resolved
// row metrics less a little air above and below. Thumbnails are generated at
// this height so the Library draws them 1:1; shorter rows scale them down.
int rowThumbHeight(UiAppHost::UiScreen& screen);

// Thumbnail box for a row `rowHeight` tall, and the 2:3 slot that box needs.
constexpr int boxHeightForRow(const int rowHeight) { return rowHeight - 8; }
constexpr int slotWidth(const int height) { return height * 2 / 3; }

// Writes the cache path of `bookPath`'s thumbnail at `height` into `out`.
// Returns false (and writes nothing) for anything but an EPUB or XTC.
bool thumbPathFor(const std::string& bookPath, int height, char* out, size_t outSize);

// thumbPathFor plus a card lookup: true only when the file exists.
bool cachedThumbPath(const std::string& bookPath, int height, char* out, size_t outSize);

// Generate the thumbnail at `height` from the book's cover. Returns true when
// the file now exists. Slow (opens and parses the book); call from a render
// pass that shows progress, never while paging.
bool generate(const std::string& bookPath, int height);

}  // namespace ListCoverThumbs

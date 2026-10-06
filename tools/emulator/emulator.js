// CrossPoint Reader Emulator
// Browser-based EPUB viewer simulating the 800x480 e-ink display.

"use strict";

// ---------------------------------------------------------------------------
// EpubParser -- loads an EPUB from an ArrayBuffer using JSZip
// ---------------------------------------------------------------------------

class EpubParser {
  constructor() {
    this.zip = null;
    this.opfPath = "";
    this.opfDir = "";
    this.metadata = { title: "Unknown", author: "Unknown", coverHref: null };
    this.manifest = {};   // id -> {href, mediaType}
    this.spine = [];      // ordered array of manifest ids
    this.chapters = [];   // [{id, href, label}]
    this.blobCache = {};  // href -> blob URL
  }

  async load(arrayBuffer) {
    this.zip = await JSZip.loadAsync(arrayBuffer);

    // 1. Find OPF via container.xml
    const containerXml = await this._readText("META-INF/container.xml");
    const containerDoc = new DOMParser().parseFromString(containerXml, "application/xml");
    const rootfile = containerDoc.querySelector("rootfile");
    if (!rootfile) throw new Error("No rootfile in container.xml");
    this.opfPath = rootfile.getAttribute("full-path");
    this.opfDir = this.opfPath.includes("/")
      ? this.opfPath.substring(0, this.opfPath.lastIndexOf("/") + 1)
      : "";

    // 2. Parse OPF
    const opfXml = await this._readText(this.opfPath);
    const opfDoc = new DOMParser().parseFromString(opfXml, "application/xml");
    this._parseMetadata(opfDoc);
    this._parseManifest(opfDoc);
    this._parseSpine(opfDoc);
    this._buildChapterList(opfDoc);
  }

  _parseMetadata(doc) {
    const meta = doc.querySelector("metadata");
    if (!meta) return;

    const titleEl = meta.querySelector("title");
    if (titleEl) this.metadata.title = titleEl.textContent.trim();

    const creatorEl = meta.querySelector("creator");
    if (creatorEl) this.metadata.author = creatorEl.textContent.trim();

    // Cover image: look for meta cover, then manifest item with cover-image property
    const coverMeta = meta.querySelector('meta[name="cover"]');
    if (coverMeta) {
      const coverId = coverMeta.getAttribute("content");
      if (this.manifest[coverId]) {
        this.metadata.coverHref = this.manifest[coverId].href;
      }
    }
  }

  _parseManifest(doc) {
    const items = doc.querySelectorAll("manifest > item");
    for (const item of items) {
      const id = item.getAttribute("id");
      const href = item.getAttribute("href");
      const mediaType = item.getAttribute("media-type") || "";
      const properties = item.getAttribute("properties") || "";
      this.manifest[id] = { href, mediaType, properties };

      if (properties.includes("cover-image")) {
        this.metadata.coverHref = href;
      }
    }
  }

  _parseSpine(doc) {
    const itemrefs = doc.querySelectorAll("spine > itemref");
    this.spine = [];
    for (const ref of itemrefs) {
      this.spine.push(ref.getAttribute("idref"));
    }
  }

  _buildChapterList(doc) {
    this.chapters = [];
    // Try to find NCX or NAV for labels; fall back to spine order with manifest hrefs
    const navItem = Object.values(this.manifest).find(
      (m) => m.properties && m.properties.includes("nav")
    );

    // We'll map spine IDs to chapters with simple labels
    for (let i = 0; i < this.spine.length; i++) {
      const id = this.spine[i];
      const entry = this.manifest[id];
      if (!entry) continue;
      this.chapters.push({
        id,
        href: entry.href,
        label: `Chapter ${i + 1}`,
      });
    }

    // Attempt to read nav document for better labels
    if (navItem) {
      this._loadNavLabels(navItem.href);
    }
  }

  async _loadNavLabels(navHref) {
    try {
      const navXml = await this._readText(this.opfDir + navHref);
      const navDoc = new DOMParser().parseFromString(navXml, "application/xhtml+xml");
      const tocNav = navDoc.querySelector('nav[epub\\:type="toc"], nav[role="doc-toc"], nav');
      if (!tocNav) return;
      const links = tocNav.querySelectorAll("a");
      const labelMap = {};
      for (const a of links) {
        let href = a.getAttribute("href") || "";
        // Strip fragment
        href = href.split("#")[0];
        labelMap[href] = a.textContent.trim();
      }
      // Assign labels
      for (const ch of this.chapters) {
        if (labelMap[ch.href]) {
          ch.label = labelMap[ch.href];
        }
      }
    } catch (_) {
      // Navigation labels are non-critical
    }
  }

  async getChapterContent(index) {
    if (index < 0 || index >= this.chapters.length) return "";
    const href = this.opfDir + this.chapters[index].href;
    return this._readText(href);
  }

  async getImageBlob(href) {
    if (this.blobCache[href]) return this.blobCache[href];
    const fullPath = this.opfDir + href;
    const file = this.zip.file(fullPath);
    if (!file) return null;
    const blob = await file.async("blob");
    const url = URL.createObjectURL(blob);
    this.blobCache[href] = url;
    return url;
  }

  async getCoverBlob() {
    if (!this.metadata.coverHref) return null;
    return this.getImageBlob(this.metadata.coverHref);
  }

  getMetadata() {
    return { ...this.metadata };
  }

  getChapters() {
    return this.chapters;
  }

  async _readText(path) {
    // Try exact path first, then case-insensitive search
    let file = this.zip.file(path);
    if (!file) {
      // Some EPUBs have inconsistent casing
      const lower = path.toLowerCase();
      this.zip.forEach((relPath, entry) => {
        if (relPath.toLowerCase() === lower) file = entry;
      });
    }
    if (!file) throw new Error("File not found in EPUB: " + path);
    return file.async("string");
  }
}

// ---------------------------------------------------------------------------
// LayoutEngine -- paginates XHTML content for a given canvas size
// ---------------------------------------------------------------------------

class LayoutEngine {
  constructor(settings) {
    this.settings = settings;
    // Offscreen canvas for text measurement
    this._measureCanvas = document.createElement("canvas");
    this._measureCtx = this._measureCanvas.getContext("2d");
  }

  updateSettings(settings) {
    this.settings = settings;
  }

  /**
   * Paginate parsed XHTML content into pages of drawable elements.
   * @param {string} xhtml - The XHTML string from the EPUB chapter
   * @param {number} cw - Canvas width
   * @param {number} ch - Canvas height
   * @param {Function} resolveImage - async (href) => blobURL
   * @returns {Promise<Array<{elements: Array}>>} pages
   */
  async paginate(xhtml, cw, ch, resolveImage) {
    const s = this.settings;
    const margin = s.margin;
    const contentW = cw - margin * 2;
    const contentH = ch - margin * 2;
    const fontSize = s.fontSize;
    const lineH = Math.round(fontSize * s.lineHeight);
    const paraSpacing = Math.round(lineH * 0.6);
    const align = s.align;
    const fontFamily = s.fontFamily;

    // Parse the XHTML
    let doc;
    try {
      doc = new DOMParser().parseFromString(xhtml, "application/xhtml+xml");
    } catch (_) {
      doc = new DOMParser().parseFromString(xhtml, "text/html");
    }

    // Check for parse errors and fall back to text/html
    if (doc.querySelector("parsererror")) {
      doc = new DOMParser().parseFromString(xhtml, "text/html");
    }

    const body = doc.body || doc.documentElement;

    // Walk the DOM and produce a flat list of layout items
    const items = [];
    await this._walkNode(body, items, {
      bold: false,
      italic: false,
      heading: 0,
      fontSize,
      fontFamily,
    }, resolveImage);

    // Now lay out items into pages
    return this._layoutItems(items, contentW, contentH, margin, lineH, paraSpacing, align, fontFamily, fontSize);
  }

  async _walkNode(node, items, style, resolveImage) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent.replace(/\s+/g, " ");
      if (text.trim().length === 0) return;
      items.push({
        type: "text",
        text,
        bold: style.bold,
        italic: style.italic,
        heading: style.heading,
        fontSize: style.fontSize,
        fontFamily: style.fontFamily,
      });
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const tag = node.tagName.toLowerCase();

    // Skip script and style
    if (tag === "script" || tag === "style" || tag === "head") return;

    // Determine style mutations
    const newStyle = { ...style };
    let isBlock = false;
    let isHeading = 0;

    if (tag === "b" || tag === "strong") newStyle.bold = true;
    if (tag === "i" || tag === "em" || tag === "cite") newStyle.italic = true;

    const headingMatch = tag.match(/^h([1-6])$/);
    if (headingMatch) {
      isHeading = parseInt(headingMatch[1]);
      newStyle.heading = isHeading;
      newStyle.bold = true;
      // Scale heading font size
      const scale = [1.6, 1.4, 1.25, 1.1, 1.05, 1.0];
      newStyle.fontSize = Math.round(style.fontSize * scale[isHeading - 1]);
      isBlock = true;
    }

    if (["p", "div", "blockquote", "section", "article", "li", "dd", "dt", "figcaption", "pre"].includes(tag)) {
      isBlock = true;
    }

    if (tag === "br") {
      items.push({ type: "linebreak" });
      return;
    }

    if (tag === "hr") {
      items.push({ type: "separator" });
      return;
    }

    // Handle images
    if (tag === "img" || tag === "image") {
      const src = node.getAttribute("src") || node.getAttribute("xlink:href") || node.getAttributeNS("http://www.w3.org/1999/xlink", "href") || "";
      if (src && resolveImage) {
        const blobUrl = await resolveImage(src);
        if (blobUrl) {
          items.push({ type: "image", src: blobUrl });
        }
      }
      return;
    }

    // SVG with embedded image
    if (tag === "svg") {
      const imgEl = node.querySelector("image");
      if (imgEl) {
        const src = imgEl.getAttribute("xlink:href") || imgEl.getAttribute("href") || "";
        if (src && resolveImage) {
          const blobUrl = await resolveImage(src);
          if (blobUrl) {
            items.push({ type: "image", src: blobUrl });
          }
        }
      }
      return;
    }

    if (isBlock) items.push({ type: "paraStart" });

    for (const child of node.childNodes) {
      await this._walkNode(child, items, newStyle, resolveImage);
    }

    if (isBlock) items.push({ type: "paraEnd" });
  }

  _layoutItems(items, contentW, contentH, margin, lineH, paraSpacing, align, fontFamily, baseFontSize) {
    const pages = [];
    let currentPage = { elements: [] };
    let x = margin;
    let y = margin;
    let lineWords = [];
    let lineWidth = 0;
    let currentFont = this._fontStr(false, false, baseFontSize, fontFamily);
    let inParagraph = false;

    const flushLine = (isLastInPara) => {
      if (lineWords.length === 0) return;

      const elements = [];
      let drawX = margin;

      if (align === "center") {
        drawX = margin + (contentW - lineWidth) / 2;
      } else if (align === "right") {
        drawX = margin + contentW - lineWidth;
      }

      if (align === "justify" && !isLastInPara && lineWords.length > 1) {
        const totalTextW = lineWords.reduce((s, w) => s + w.width, 0);
        const extraSpace = contentW - totalTextW;
        const gaps = lineWords.length - 1;
        const gapW = extraSpace / gaps;
        let cx = margin;
        for (const w of lineWords) {
          elements.push({
            type: "text",
            x: cx,
            y,
            text: w.text,
            font: w.font,
          });
          cx += w.width + gapW;
        }
      } else {
        for (const w of lineWords) {
          elements.push({
            type: "text",
            x: drawX,
            y,
            text: w.text,
            font: w.font,
          });
          drawX += w.width + this._spaceWidth(w.font);
        }
      }

      currentPage.elements.push(...elements);
      y += lineH;
      lineWords = [];
      lineWidth = 0;

      // Page break check
      if (y + lineH > margin + contentH) {
        pages.push(currentPage);
        currentPage = { elements: [] };
        y = margin;
      }
    };

    const ctx = this._measureCtx;

    for (const item of items) {
      if (item.type === "paraStart") {
        // Add paragraph spacing if not at top of page
        if (inParagraph) {
          flushLine(true);
        }
        if (y > margin + paraSpacing) {
          // Only add spacing if we aren't right at the top
          if (lineWords.length === 0 && currentPage.elements.length > 0) {
            y += paraSpacing;
            if (y + lineH > margin + contentH) {
              pages.push(currentPage);
              currentPage = { elements: [] };
              y = margin;
            }
          }
        }
        inParagraph = true;
        continue;
      }

      if (item.type === "paraEnd") {
        flushLine(true);
        inParagraph = false;
        continue;
      }

      if (item.type === "linebreak") {
        flushLine(true);
        continue;
      }

      if (item.type === "separator") {
        flushLine(true);
        y += paraSpacing;
        currentPage.elements.push({
          type: "separator",
          x: margin,
          y: y - paraSpacing / 2,
          width: contentW,
        });
        if (y + lineH > margin + contentH) {
          pages.push(currentPage);
          currentPage = { elements: [] };
          y = margin;
        }
        continue;
      }

      if (item.type === "image") {
        flushLine(true);
        currentPage.elements.push({
          type: "image",
          src: item.src,
          x: margin,
          y,
          maxWidth: contentW,
          maxHeight: contentH - (y - margin),
        });
        // Reserve space for image (estimate; actual rendering will handle sizing)
        y += Math.min(contentH * 0.4, contentH - (y - margin));
        if (y + lineH > margin + contentH) {
          pages.push(currentPage);
          currentPage = { elements: [] };
          y = margin;
        }
        continue;
      }

      if (item.type === "text") {
        const font = this._fontStr(item.bold, item.italic, item.fontSize || baseFontSize, item.fontFamily || fontFamily);
        currentFont = font;
        ctx.font = font;

        const words = item.text.split(/\s+/).filter((w) => w.length > 0);
        const spaceW = this._spaceWidth(font);

        for (const word of words) {
          const wordW = ctx.measureText(word).width;

          // Check if word fits on current line
          const neededW = lineWords.length > 0 ? spaceW + wordW : wordW;
          if (lineWidth + neededW > contentW && lineWords.length > 0) {
            // Wrap to next line
            flushLine(false);
          }

          if (lineWords.length > 0) {
            lineWidth += spaceW;
          }
          lineWords.push({ text: word, width: wordW, font });
          lineWidth += wordW;
        }
      }
    }

    // Flush remaining content
    flushLine(true);
    if (currentPage.elements.length > 0) {
      pages.push(currentPage);
    }

    // If no pages produced, return one empty page
    if (pages.length === 0) {
      pages.push({ elements: [] });
    }

    return pages;
  }

  _fontStr(bold, italic, size, family) {
    const style = italic ? "italic " : "";
    const weight = bold ? "bold " : "";
    return `${style}${weight}${size}px ${family}`;
  }

  _spaceWidth(font) {
    this._measureCtx.font = font;
    return this._measureCtx.measureText(" ").width;
  }
}

// ---------------------------------------------------------------------------
// EinkRenderer -- draws pages to canvas with e-ink look
// ---------------------------------------------------------------------------

class EinkRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.grayscale = true;
    this.dithering = false;
    this._imageCache = {};
  }

  setSize(w, h) {
    this.canvas.width = w;
    this.canvas.height = h;
  }

  async renderPage(page) {
    const ctx = this.ctx;
    const cw = this.canvas.width;
    const ch = this.canvas.height;

    // E-ink paper background
    ctx.fillStyle = "#e8e4df";
    ctx.fillRect(0, 0, cw, ch);

    // Text color
    ctx.fillStyle = "#1a1a1a";

    for (const el of page.elements) {
      if (el.type === "text") {
        ctx.font = el.font;
        ctx.fillStyle = "#1a1a1a";
        ctx.textBaseline = "top";
        ctx.fillText(el.text, el.x, el.y);
      } else if (el.type === "separator") {
        ctx.strokeStyle = "#999";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(el.x + el.width * 0.2, el.y);
        ctx.lineTo(el.x + el.width * 0.8, el.y);
        ctx.stroke();
      } else if (el.type === "image") {
        await this._drawImage(el);
      }
    }
  }

  async _drawImage(el) {
    const ctx = this.ctx;
    const img = await this._loadImage(el.src);
    if (!img) return;

    // Scale to fit
    let w = img.width;
    let h = img.height;
    const scale = Math.min(el.maxWidth / w, el.maxHeight / h, 1);
    w = Math.round(w * scale);
    h = Math.round(h * scale);

    // Center horizontally
    const x = el.x + (el.maxWidth - w) / 2;
    const y = el.y;

    ctx.drawImage(img, x, y, w, h);

    if (this.grayscale || this.dithering) {
      const imageData = ctx.getImageData(x, y, w, h);
      this._toGrayscale(imageData);
      if (this.dithering) {
        this._applyDithering(imageData);
      }
      ctx.putImageData(imageData, x, y);
    }
  }

  _loadImage(src) {
    if (this._imageCache[src]) {
      return Promise.resolve(this._imageCache[src]);
    }
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        this._imageCache[src] = img;
        resolve(img);
      };
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  _toGrayscale(imageData) {
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      const gray = Math.round(data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
      data[i] = gray;
      data[i + 1] = gray;
      data[i + 2] = gray;
    }
  }

  _applyDithering(imageData) {
    // Floyd-Steinberg dithering to simulate 1-bit e-ink
    const w = imageData.width;
    const h = imageData.height;
    const data = imageData.data;

    // Work with a float buffer for error diffusion
    const gray = new Float32Array(w * h);
    for (let i = 0; i < gray.length; i++) {
      gray[i] = data[i * 4]; // Already grayscale
    }

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * w + x;
        const oldVal = gray[idx];
        const newVal = oldVal < 128 ? 0 : 255;
        gray[idx] = newVal;
        const err = oldVal - newVal;

        if (x + 1 < w) gray[idx + 1] += err * 7 / 16;
        if (y + 1 < h) {
          if (x > 0) gray[(y + 1) * w + x - 1] += err * 3 / 16;
          gray[(y + 1) * w + x] += err * 5 / 16;
          if (x + 1 < w) gray[(y + 1) * w + x + 1] += err * 1 / 16;
        }
      }
    }

    for (let i = 0; i < gray.length; i++) {
      const v = Math.max(0, Math.min(255, Math.round(gray[i])));
      data[i * 4] = v;
      data[i * 4 + 1] = v;
      data[i * 4 + 2] = v;
    }
  }

  renderLoading(message) {
    const ctx = this.ctx;
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    ctx.fillStyle = "#e8e4df";
    ctx.fillRect(0, 0, cw, ch);
    ctx.fillStyle = "#666";
    ctx.font = "16px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(message || "Loading...", cw / 2, ch / 2);
    ctx.textAlign = "start";
  }

  renderWelcome() {
    const ctx = this.ctx;
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    ctx.fillStyle = "#e8e4df";
    ctx.fillRect(0, 0, cw, ch);

    ctx.fillStyle = "#1a1a1a";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    ctx.font = "bold 24px Georgia, serif";
    ctx.fillText("CrossPoint Reader Emulator", cw / 2, ch / 2 - 40);

    ctx.font = "16px Georgia, serif";
    ctx.fillStyle = "#555";
    ctx.fillText("Open an EPUB file or drag & drop to begin", cw / 2, ch / 2 + 10);
    ctx.fillText("800 x 480 e-ink display simulation", cw / 2, ch / 2 + 40);

    ctx.textAlign = "start";
  }
}

// ---------------------------------------------------------------------------
// EmulatorApp -- main application controller
// ---------------------------------------------------------------------------

class EmulatorApp {
  constructor() {
    this.parser = null;
    this.layout = null;
    this.renderer = null;

    this.currentChapter = 0;
    this.currentPage = 0;
    this.pages = [];

    this.settings = this._loadSettings();

    this._initDOM();
    this._initEvents();
    this._applySettings();

    this.renderer = new EinkRenderer(this.canvas);
    this.layout = new LayoutEngine(this.settings);

    this._updateCanvasSize();
    this.renderer.renderWelcome();
  }

  _defaultSettings() {
    return {
      orientation: "landscape",
      fontFamily: "Georgia, 'Bookerly', serif",
      fontSize: 16,
      lineHeight: 1.5,
      margin: 20,
      align: "justify",
      grayscale: true,
      dithering: false,
    };
  }

  _loadSettings() {
    try {
      const saved = localStorage.getItem("crosspoint-emulator-settings");
      if (saved) {
        return { ...this._defaultSettings(), ...JSON.parse(saved) };
      }
    } catch (_) {}
    return this._defaultSettings();
  }

  _saveSettings() {
    try {
      localStorage.setItem("crosspoint-emulator-settings", JSON.stringify(this.settings));
    } catch (_) {}
  }

  _initDOM() {
    this.canvas = document.getElementById("eink-canvas");
    this.btnPrev = document.getElementById("btn-prev");
    this.btnNext = document.getElementById("btn-next");
    this.chapterSelect = document.getElementById("chapter-select");
    this.pageStatus = document.getElementById("page-status");
    this.settingsPanel = document.getElementById("settings-panel");
    this.settingsToggle = document.getElementById("settings-toggle");
    this.fileInput = document.getElementById("epub-upload");
    this.dropOverlay = document.getElementById("drop-overlay");

    // Settings inputs
    this.orientationEl = document.getElementById("setting-orientation");
    this.fontEl = document.getElementById("setting-font");
    this.fontSizeEl = document.getElementById("setting-fontsize");
    this.fontSizeVal = document.getElementById("fontsize-val");
    this.lineHeightEl = document.getElementById("setting-lineheight");
    this.lineHeightVal = document.getElementById("lineheight-val");
    this.marginEl = document.getElementById("setting-margin");
    this.marginVal = document.getElementById("margin-val");
    this.alignEl = document.getElementById("setting-align");
    this.grayscaleEl = document.getElementById("setting-grayscale");
    this.ditheringEl = document.getElementById("setting-dithering");
  }

  _initEvents() {
    // File input
    this.fileInput.addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (file) this._loadFile(file);
    });

    // Drag and drop
    document.addEventListener("dragover", (e) => {
      e.preventDefault();
      this.dropOverlay.classList.remove("hidden");
    });
    document.addEventListener("dragleave", (e) => {
      if (e.relatedTarget === null) {
        this.dropOverlay.classList.add("hidden");
      }
    });
    document.addEventListener("drop", (e) => {
      e.preventDefault();
      this.dropOverlay.classList.add("hidden");
      const file = e.dataTransfer.files[0];
      if (file && file.name.endsWith(".epub")) {
        this._loadFile(file);
      }
    });

    // Navigation buttons
    this.btnPrev.addEventListener("click", () => this.prevPage());
    this.btnNext.addEventListener("click", () => this.nextPage());

    // Keyboard
    document.addEventListener("keydown", (e) => {
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        this.prevPage();
      } else if (e.key === "ArrowRight" || e.key === "ArrowDown" || e.key === " ") {
        e.preventDefault();
        this.nextPage();
      }
    });

    // Chapter select
    this.chapterSelect.addEventListener("change", (e) => {
      this.currentChapter = parseInt(e.target.value);
      this.currentPage = 0;
      this._paginateAndRender();
    });

    // Settings toggle
    this.settingsToggle.addEventListener("click", () => {
      this.settingsPanel.classList.toggle("hidden");
      this.settingsToggle.classList.toggle("active");
    });

    // Settings change handlers
    const onSettingChange = () => {
      this._readSettings();
      this._saveSettings();
      this.layout.updateSettings(this.settings);
      this.renderer.grayscale = this.settings.grayscale;
      this.renderer.dithering = this.settings.dithering;
      this._updateCanvasSize();
      if (this.parser) {
        this._paginateAndRender();
      } else {
        this.renderer.renderWelcome();
      }
    };

    this.orientationEl.addEventListener("change", onSettingChange);
    this.fontEl.addEventListener("change", onSettingChange);
    this.fontSizeEl.addEventListener("input", () => {
      this.fontSizeVal.textContent = this.fontSizeEl.value;
      onSettingChange();
    });
    this.lineHeightEl.addEventListener("input", () => {
      this.lineHeightVal.textContent = parseFloat(this.lineHeightEl.value).toFixed(1);
      onSettingChange();
    });
    this.marginEl.addEventListener("input", () => {
      this.marginVal.textContent = this.marginEl.value;
      onSettingChange();
    });
    this.alignEl.addEventListener("change", onSettingChange);
    this.grayscaleEl.addEventListener("change", onSettingChange);
    this.ditheringEl.addEventListener("change", onSettingChange);
  }

  _applySettings() {
    const s = this.settings;
    this.orientationEl.value = s.orientation;
    this.fontEl.value = s.fontFamily;
    this.fontSizeEl.value = s.fontSize;
    this.fontSizeVal.textContent = s.fontSize;
    this.lineHeightEl.value = s.lineHeight;
    this.lineHeightVal.textContent = parseFloat(s.lineHeight).toFixed(1);
    this.marginEl.value = s.margin;
    this.marginVal.textContent = s.margin;
    this.alignEl.value = s.align;
    this.grayscaleEl.checked = s.grayscale;
    this.ditheringEl.checked = s.dithering;
  }

  _readSettings() {
    this.settings.orientation = this.orientationEl.value;
    this.settings.fontFamily = this.fontEl.value;
    this.settings.fontSize = parseInt(this.fontSizeEl.value);
    this.settings.lineHeight = parseFloat(this.lineHeightEl.value);
    this.settings.margin = parseInt(this.marginEl.value);
    this.settings.align = this.alignEl.value;
    this.settings.grayscale = this.grayscaleEl.checked;
    this.settings.dithering = this.ditheringEl.checked;
  }

  _updateCanvasSize() {
    if (this.settings.orientation === "landscape") {
      this.renderer.setSize(800, 480);
    } else {
      this.renderer.setSize(480, 800);
    }
  }

  async _loadFile(file) {
    this.renderer.renderLoading("Loading EPUB...");

    try {
      const buffer = await file.arrayBuffer();
      this.parser = new EpubParser();
      await this.parser.load(buffer);

      // Populate chapter select
      const chapters = this.parser.getChapters();
      this.chapterSelect.innerHTML = "";
      this.chapterSelect.disabled = false;
      chapters.forEach((ch, i) => {
        const opt = document.createElement("option");
        opt.value = i;
        opt.textContent = ch.label;
        this.chapterSelect.appendChild(opt);
      });

      // Update page title
      const meta = this.parser.getMetadata();
      document.title = `${meta.title} - CrossPoint Emulator`;

      this.currentChapter = 0;
      this.currentPage = 0;

      this.renderer.grayscale = this.settings.grayscale;
      this.renderer.dithering = this.settings.dithering;

      await this._paginateAndRender();
    } catch (err) {
      console.error("Failed to load EPUB:", err);
      this.renderer.renderLoading("Error: " + err.message);
    }
  }

  async _paginateAndRender() {
    if (!this.parser) return;

    this.renderer.renderLoading("Paginating...");

    try {
      const xhtml = await this.parser.getChapterContent(this.currentChapter);
      const cw = this.canvas.width;
      const ch = this.canvas.height;

      const resolveImage = async (href) => {
        return this.parser.getImageBlob(href);
      };

      this.pages = await this.layout.paginate(xhtml, cw, ch, resolveImage);
      if (this.currentPage >= this.pages.length) {
        this.currentPage = this.pages.length - 1;
      }
      if (this.currentPage < 0) this.currentPage = 0;

      await this._renderCurrentPage();
    } catch (err) {
      console.error("Pagination error:", err);
      this.renderer.renderLoading("Render error: " + err.message);
    }
  }

  async _renderCurrentPage() {
    if (this.pages.length === 0) {
      this.renderer.renderLoading("(empty chapter)");
      this._updateStatus();
      return;
    }

    await this.renderer.renderPage(this.pages[this.currentPage]);
    this._updateStatus();
  }

  _updateStatus() {
    const total = this.pages.length;
    const current = total > 0 ? this.currentPage + 1 : 0;
    this.pageStatus.textContent = `Page ${current} / ${total}`;
    this.btnPrev.disabled = this.currentPage <= 0 && this.currentChapter <= 0;
    this.btnNext.disabled =
      this.currentPage >= total - 1 &&
      (!this.parser || this.currentChapter >= this.parser.getChapters().length - 1);
  }

  prevPage() {
    if (!this.parser) return;

    if (this.currentPage > 0) {
      this.currentPage--;
      this._renderCurrentPage();
    } else if (this.currentChapter > 0) {
      // Go to previous chapter, last page
      this.currentChapter--;
      this.chapterSelect.value = this.currentChapter;
      this._paginateAndRender().then(() => {
        this.currentPage = this.pages.length - 1;
        this._renderCurrentPage();
      });
    }
  }

  nextPage() {
    if (!this.parser) return;

    if (this.currentPage < this.pages.length - 1) {
      this.currentPage++;
      this._renderCurrentPage();
    } else if (this.currentChapter < this.parser.getChapters().length - 1) {
      // Go to next chapter, first page
      this.currentChapter++;
      this.currentPage = 0;
      this.chapterSelect.value = this.currentChapter;
      this._paginateAndRender();
    }
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

document.addEventListener("DOMContentLoaded", () => {
  new EmulatorApp();
});

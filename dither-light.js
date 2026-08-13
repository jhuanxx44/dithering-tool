/*!
 * Dither Light · Bayer 有序抖动光影组件
 * 单文件、零依赖的 Web Component：渐变光影特效背景 + 本地图片有序抖动处理
 *
 * 用法：
 *   <script src="dither-light.js"></script>
 *   <dither-light preset="duotone" matrix="8" grid="5"></dither-light>
 *
 * 属性（均可通过 setAttribute 实时修改）：
 *   preset    shadow | highlight | duotone   预设（默认 shadow）
 *   matrix    2 | 3 | 4 | 8                  Bayer 矩阵阶数（默认 8）
 *   grid      2 – 14                         网点边长 px（默认 5）
 *   contrast  0.2 – 3                        对比度（默认 1.35）
 *   ambient   0 – 0.7                        环境光（默认 0.22）
 *   light     auto | pointer                 光源（默认 auto；图片模式下无效）
 *   speed     0 – 3                          动画速度（默认 1；图片模式下无效）
 *   src       图片 URL                       设置后进入图片模式
 *
 * JS API：
 *   el.setImage(file | Blob | URL | HTMLImageElement)  加载图片（返回 Promise）
 *   el.clearImage()                                    清除图片，恢复渐变模式
 *   el.downloadPNG(filename?)                          导出当前画面为 PNG
 *
 * 事件（bubbles + composed）：
 *   dither-load   图片加载完成，event.detail = { name, width, height }
 *   dither-clear  图片已清除
 *   dither-error  图片加载失败，event.detail = { message }
 */
(() => {
  "use strict";

  // ---------- Bayer 矩阵 ----------
  const matrixCache = new Map();

  function buildBayer(n) {
    if (matrixCache.has(n)) return matrixCache.get(n);

    let matrix;
    if (n === 1) {
      matrix = [[0]];
    } else if (n === 3) {
      matrix = [
        [0, 7, 3],
        [6, 5, 2],
        [4, 1, 8]
      ];
    } else {
      const half = n / 2;
      const prev = buildBayer(half);
      const offset = [[0, 2], [3, 1]];
      matrix = Array.from({ length: n }, () => Array(n).fill(0));

      for (let y = 0; y < n; y += 1) {
        for (let x = 0; x < n; x += 1) {
          matrix[y][x] = prev[y % half][x % half] * 4 +
            offset[Math.floor(y / half)][Math.floor(x / half)];
        }
      }
    }

    matrixCache.set(n, matrix);
    return matrix;
  }

  // ---------- 数学工具 ----------
  function clamp01(value) {
    return Math.max(0, Math.min(1, value));
  }

  function smoothstep(edge0, edge1, x) {
    const t = clamp01((x - edge0) / (edge1 - edge0));
    return t * t * (3 - 2 * t);
  }

  function glow(cx, cy, radius, px, py) {
    return smoothstep(radius, 0, Math.hypot(px - cx, py - cy));
  }

  function numberInRange(value, min, max, fallback) {
    const n = parseFloat(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  // ---------- Shadow DOM 模板 ----------
  const STYLE = `
    :host {
      display: block;
      position: relative;
      isolation: isolate;
      overflow: hidden;
      background: #07050f;
    }
    .gradient {
      position: absolute;
      inset: -12%;
      background:
        radial-gradient(52% 52% at 18% 26%, rgba(255, 199, 118, 0.95) 0%, rgba(255, 199, 118, 0) 70%),
        radial-gradient(50% 50% at 82% 22%, rgba(255, 108, 158, 0.85) 0%, rgba(255, 108, 158, 0) 70%),
        radial-gradient(62% 62% at 50% 112%, rgba(122, 92, 255, 0.90) 0%, rgba(122, 92, 255, 0) 72%),
        linear-gradient(155deg, #07050f 0%, #2a1240 48%, #06152b 100%);
      filter: saturate(1.08) contrast(1.04);
      transform-origin: 50% 50%;
      animation: drift 20s ease-in-out infinite alternate;
    }
    @keyframes drift {
      from { transform: translate3d(0, 0, 0) scale(1); }
      to   { transform: translate3d(-3%, 2%, 0) scale(1.12); }
    }
    canvas {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
    }
    @media (prefers-reduced-motion: reduce) {
      .gradient { animation: none; }
    }
  `;

  const OBSERVED = ["preset", "matrix", "grid", "contrast", "ambient", "light", "speed", "src"];

  class DitherLight extends HTMLElement {
    static get observedAttributes() {
      return OBSERVED;
    }

    constructor() {
      super();
      const root = this.attachShadow({ mode: "open" });

      const style = document.createElement("style");
      style.textContent = STYLE;
      this.gradientEl = document.createElement("div");
      this.gradientEl.className = "gradient";
      this.canvas = document.createElement("canvas");
      root.append(style, this.gradientEl, this.canvas);

      this.ctx = this.canvas.getContext("2d", { alpha: true });
      this.off = document.createElement("canvas");
      this.offCtx = this.off.getContext("2d", { alpha: true });

      this.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

      this.cssWidth = 0;
      this.cssHeight = 0;
      this.dpr = 1;
      this.pointer = { x: 0, y: 0, active: false };

      this.sourceImage = null;
      this.imageName = "";
      this.imageDirty = true;
      this.lumaCache = null;
      this.lumaKey = "";

      this.rafId = 0;
      this.resizeObserver = null;
      this.srcToken = 0; // 防止 src 快速切换时旧请求覆盖新图
    }

    // ---------- 生命周期 ----------
    connectedCallback() {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(this);
      this.addEventListener("pointermove", this.onPointerMove);
      this.addEventListener("pointerleave", this.onPointerLeave);
      this.resize();
      this.startLoop();
      if (this.hasAttribute("src")) this.loadFromSrc();
    }

    disconnectedCallback() {
      cancelAnimationFrame(this.rafId);
      if (this.resizeObserver) this.resizeObserver.disconnect();
      this.removeEventListener("pointermove", this.onPointerMove);
      this.removeEventListener("pointerleave", this.onPointerLeave);
    }

    attributeChangedCallback(name, oldValue, newValue) {
      if (oldValue === newValue) return;
      this.imageDirty = true;
      if (name === "src" && this.isConnected) this.loadFromSrc();
    }

    onPointerMove = (event) => {
      const rect = this.getBoundingClientRect();
      this.pointer.x = event.clientX - rect.left;
      this.pointer.y = event.clientY - rect.top;
      this.pointer.active = true;
    };

    onPointerLeave = () => {
      this.pointer.active = false;
    };

    // ---------- 参数读取（带校验与默认值） ----------
    get preset() {
      const value = this.getAttribute("preset");
      return value === "highlight" || value === "duotone" ? value : "shadow";
    }

    get matrixN() {
      const n = parseInt(this.getAttribute("matrix"), 10);
      return n === 2 || n === 3 || n === 4 ? n : 8;
    }

    get gridSize() {
      return numberInRange(this.getAttribute("grid"), 2, 14, 5);
    }

    get contrast() {
      return numberInRange(this.getAttribute("contrast"), 0.2, 3, 1.35);
    }

    get ambient() {
      return numberInRange(this.getAttribute("ambient"), 0, 0.7, 0.22);
    }

    get lightSource() {
      return this.getAttribute("light") === "pointer" ? "pointer" : "auto";
    }

    get speed() {
      return numberInRange(this.getAttribute("speed"), 0, 3, 1);
    }

    /** 当前是否处于图片模式 */
    get hasImage() {
      return Boolean(this.sourceImage);
    }

    // ---------- 图片加载 ----------
    loadFromSrc() {
      const src = this.getAttribute("src");
      if (!src) return;
      const token = ++this.srcToken;
      const img = new Image();
      if (this.hasAttribute("crossorigin")) {
        img.crossOrigin = this.getAttribute("crossorigin") || "anonymous";
      }
      img.onload = () => {
        if (token !== this.srcToken) return;
        this.adoptImage(img, src.split("/").pop() || "image");
      };
      img.onerror = () => {
        if (token !== this.srcToken) return;
        this.dispatch("dither-error", { message: "图片加载失败：" + src });
      };
      img.src = src;
    }

    /**
     * 加载本地图片并进入图片模式。
     * @param {File | Blob | string | HTMLImageElement | HTMLCanvasElement} source
     * @returns {Promise<void>}
     */
    setImage(source) {
      this.srcToken += 1; // 使进行中的 src 加载失效

      if (typeof source === "string") {
        this.setAttribute("src", source);
        return Promise.resolve();
      }

      if (source instanceof HTMLImageElement || source instanceof HTMLCanvasElement) {
        this.removeAttribute("src");
        this.adoptImage(source, this.imageName || "image");
        return Promise.resolve();
      }

      if (source instanceof Blob) {
        this.removeAttribute("src");
        const name = source instanceof File ? source.name : "image";
        return new Promise((resolve, reject) => {
          const url = URL.createObjectURL(source);
          const img = new Image();
          img.onload = () => {
            URL.revokeObjectURL(url);
            this.adoptImage(img, name);
            resolve();
          };
          img.onerror = () => {
            URL.revokeObjectURL(url);
            const message = "图片读取失败";
            this.dispatch("dither-error", { message });
            reject(new Error(message));
          };
          img.src = url;
        });
      }

      return Promise.reject(new TypeError("setImage 需要 File / Blob / URL / HTMLImageElement"));
    }

    adoptImage(img, name) {
      this.sourceImage = img;
      this.imageName = name;
      this.lumaCache = null;
      this.lumaKey = "";
      this.imageDirty = true;
      this.updateBlendMode();
      this.dispatch("dither-load", {
        name,
        width: img.naturalWidth || img.width,
        height: img.naturalHeight || img.height
      });
    }

    /** 清除图片，恢复渐变光影模式 */
    clearImage() {
      if (!this.sourceImage && !this.hasAttribute("src")) return;
      this.srcToken += 1;
      this.removeAttribute("src");
      this.sourceImage = null;
      this.imageName = "";
      this.lumaCache = null;
      this.lumaKey = "";
      this.updateBlendMode();
      this.dispatch("dither-clear", {});
    }

    /** 导出当前画面为 PNG */
    downloadPNG(filename) {
      const base = filename ||
        (this.imageName ? "dithered-" + this.imageName.replace(/\.[^.]+$/, "") : "dither-light");
      this.canvas.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = base + ".png";
        link.click();
        URL.revokeObjectURL(url);
      }, "image/png");
    }

    dispatch(type, detail) {
      this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
    }

    // ---------- 尺寸 ----------
    resize() {
      const rect = this.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      this.cssWidth = rect.width;
      this.cssHeight = rect.height;
      this.dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.canvas.width = Math.round(this.cssWidth * this.dpr);
      this.canvas.height = Math.round(this.cssHeight * this.dpr);
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      this.imageDirty = true;
    }

    // ---------- 光照 ----------
    makeLightState(time) {
      const minSide = Math.min(this.cssWidth, this.cssHeight);

      if (this.lightSource === "pointer") {
        const targetX = this.pointer.active ? this.pointer.x : this.cssWidth * 0.5;
        const targetY = this.pointer.active ? this.pointer.y : this.cssHeight * 0.5;
        return {
          type: "pointer",
          x: targetX,
          y: targetY,
          r: minSide * 0.56,
          ax: this.cssWidth - targetX,
          ay: this.cssHeight - targetY,
          ar: minSide * 0.30
        };
      }

      return {
        type: "auto",
        x1: this.cssWidth * (0.5 + 0.30 * Math.sin(time * 0.23)),
        y1: this.cssHeight * (0.48 + 0.26 * Math.cos(time * 0.17)),
        r1: minSide * (0.52 + 0.08 * Math.sin(time * 0.31)),
        x2: this.cssWidth * (0.72 + 0.16 * Math.cos(time * 0.13)),
        y2: this.cssHeight * (0.22 + 0.16 * Math.sin(time * 0.11)),
        r2: minSide * 0.26
      };
    }

    lightAt(px, py, state) {
      if (state.type === "pointer") {
        return Math.max(
          glow(state.x, state.y, state.r, px, py),
          glow(state.ax, state.ay, state.ar, px, py) * 0.48
        );
      }

      return Math.max(
        glow(state.x1, state.y1, state.r1, px, py),
        glow(state.x2, state.y2, state.r2, px, py) * 0.72
      );
    }

    // ---------- 渲染 ----------
    startLoop() {
      const frame = (now) => {
        if (this.sourceImage) {
          // 图片是静态的，仅在参数或尺寸变化时重绘
          if (this.imageDirty) {
            this.imageDirty = false;
            this.drawImageMode();
          }
        } else {
          const speed = this.reducedMotion ? 0 : this.speed;
          this.drawGradientMode(now * 0.001 * speed);
        }
        this.rafId = requestAnimationFrame(frame);
      };
      this.rafId = requestAnimationFrame(frame);
    }

    updateBlendMode() {
      if (this.sourceImage) {
        this.canvas.style.mixBlendMode = "normal";
        return;
      }
      this.canvas.style.mixBlendMode =
        this.preset === "highlight" ? "screen" :
        this.preset === "duotone" ? "overlay" : "multiply";
    }

    drawGradientMode(time) {
      this.updateBlendMode();
      const n = this.matrixN;
      const bayer = buildBayer(n);
      const thresholdScale = n * n;
      const grid = this.gridSize;
      const ambient = this.ambient;
      const contrast = this.contrast;
      const preset = this.preset;
      const lightState = this.makeLightState(time);

      const cols = Math.max(1, Math.ceil(this.cssWidth / grid));
      const rows = Math.max(1, Math.ceil(this.cssHeight / grid));

      if (this.off.width !== cols || this.off.height !== rows) {
        this.off.width = cols;
        this.off.height = rows;
      }

      const image = this.offCtx.createImageData(cols, rows);
      const data = image.data;

      for (let gy = 0; gy < rows; gy += 1) {
        const py = (gy + 0.5) * grid;
        const by = gy % n;

        for (let gx = 0; gx < cols; gx += 1) {
          const px = (gx + 0.5) * grid;
          const light = this.lightAt(px, py, lightState);
          const value = clamp01(0.5 + ((ambient + (1 - ambient) * light) - 0.5) * contrast);
          const threshold = (bayer[by][gx % n] + 0.5) / thresholdScale;
          const index = (gy * cols + gx) * 4;

          let red = 0;
          let green = 0;
          let blue = 0;
          let alpha = 0;

          if (preset === "shadow") {
            if (value < threshold) alpha = 255;
          } else if (preset === "highlight") {
            if (value > threshold) {
              red = 255;
              green = 255;
              blue = 255;
              alpha = 255;
            }
          } else {
            if (value < threshold) {
              alpha = 255;
            } else if (value > threshold) {
              red = 255;
              green = 255;
              blue = 255;
              alpha = 255;
            }
          }

          data[index] = red;
          data[index + 1] = green;
          data[index + 2] = blue;
          data[index + 3] = alpha;
        }
      }

      this.offCtx.putImageData(image, 0, 0);
      this.ctx.clearRect(0, 0, this.cssWidth, this.cssHeight);
      this.ctx.imageSmoothingEnabled = false;
      this.ctx.drawImage(this.off, 0, 0, this.cssWidth, this.cssHeight);
    }

    // 将图片按 cover 方式采样为 cols×rows 的亮度场（带缓存，仅尺寸变化时重采样）
    sampleLuminance(cols, rows) {
      const key = cols + "x" + rows;
      if (this.lumaCache && this.lumaKey === key) return this.lumaCache;

      if (this.off.width !== cols || this.off.height !== rows) {
        this.off.width = cols;
        this.off.height = rows;
      }

      const img = this.sourceImage;
      const imgWidth = img.naturalWidth || img.width;
      const imgHeight = img.naturalHeight || img.height;
      const scale = Math.max(cols / imgWidth, rows / imgHeight);
      const drawWidth = imgWidth * scale;
      const drawHeight = imgHeight * scale;
      this.offCtx.drawImage(
        img,
        (cols - drawWidth) / 2,
        (rows - drawHeight) / 2,
        drawWidth,
        drawHeight
      );

      const pixels = this.offCtx.getImageData(0, 0, cols, rows).data;
      const luma = new Float32Array(cols * rows);
      for (let i = 0; i < luma.length; i += 1) {
        const p = i * 4;
        luma[i] = (0.2126 * pixels[p] + 0.7152 * pixels[p + 1] + 0.0722 * pixels[p + 2]) / 255;
      }

      this.lumaCache = luma;
      this.lumaKey = key;
      return luma;
    }

    drawImageMode() {
      const preset = this.preset;
      const n = this.matrixN;
      const bayer = buildBayer(n);
      const thresholdScale = n * n;
      const grid = this.gridSize;
      const ambient = this.ambient;
      const contrast = this.contrast;

      const cols = Math.max(1, Math.ceil(this.cssWidth / grid));
      const rows = Math.max(1, Math.ceil(this.cssHeight / grid));
      const luma = this.sampleLuminance(cols, rows);

      // 预设映射：白底黑点 / 黑底白点 / 双色调（深紫 + 暖橙）
      let dot = [0, 0, 0];
      let paper = [255, 255, 255];
      let invert = false;
      if (preset === "highlight") {
        dot = [255, 255, 255];
        paper = [0, 0, 0];
      } else if (preset === "duotone") {
        dot = [255, 192, 122];
        paper = [22, 16, 31];
        invert = true;
      }

      const image = this.offCtx.createImageData(cols, rows);
      const data = image.data;

      for (let gy = 0; gy < rows; gy += 1) {
        const by = gy % n;
        for (let gx = 0; gx < cols; gx += 1) {
          const cell = gy * cols + gx;
          const value = clamp01(0.5 + ((ambient + (1 - ambient) * luma[cell]) - 0.5) * contrast);
          const threshold = (bayer[by][gx % n] + 0.5) / thresholdScale;
          const isDot = invert ? value >= threshold : value < threshold;
          const color = isDot ? dot : paper;
          const index = cell * 4;
          data[index] = color[0];
          data[index + 1] = color[1];
          data[index + 2] = color[2];
          data[index + 3] = 255;
        }
      }

      this.offCtx.putImageData(image, 0, 0);
      this.ctx.imageSmoothingEnabled = false;
      this.ctx.drawImage(this.off, 0, 0, this.cssWidth, this.cssHeight);
    }
  }

  if (!customElements.get("dither-light")) {
    customElements.define("dither-light", DitherLight);
  }

  window.DitherLight = DitherLight;
})();

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
 *   scene     off | sphere                   3D 场景模式（默认 off；图片模式下无效）
 *   src       图片 URL                       设置后进入图片模式
 *
 * JS API：
 *   el.setImage(file | Blob | URL | HTMLImageElement)  加载图片（返回 Promise）
 *   el.clearImage()                                    清除图片，恢复渐变模式
 *   el.attachSource(canvas | { domElement })           接入实时画面源（如 Three.js renderer），每帧重采样
 *   el.detachSource()                                  断开实时源
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

  // ---------- 3D 场景常量 ----------
  // 相机固定在斜上方看向原点；造型悬浮在地面之上并缓慢起伏
  const EYE = [0, 0.95, 4.7];
  const TARGET = [0, 0.10, 0];
  const TAN_HALF_FOV = 0.42;     // 约 46° 垂直视场
  const GROUND_Y = -0.72;
  const SHADOW_LIGHT = 0.42;     // 阴影内保留的照度比例（地面在亮部，故不宜压得过狠）
  const FOG_NEAR = 4.5;          // 地面开始隐入暗部的距离
  const FOG_FAR = 11;

  // Raymarch 参数：网点本身就是量化的，步数不需要给到写实渲染的量级
  const MARCH_STEPS = 48;
  const MARCH_MAX_T = 16;
  const MARCH_EPS = 0.0025;
  const NORMAL_EPS = 0.0035;

  // ---------- SDF 图元与组合算子 ----------
  function sdSphere(px, py, pz, r) {
    return Math.hypot(px, py, pz) - r;
  }

  function sdBox(px, py, pz, bx, by, bz, r) {
    const qx = Math.abs(px) - bx;
    const qy = Math.abs(py) - by;
    const qz = Math.abs(pz) - bz;
    const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0));
    const inside = Math.min(Math.max(qx, Math.max(qy, qz)), 0);
    return outside + inside - (r || 0);
  }

  function sdTorus(px, py, pz, major, minor) {
    return Math.hypot(Math.hypot(px, pz) - major, py) - minor;
  }

  // 八面体（p-norm 近似的尖锐造型）
  function sdOctahedron(px, py, pz, s) {
    return (Math.abs(px) + Math.abs(py) + Math.abs(pz) - s) * 0.5773502692;
  }

  // 平滑并集：k 越大过渡越圆润，是 blob 感的来源
  function smoothUnion(a, b, k) {
    const h = clamp01(0.5 + 0.5 * (b - a) / k);
    return b * (1 - h) + a * h - k * h * (1 - h);
  }

  // 平滑差集（从 a 中挖掉 b）
  function smoothSubtract(a, b, k) {
    const h = clamp01(0.5 - 0.5 * (a + b) / k);
    return (a * (1 - h) + -b * h) + k * h * (1 - h);
  }

  function rotY(px, pz, angle) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    return [px * c - pz * s, px * s + pz * c];
  }

  /**
   * 内置造型库：每项是 (px, py, pz, time) => 距离。
   * 想加自己的造型，往这里加一个函数即可，渲染管线不用改。
   */
  const SHAPES = {
    // 单球：最省算力的基准造型
    sphere(px, py, pz) {
      return sdSphere(px, py, pz, 0.95);
    },

    // 双球平滑融合 + 顶部小球，典型的 blob 造型
    blob(px, py, pz, t) {
      const wobble = 0.18 * Math.sin(t * 0.8);
      const a = sdSphere(px + 0.42, py - wobble, pz, 0.62);
      const b = sdSphere(px - 0.42, py + wobble, pz, 0.62);
      const c = sdSphere(px, py - 0.62 - wobble * 0.5, pz + 0.15, 0.34);
      return smoothUnion(smoothUnion(a, b, 0.45), c, 0.32);
    },

    // 圆环，绕自身轴缓慢翻转
    torus(px, py, pz, t) {
      const tilt = 0.55 + 0.25 * Math.sin(t * 0.33);
      const cy = Math.cos(tilt);
      const sy = Math.sin(tilt);
      const ry = py * cy - pz * sy;
      const rz = py * sy + pz * cy;
      const [rx, rz2] = rotY(px, rz, t * 0.4);
      return sdTorus(rx, ry, rz2, 0.68, 0.28);
    },

    // 圆角立方体挖球：展示布尔运算
    cut(px, py, pz, t) {
      const [rx, rz] = rotY(px, pz, t * 0.35);
      const box = sdBox(rx, py, rz, 0.62, 0.62, 0.62, 0.08);
      const ball = sdSphere(px, py, pz, 0.82);
      return smoothSubtract(box, ball, 0.06);
    },

    // 八面体与球体的平滑融合：尖锐与圆润的对比
    gem(px, py, pz, t) {
      const [rx, rz] = rotY(px, pz, t * 0.45);
      const oct = sdOctahedron(rx, py, rz, 1.15);
      const ball = sdSphere(px, py, pz, 0.72);
      return smoothUnion(oct, ball, 0.22);
    }
  };

  const SHAPE_NAMES = Object.keys(SHAPES);

  // 所有内置造型都在这个半径内。绝大多数视线打的是天空和地面，
  // 先用包围球一次性排掉，能省掉整轮步进 —— 这是这条路径上最有效的优化。
  const BOUND_R = 1.55;

  function numberInRange(value, min, max, fallback) {
    const n = parseFloat(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  // 不透明输出（图片模式 / 3D 模式）的配色：网点色 + 底色 + 是否反相
  function presetColors(preset) {
    if (preset === "highlight") {
      return { dot: [255, 255, 255], paper: [0, 0, 0], invert: false };
    }
    if (preset === "duotone") {
      return { dot: [255, 192, 122], paper: [22, 16, 31], invert: true };
    }
    return { dot: [0, 0, 0], paper: [255, 255, 255], invert: false };
  }

  // 相机基向量（EYE / TARGET 固定，故在模块初始化时算一次）
  const CAM = (() => {
    let fx = TARGET[0] - EYE[0];
    let fy = TARGET[1] - EYE[1];
    let fz = TARGET[2] - EYE[2];
    const fl = Math.hypot(fx, fy, fz);
    fx /= fl; fy /= fl; fz /= fl;
    // right = normalize(cross(forward, worldUp))，worldUp = (0, 1, 0)
    let rx = -fz;
    let ry = 0;
    let rz = fx;
    const rl = Math.hypot(rx, ry, rz);
    rx /= rl; ry /= rl; rz /= rl;
    // up = cross(right, forward)
    return {
      fx, fy, fz,
      rx, ry, rz,
      ux: ry * fz - rz * fy,
      uy: rz * fx - rx * fz,
      uz: rx * fy - ry * fx
    };
  })();

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

  const OBSERVED = ["preset", "matrix", "grid", "contrast", "ambient", "light", "speed", "scene", "src"];

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
      this.liveSource = null; // 实时画面源：每帧重采样，不使用 luma 缓存

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

    /** 造型名；未设或不认识的值一律视为关闭 */
    get scene() {
      const value = this.getAttribute("scene");
      return value && SHAPES[value] ? value : "off";
    }

    /** 当前是否处于 3D 场景模式（图片模式优先级更高） */
    get is3D() {
      return !this.sourceImage && this.scene !== "off";
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

    /**
     * 接入实时画面源：把外部 canvas（如 Three.js 的 renderer.domElement）的每帧画面
     * 当作亮度输入做抖动。与 setImage 的区别是不缓存、不派发 dither-load。
     *
     * WebGL 源需要 preserveDrawingBuffer: true，否则合成后 drawing buffer 会被清空，
     * 采样只能拿到空白；或者在 renderer.render() 之后的同一个任务里手动调 renderFrame()。
     *
     * @param {HTMLCanvasElement | { domElement: HTMLCanvasElement }} source
     */
    attachSource(source) {
      const canvas = source && source.domElement ? source.domElement : source;
      if (!(canvas instanceof HTMLCanvasElement)) {
        throw new TypeError("attachSource 需要 canvas 或带 domElement 的对象（如 Three.js renderer）");
      }
      this.srcToken += 1;
      this.removeAttribute("src");
      this.liveSource = canvas;
      this.sourceImage = canvas;
      this.imageName = "";
      this.lumaCache = null;
      this.lumaKey = "";
      this.imageDirty = true;
      this.updateBlendMode();
    }

    /** 断开实时源，恢复渐变 / 3D 模式 */
    detachSource() {
      if (!this.liveSource) return;
      this.liveSource = null;
      this.sourceImage = null;
      this.lumaCache = null;
      this.lumaKey = "";
      this.updateBlendMode();
    }

    /** 立即用当前源画面重绘一帧（供 WebGL 源在 render() 后同步调用） */
    renderFrame() {
      if (!this.sourceImage) return;
      this.lumaCache = null;
      this.drawImageMode();
    }

    /** 清除图片，恢复渐变光影模式 */
    clearImage() {
      if (!this.sourceImage && !this.hasAttribute("src")) return;
      this.srcToken += 1;
      this.removeAttribute("src");
      this.liveSource = null;
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
        this.updateGradientVisibility();
        if (this.liveSource) {
          // 实时源：每帧重采样
          this.lumaCache = null;
          this.imageDirty = false;
          this.drawImageMode();
        } else if (this.sourceImage) {
          // 图片是静态的，仅在参数或尺寸变化时重绘
          if (this.imageDirty) {
            this.imageDirty = false;
            this.drawImageMode();
          }
        } else if (this.scene !== "off") {
          const speed = this.reducedMotion ? 0 : this.speed;
          this.drawSceneMode(now * 0.001 * speed);
        } else {
          const speed = this.reducedMotion ? 0 : this.speed;
          this.drawGradientMode(now * 0.001 * speed);
        }
        this.rafId = requestAnimationFrame(frame);
      };
      this.rafId = requestAnimationFrame(frame);
    }

    updateBlendMode() {
      if (this.sourceImage || this.is3D) {
        this.canvas.style.mixBlendMode = "normal";
        return;
      }
      this.canvas.style.mixBlendMode =
        this.preset === "highlight" ? "screen" :
        this.preset === "duotone" ? "overlay" : "multiply";
    }

    // 图片模式与 3D 模式输出不透明画面，无需渐变底层参与合成
    updateGradientVisibility() {
      this.gradientEl.style.display = (this.sourceImage || this.is3D) ? "none" : "";
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

    // ---------- 3D 场景模式 ----------
    // 光照方向（单位向量，由场景指向光源）
    makeLightDir(time) {
      let x;
      let y;
      let z;

      if (this.lightSource === "pointer") {
        // 指针未进入时停在固定的斜上方，与渐变模式的静止行为保持一致
        const fracX = this.pointer.active ? this.pointer.x / Math.max(1, this.cssWidth) : 0.32;
        const fracY = this.pointer.active ? this.pointer.y / Math.max(1, this.cssHeight) : 0.25;
        x = (fracX * 2 - 1) * 1.6;
        y = 0.45 - (fracY * 2 - 1) * 1.1;
        z = 0.9;
      } else {
        // 偏侧上方绕行，让球体始终有明确的明暗交界线
        x = -0.55 + 1.15 * Math.sin(time * 0.42);
        y = 0.80 + 0.25 * Math.sin(time * 0.27);
        z = 0.55 + 0.40 * Math.cos(time * 0.42);
      }

      const len = Math.hypot(x, y, z) || 1;
      return { x: x / len, y: y / len, z: z / len };
    }

    drawSceneMode(time) {
      this.updateBlendMode();
      const n = this.matrixN;
      const bayer = buildBayer(n);
      const thresholdScale = n * n;
      const grid = this.gridSize;
      const ambient = this.ambient;
      const contrast = this.contrast;
      const { dot, paper, invert } = presetColors(this.preset);

      const cols = Math.max(1, Math.ceil(this.cssWidth / grid));
      const rows = Math.max(1, Math.ceil(this.cssHeight / grid));
      if (this.off.width !== cols || this.off.height !== rows) {
        this.off.width = cols;
        this.off.height = rows;
      }

      const light = this.makeLightDir(time);
      const aspect = this.cssWidth / Math.max(1, this.cssHeight);
      const shapeFn = SHAPES[this.scene] || SHAPES.sphere;

      // 造型悬浮起伏
      const cx = 0.16 * Math.sin(time * 0.19);
      const cy = 0.30 + 0.10 * Math.sin(time * 0.55);
      const cz = 0;

      const image = this.offCtx.createImageData(cols, rows);
      const data = image.data;

      for (let gy = 0; gy < rows; gy += 1) {
        const ndcY = 1 - ((gy + 0.5) * grid / this.cssHeight) * 2;
        const by = gy % n;

        for (let gx = 0; gx < cols; gx += 1) {
          const ndcX = (((gx + 0.5) * grid / this.cssWidth) * 2 - 1) * aspect;

          // 视线方向
          const sx = ndcX * TAN_HALF_FOV;
          const sy = ndcY * TAN_HALF_FOV;
          let dx = CAM.fx + CAM.rx * sx + CAM.ux * sy;
          let dy = CAM.fy + CAM.ry * sx + CAM.uy * sy;
          let dz = CAM.fz + CAM.rz * sx + CAM.uz * sy;
          const dl = Math.hypot(dx, dy, dz) || 1;
          dx /= dl; dy /= dl; dz /= dl;

          const value = clamp01(
            0.5 +
              ((ambient +
                (1 - ambient) * this.shade(dx, dy, dz, cx, cy, cz, light, time, shapeFn)) -
                0.5) *
                contrast
          );

          const threshold = (bayer[by][gx % n] + 0.5) / thresholdScale;
          const isDot = invert ? value >= threshold : value < threshold;
          const color = isDot ? dot : paper;
          const index = (gy * cols + gx) * 4;
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

    /** 造型的 SDF：世界坐标 → 距离。造型悬浮在 (cx, cy, cz) */
    sdf(px, py, pz, cx, cy, cz, time, shapeFn) {
      return shapeFn(px - cx, py - cy, pz - cz, time);
    }

    /** 中心差分求法线 */
    normalAt(px, py, pz, cx, cy, cz, time, shapeFn) {
      const e = NORMAL_EPS;
      const nx =
        this.sdf(px + e, py, pz, cx, cy, cz, time, shapeFn) -
        this.sdf(px - e, py, pz, cx, cy, cz, time, shapeFn);
      const ny =
        this.sdf(px, py + e, pz, cx, cy, cz, time, shapeFn) -
        this.sdf(px, py - e, pz, cx, cy, cz, time, shapeFn);
      const nz =
        this.sdf(px, py, pz + e, cx, cy, cz, time, shapeFn) -
        this.sdf(px, py, pz - e, cx, cy, cz, time, shapeFn);
      const len = Math.hypot(nx, ny, nz) || 1;
      return { x: nx / len, y: ny / len, z: nz / len };
    }

    /** 朝光源步进，返回 0（全影）–1（无遮挡）的软阴影系数 */
    shadowFactor(px, py, pz, cx, cy, cz, time, shapeFn, light) {
      let t = 0.06;
      let shade = 1;
      for (let i = 0; i < 18; i += 1) {
        const d = this.sdf(
          px + light.x * t, py + light.y * t, pz + light.z * t,
          cx, cy, cz, time, shapeFn
        );
        if (d < MARCH_EPS) return SHADOW_LIGHT;
        // 距离越近、遮挡越强，得到带过渡的半影
        shade = Math.min(shade, 12 * d / t);
        t += Math.max(d, 0.035);
        if (t > 6) break;
      }
      return SHADOW_LIGHT + (1 - SHADOW_LIGHT) * clamp01(shade);
    }

    /**
     * 单条视线的着色，返回 0–1 亮度。
     * 造型走 SDF raymarch（任意隐式造型），地面仍是解析求交（平面无需步进）。
     */
    shade(dx, dy, dz, cx, cy, cz, light, time, shapeFn) {
      // 地面：y = GROUND_Y，先算出来作为步进的上界
      let tGround = Infinity;
      if (dy < -1e-6) {
        const t = (GROUND_Y - EYE[1]) / dy;
        if (t > 1e-3) tGround = t;
      }

      // 包围球剔除：与包围球无交点的视线直接跳过步进
      const ox = EYE[0] - cx;
      const oy = EYE[1] - cy;
      const oz = EYE[2] - cz;
      const bDot = ox * dx + oy * dy + oz * dz;
      const cLen = ox * ox + oy * oy + oz * oz - BOUND_R * BOUND_R;
      const disc = bDot * bDot - cLen;

      let hit = false;
      let t = 0;

      if (disc > 0) {
        const sq = Math.sqrt(disc);
        const tEnter = -bDot - sq;
        const tExit = -bDot + sq;
        if (tExit > 1e-3) {
          // 只在包围球内部这一段步进，并且不越过地面
          const limit = Math.min(
            tExit,
            MARCH_MAX_T,
            tGround === Infinity ? MARCH_MAX_T : tGround
          );
          t = Math.max(tEnter, 0.02);
          for (let i = 0; i < MARCH_STEPS; i += 1) {
            const px = EYE[0] + dx * t;
            const py = EYE[1] + dy * t;
            const pz = EYE[2] + dz * t;
            const d = this.sdf(px, py, pz, cx, cy, cz, time, shapeFn);
            if (d < MARCH_EPS) { hit = true; break; }
            t += d;
            if (t > limit) break;
          }
        }
      }

      if (hit) {
        const px = EYE[0] + dx * t;
        const py = EYE[1] + dy * t;
        const pz = EYE[2] + dz * t;
        const nrm = this.normalAt(px, py, pz, cx, cy, cz, time, shapeFn);

        const diffuse = Math.max(0, nrm.x * light.x + nrm.y * light.y + nrm.z * light.z);
        // 造型亮度收在 0.06–0.72：亮面仍留稀疏网点，与近乎全白的天空区分开；
        // 暗面出密网点，形体靠这段落差读出来（顶到 1.0 会整片实心、丢掉形体）
        let value = 0.06 + 0.66 * diffuse;

        // 半程向量高光（视线方向取反得到指向相机的向量）
        let hx = light.x - dx;
        let hy = light.y - dy;
        let hz = light.z - dz;
        const hl = Math.hypot(hx, hy, hz) || 1;
        const specDot = Math.max(0, (nrm.x * hx + nrm.y * hy + nrm.z * hz) / hl);
        value += 0.16 * Math.pow(specDot, 48);

        // 边缘光转为压暗：让轮廓边缘出网点，在亮天空里勾出实心的外轮廓线
        const facing = Math.max(0, -(nrm.x * dx + nrm.y * dy + nrm.z * dz));
        value -= 0.34 * Math.pow(1 - facing, 3);

        return clamp01(value);
      }

      if (tGround < Infinity) {
        // 地面：法线朝上，朝光源步进检测造型投下的阴影
        const px = EYE[0] + dx * tGround;
        const pz = EYE[2] + dz * tGround;
        // 地面保持在亮部（只出稀疏网点）：它比天空略暗、但明显亮于造型暗面，
        // 这样投影才是地面上唯一的深色特征，而不是整片地面都在跟主体抢注意力
        const falloff = 1 / (1 + 0.16 * (px * px + pz * pz));
        let value = 0.74 + 0.12 * Math.max(0, light.y) * falloff;

        // 阴影步进只对包围球附近的地面点做：远处不可能落在阴影里
        const gx = px - cx;
        const gz = pz - cz;
        const gy = GROUND_Y - cy;
        const gb = gx * light.x + gy * light.y + gz * light.z;
        const gc = gx * gx + gy * gy + gz * gz - BOUND_R * BOUND_R;
        if (gb * gb - gc > 0 && -gb + Math.sqrt(Math.max(0, gb * gb - gc)) > 1e-3) {
          value *= this.shadowFactor(px, GROUND_Y, pz, cx, cy, cz, time, shapeFn, light);
        }

        // 远处向天空亮度过渡，消掉地平线硬边
        const fade = smoothstep(FOG_NEAR, FOG_FAR, tGround);
        return clamp01(value * (1 - fade) + 0.94 * fade);
      }

      // 天空推到接近纯白：抖动只有 1 bit，靠的是主体与背景的密度差。
      // 天空几乎不出网点（干净留白），造型即使在亮面也仍有稀疏网点，
      // 轮廓就靠这个差别读出来；压暗天空会让背景长满网点、把轮廓吞掉。
      const horizon = smoothstep(-0.15, 0.6, dy);
      return clamp01(0.94 + 0.05 * horizon);
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
      const { dot, paper, invert } = presetColors(preset);

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

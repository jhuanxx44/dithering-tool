# Dither Light

零依赖、单文件的**实时 1-bit 抖动渲染器**。一个 `<dither-light>` 自定义元素，把画面量化成「有墨 / 无墨」两级的 Bayer 网点——Obra Dinn 那种铜版画观感。

自带 SDF 光线步进的 3D 场景，纯 CPU，不需要 WebGL。也能给任意 Three.js 模型做后处理。

**渲染开销只跟网点数有关，与模型面数无关。** 全屏 1280×800、`grid=4` 约 11ms/帧。

![效果预览](preview.png)

```html
<script src="dither-light.js"></script>
<dither-light scene="blob" style="width: 100%; height: 480px;"></dither-light>
```

就这样。没有构建步骤，没有 npm，没有框架。

## 目录

- [四种用法](#四种用法) · [3D 场景](#一3d-场景内置) · [接 Three.js](#二接任意-3d-模型threejs) · [图片抖动](#三图片抖动) · [渐变背景](#四渐变光影背景)
- [组件文档](#组件文档)：[属性](#属性) · [JS API](#js-api) · [事件](#事件) · [框架接入](#在框架中使用)
- [调参与配光](#调参与配光)
- [实现原理](#实现原理)

---

## 四种用法

四种用法共用同一套 Bayer 抖动管线，区别只在**亮度从哪来**。

| 用法 | 亮度来源 | 输出 |
| --- | --- | --- |
| 3D 场景 | 内置 SDF raymarch 实时着色 | 不透明 |
| 接 Three.js | 外部 canvas 每帧采样 | 不透明 |
| 图片抖动 | 图片亮度 | 不透明 |
| 渐变背景 | 内置渐变光场 | 半透明，参与混合模式 |

### 一、3D 场景（内置）

`scene` 设为造型名即进入 3D 模式：

```html
<dither-light scene="blob" preset="shadow" grid="4"
              style="width: 100%; aspect-ratio: 16 / 9;"></dither-light>
```

内置五种造型，都是隐式曲面，可随时切换：

| `scene` | 造型 | 用到的 SDF 技巧 |
| --- | --- | --- |
| `blob` | 融合球 | 平滑并集 `smoothUnion` |
| `sphere` | 单球 | 最省算力的基准 |
| `torus` | 圆环 | 旋转 + 环面距离场 |
| `cut` | 立方挖球 | 平滑差集（布尔运算） |
| `gem` | 宝石 | 八面体与球的融合 |

完整可跑页面：[`examples/scene-3d.html`](examples/scene-3d.html)

#### 加自己的造型

往 `dither-light.js` 的 `SHAPES` 里加一个 `(px, py, pz, time) => 距离` 函数，渲染管线不用动：

```js
const SHAPES = {
  // ...
  myShape(px, py, pz, t) {
    const a = sdSphere(px, py - 0.3, pz, 0.7);
    const b = sdBox(px, py + 0.4, pz, 0.5, 0.2, 0.5, 0.05);
    return smoothUnion(a, b, 0.3);
  }
};
```

现成的图元与算子：`sdSphere` / `sdBox` / `sdTorus` / `sdOctahedron`、`smoothUnion` / `smoothSubtract` / `rotY`。

⚠️ 新造型必须留在包围球 `BOUND_R`（默认 1.55）内，否则会被剔除逻辑切掉。造型更大就同步调大这个常量——它是性能优化的关键，见[实现原理](#实现原理)。

### 二、接任意 3D 模型（Three.js）

内置造型是隐式曲面，**喂不进三角网格**。要用任意模型（glTF、白模），走后处理：Three.js 照常渲染，把它的 canvas 当亮度源。

```js
const renderer = new THREE.WebGLRenderer({
  canvas,
  preserveDrawingBuffer: true   // 不能省，见下
});

fx.attachSource(renderer.domElement);   // 接一次

function frame() {
  renderer.render(scene, camera);
  fx.renderFrame();                      // render 之后同步调用
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
```

两个坑：

- **`preserveDrawingBuffer: true` 不能省。** 否则 WebGL 的 drawing buffer 在合成后被清空，晚一帧采样只会拿到空白画面。或者保证 `renderFrame()` 和 `renderer.render()` 在同一个任务里同步执行。
- **白模要重新配光。** 直接套纯白材质 + 强光会顶到 1.0、整片实心、丢掉形体。见[调参与配光](#调参与配光)。

左右对照的完整示例：[`examples/threejs-source.html`](examples/threejs-source.html)

> 这是仓库里**唯一需要联网**的文件（从 CDN 引 Three.js）。组件本体 `dither-light.js` 始终零依赖。

### 三、图片抖动

把照片变成复古网点画。设 `src` 即进入图片模式（优先级高于 `scene`）：

```html
<dither-light src="photo.jpg" preset="duotone" matrix="8" grid="5"
              style="width: 100%; aspect-ratio: 4 / 3;"></dither-light>
```

也可以用 JS 传 `File` / `Blob`（比如文件选择或拖拽）：

```js
await fx.setImage(file);
fx.downloadPNG();          // 导出 PNG，纯本地不上传
```

独立处理器页面（选图 → 调参 → 下载）：[`examples/image-processor.html`](examples/image-processor.html)

> 跨域图片如需导出 PNG，要加 `crossorigin="anonymous"` 且服务端允许 CORS，否则 canvas 被污染、导出失败。

### 四、渐变光影背景

不设 `scene` 和 `src` 时是渐变模式：多层漂移的渐变 + 半透明抖动层，通过 `mix-blend-mode` 与底层合成，适合垫在内容下面。

```html
<dither-light preset="shadow" light="auto" speed="1"
              style="position: fixed; inset: 0; z-index: -1;"></dither-light>
```

见 [`examples/background.html`](examples/background.html)。

> 只有这个模式输出半透明画面。3D 与图片模式都是不透明的，不参与 `mix-blend-mode`——想做背景就用渐变模式。

---

## 组件文档

### 引入

单文件，拷走即用：

```html
<script src="dither-light.js"></script>
```

或者 jsDelivr（建议锁 tag，`@main` 会跟着仓库变）：

```html
<script src="https://cdn.jsdelivr.net/gh/jhuanxx44/dithering-tool@main/dither-light.js"></script>
```

尺寸完全由你的 CSS 控制（默认 `display: block`，**需要给定高度**），内部自动适配尺寸变化与高 DPI（上限 2×）。

### 属性

所有属性都可随时 `setAttribute` 修改，实时生效。

| 属性 | 取值 | 默认 | 说明 |
| --- | --- | --- | --- |
| `scene` | `off` / `blob` / `sphere` / `torus` / `cut` / `gem` | `off` | 设为造型名进入 3D 模式。未知值按 `off` 处理 |
| `src` | 图片 URL | — | 设置后进入图片模式，优先级高于 `scene` |
| `preset` | `shadow` / `highlight` / `duotone` | `shadow` | 白底黑点 / 黑底白点 / 双色调（渐变模式下分别对应 multiply / screen / overlay 混合） |
| `matrix` | `2` / `3` / `4` / `8` | `8` | Bayer 矩阵阶数，越高网点分布越细腻 |
| `grid` | `2` – `14` | `5` | 网点边长（px），越小越细腻、计算量越大 |
| `contrast` | `0.2` – `3` | `1.35` | 明暗过渡的对比强度 |
| `ambient` | `0` – `0.7` | `0.22` | 全局提亮程度 |
| `light` | `auto` / `pointer` | `auto` | 光源自动游走或跟随指针（作用域为组件自身；图片模式下无效） |
| `speed` | `0` – `3` | `1` | 动画速度（图片模式下无效；系统开启「减少动态」时强制为 0） |

### JS API

```js
const fx = document.querySelector('dither-light');

// 图片模式（静态快照语义）
await fx.setImage(fileOrBlobOrUrlOrImg);
fx.clearImage();

// 实时源（每帧重采样）
fx.attachSource(canvasOrThreeRenderer);
fx.renderFrame();
fx.detachSource();

// 导出
fx.downloadPNG();          // 可传文件名，默认 dithered-原图名.png

// 只读状态
fx.hasImage;               // 是否处于图片 / 实时源模式
fx.is3D;                   // 是否处于 3D 场景模式
```

`attachSource()` 与 `setImage()` 的区别：

| | `setImage()` | `attachSource()` |
| --- | --- | --- |
| 语义 | 静态快照 | 每帧重采样 |
| 亮度缓存 | 有（按脏标记重绘） | 无 |
| 派发 `dither-load` | 是 | 否 |

用 `setImage()` 接每帧变化的画面会复用第一帧的亮度场，并把事件刷爆。

### 事件

均 `bubbles` 且 `composed`，可穿透 Shadow DOM 在外层监听。

| 事件 | 时机 | `event.detail` |
| --- | --- | --- |
| `dither-load` | 图片加载完成 | `{ name, width, height }` |
| `dither-clear` | 图片已清除 | `{}` |
| `dither-error` | 图片加载失败 | `{ message }` |

### 在框架中使用

Web Component 是浏览器原生标准，不需要适配层。

- **Vue / Svelte / Angular**：模板里直接写 `<dither-light>`，属性正常绑定
- **React 19+**：原生支持自定义元素的 props 与事件
- **React 18 及以下**：用 `ref` 设置属性、监听事件

```jsx
// React 18
const ref = useRef(null);
useEffect(() => {
  const el = ref.current;
  el.setAttribute('scene', 'blob');
  const onLoad = (e) => console.log(e.detail);
  el.addEventListener('dither-load', onLoad);
  return () => el.removeEventListener('dither-load', onLoad);
}, []);
return <dither-light ref={ref} />;
```

---

## 调参与配光

### 参数怎么选

| 想要的效果 | 参数 |
| --- | --- |
| 照片细腻 | `grid` 3–5，`matrix="8"` |
| 海报 / 强风格 | `grid` 8–14，`matrix="4"` 或 `"2"` |
| 3D 日常 | `grid` 4–6（全屏 `grid=4` 约 11ms/帧，`grid=6` 约 5ms） |
| 明暗层次不够 | 调 `contrast` |
| 暗部太死 | 调 `ambient` |

### 1-bit 配光的四条铁律

给 3D 场景或 Three.js 白模配光时，这几条决定效果好不好看。**抖动只有两级，形体靠区域之间的密度差读出来，不是绝对亮度。**

1. **排出三段密度差。** 背景最亮（几乎不出网点）→ 地面次之（稀疏）→ 造型暗面最暗（密集）。内置场景实测是 0% → 5% → 26%。
2. **背景要给亮。** `shadow` 预设里墨点跟着暗部走，深色背景会整片长满网点，把主体吞掉。这条最反直觉。
3. **不要压到中灰。** 整幅挤在中间调会退化成满屏 50% 噪点，轮廓完全溶掉。
4. **不要让亮部顶到 1.0。** 会变成一整片实心，同样丢形体。造型亮面还要**低于**背景亮度，否则轮廓溶进背景。

改完配光请用密度采样验证（分区统计墨点占比），不要只靠肉眼看截图。

---

## 实现原理

**Bayer 有序抖动**：canvas 按网格逐格取一个亮度值，与 Bayer 阈值矩阵比较，决定这个网点着墨还是留白。阈值矩阵锚定在屏幕空间，所以镜头移动时网点会有轻微 swimming——这正是 Obra Dinn 观感的来源。

**3D 场景**：每个网点当作一条视线，对造型的 SDF 做 raymarch（最多 48 步），命中后中心差分求法线，算 Lambert 漫反射 + 半程向量高光 + 轮廓压暗。地面是平面，直接解析求交，再朝光源步进得到软阴影。

**3D 性能**：两级剔除是关键。先用包围球排掉打向天空和远处地面的视线（占绝大多数），地面的阴影步进也只对包围球附近的点做。加上这两步后全屏 1280×800 从 25ms/帧 降到 11ms/帧（`grid=4`），墨点密度差在 0.2% 以内，是等价优化。

**图片模式**：图片按 cover 采样成网格亮度场并缓存，按脏标记重绘，静态画面零开销。

**渐变模式**：底层是多层 `radial-gradient` + 深色 `linear-gradient` 用 CSS 动画漂移；顶层抖动画布通过 `mix-blend-mode` 与之合成。

---

## 仓库结构

```
├── dither-light.js      组件本体，唯一需要分发的文件（零依赖）
├── index.html           游乐场（默认 3D 场景，可实时调所有参数）
├── examples/
│   ├── scene-3d.html          3D 场景，五种造型可切换
│   ├── threejs-source.html    接任意 Three.js 模型，左右对照（需联网）
│   ├── image-processor.html   独立图片处理器
│   └── background.html        渐变背景最小示例
├── SKILL.md             Claude Skill 定义
├── AGENTS.md            agent 开发规则
└── preview.png
```

## 本地运行

```bash
python3 -m http.server 8000
# 然后访问 http://localhost:8000
```

⚠️ **不要直接双击用 `file://` 打开。** `file://` 下 canvas 会被浏览器安全策略污染，抖动计算与 PNG 导出会失败。

## 作为 Claude Skill 用

```bash
git clone https://github.com/jhuanxx44/dithering-tool.git ~/.claude/skills/dither-light
```

之后在 Claude Code 里直接说人话：「做个 Obra Dinn 那种 3D 抖动效果」「给我的 Three.js 白模套上抖动」「把这张照片做成网点风格」。agent 会读 `SKILL.md` 调用本仓库能力。

## 浏览器支持

现代浏览器即可：Custom Elements、Shadow DOM、Canvas 2D、ResizeObserver、`mix-blend-mode`。不需要网络、不需要安装。尊重 `prefers-reduced-motion`。

## 许可证

[MIT](LICENSE)

---
name: dither-light
description: 实时 1-bit 抖动（dithering）渲染器。当用户想要 Obra Dinn 式的 3D 抖动效果、想给 Three.js 模型/白模加抖动后处理、想把照片处理成复古网点画，或给网页添加抖动光影背景时使用。零依赖单文件 Web Component（dither-light.js），内置 SDF raymarch 3D 场景，纯 CPU 不需要 WebGL，无需构建即可嵌入任意前端项目（含 React / Vue）。
---

# Dither Light Skill

一个零依赖的实时 1-bit 抖动渲染器。主线能力是 **3D 抖动**；图片抖动与渐变背景是同一套 Bayer 管线的另外两种输入。

渲染开销只跟网点数有关，与模型面数无关。

## 能力清单（本仓库文件）

| 文件 | 作用 |
| --- | --- |
| `dither-light.js` | **核心资产，唯一需要分发的文件**。注册 `<dither-light>` 自定义元素，零依赖 |
| `examples/scene-3d.html` | 3D 抖动场景：五种 SDF 造型可切换 |
| `examples/threejs-source.html` | 接任意 Three.js 模型，左右对照（**唯一需联网的示例**） |
| `examples/image-processor.html` | 独立图片处理器：选图 → 实时调参 → 下载 PNG |
| `examples/background.html` | 渐变背景特效最小嵌入示例 |
| `index.html` | 完整游乐场（默认 3D 场景） |
| `README.md` | 完整属性 / API / 事件文档（英文版 `README.en.md`） |

> 本 Skill 在 Claude Code（`~/.claude/skills/`）与 Codex（`~/.codex/skills/`）下通用，frontmatter 格式两边一致，无需改动。

## 场景一：用户想要 3D 抖动效果（核心场景）

典型话术：「做个 Obra Dinn 那种效果」「有没有 3D 的 dithering」「立体的抖动场景」。

`scene` 设为造型名即可，纯 CPU、不需要 WebGL：

```html
<script src="dither-light.js"></script>
<dither-light scene="blob" preset="shadow" grid="4"
              style="width: 100%; aspect-ratio: 16 / 9;"></dither-light>
```

内置五种 SDF 造型：`blob`（融合球，默认推荐）、`sphere`、`torus`、`cut`（立方挖球）、`gem`（宝石）。直接拷 `examples/scene-3d.html` 给用户就是一个能跑的完整页面。

要点：

- `light="pointer"` 时光照方向跟随指针，适合做可交互的 hero 区块
- 3D 模式输出不透明画面（不参与 `mix-blend-mode`），不适合当半透明背景叠在内容下面；要背景特效用默认渐变模式
- `grid` 越小越细腻但开销越大：全屏 1280×800 下 `grid=4` 约 11ms/帧、`grid=6` 约 5ms，日常用 4–6 最稳
- 设了 `src` 或调过 `setImage()` 时图片模式优先，`scene` 自动让位

### 加自定义造型

往 `dither-light.js` 的 `SHAPES` 里加一个 `(px, py, pz, time) => 距离` 函数即可，渲染管线不用动。已有的图元与算子：`sdSphere` / `sdBox` / `sdTorus` / `sdOctahedron`、`smoothUnion` / `smoothSubtract` / `rotY`。

新造型必须留在 `BOUND_R`（1.55）的包围球内，否则会被剔除逻辑切掉——造型更大就要同步调大这个常量。

## 场景二：用户想给自己的 3D 模型加抖动（Three.js / glTF）

典型话术：「我用 threejs 做了个白模，能套上这个效果吗」「能不能对任意 3D 模型做 dithering」。

内置造型是隐式曲面，**喂不进三角网格**，所以走后处理：Three.js 照常渲染，把它的 canvas 当亮度源。

```js
const renderer = new THREE.WebGLRenderer({ canvas, preserveDrawingBuffer: true });
fx.attachSource(renderer.domElement);

function frame() {
  renderer.render(scene, camera);
  fx.renderFrame();     // 必须在 render 之后的同一个任务里
  requestAnimationFrame(frame);
}
```

必须提醒用户的两点：

- **`preserveDrawingBuffer: true` 不能省**，否则 WebGL drawing buffer 合成后被清空，采样只会拿到空白画面
- 白模场景要按下面的「1-bit 视觉约定」重新配光，直接套默认的纯白材质 + 强光会整片实心、丢掉形体

完整对照页见 `examples/threejs-source.html`（需联网引 CDN）。

## 1-bit 视觉约定（配光时必读）

抖动只有「有墨 / 无墨」两级，形体靠**区域之间的密度差**读出来，不是绝对亮度。给 3D 场景配光时：

- 排成「背景最亮（几乎不出网点）→ 地面次之（稀疏）→ 造型暗面最暗（密集）」
- 造型亮面要**低于**背景亮度，否则轮廓溶进背景
- 背景要给**亮**：`shadow` 预设里墨点跟着暗部走，深色背景会整片长满网点、把主体吞掉
- 不要把画面压到中灰（退化成满屏 50% 噪点），也不要让亮部顶到 1.0（变成一整片实心）

## 场景三：用户想处理本地图片

典型话术：「把这张照片做成抖动/网点/复古像素风」「帮我的图片加 dithering 效果」。

步骤：

1. 把本仓库的 `dither-light.js` 和 `examples/image-processor.html` 复制到用户的工作目录（或图片所在目录）。两个文件放同一目录，并把页面里的 `src="../dither-light.js"` 改为 `src="dither-light.js"`。
2. 在该目录启动本地静态服务，例如 `python3 -m http.server 8000`。
   **不要直接双击 file:// 打开**：file:// 下 canvas 会被浏览器安全策略污染，抖动计算与 PNG 导出会失败，必须走 http://localhost。
3. 告诉用户访问 `http://localhost:8000/image-processor.html`，选择或拖入图片，调整参数后点「下载 PNG」。

如果用户指定了具体图片路径，也可以生成一个预置图片的处理页（与图片同目录）：

```html
<!doctype html>
<meta charset="utf-8">
<style>html,body{height:100%;margin:0}dither-light{width:100vw;height:100vh}</style>
<dither-light src="图片文件名.png" preset="shadow" matrix="8" grid="5"></dither-light>
<script src="dither-light.js"></script>
<script>
  // 加载完成后可直接调 document.querySelector('dither-light').downloadPNG()
</script>
```

### 调参建议

- `preset`：`shadow`（白底黑点，经典印刷网点）、`highlight`（黑底白点）、`duotone`（深紫+暖橙双色调）
- `grid`：照片想要细腻用 3–5，海报感/强风格用 8–14
- `matrix`：`8` 过渡最平滑，`2` 颗粒感最强
- `contrast` 调明暗分布，`ambient` 整体提亮暗部

## 场景四：用户想把特效集成到自己的网页项目

典型话术：「给我的落地页/博客加一个抖动光影背景」「这个项目能不能用在我网站上」。

步骤：

1. 把 `dither-light.js` 复制到用户项目（保持单文件，不要给它加依赖或构建步骤）。
2. 参考 `examples/background.html` 嵌入：

```html
<script src="dither-light.js"></script>
<dither-light preset="shadow" light="auto"
              style="position: fixed; inset: 0; z-index: -1;"></dither-light>
```

3. 组件尺寸由使用者的 CSS 控制（默认 `display: block`，需给定高度），属性随时 `setAttribute` 实时生效。
4. 框架接入：Vue / Svelte / React 19+ 直接在模板里写 `<dither-light>`；React 18 及以下需用 `ref` 设置属性和监听事件。
5. 动态图片处理用 JS API：`el.setImage(file)`、`el.downloadPNG()`、`el.clearImage()`；事件 `dither-load` / `dither-clear` / `dither-error`。

完整参数表见 `README.md` 的「组件文档」章节。

## 约束

- 组件本体 `dither-light.js` 必须保持单文件、零依赖、可直接 `<script src>` 引入；不要给它引入 npm 包、构建工具或 CDN 依赖
- 唯一例外是 `examples/threejs-source.html`（从 CDN 引 Three.js，需联网）。交付这个页面时要明确告知用户需要联网
- 界面与交付给用户的说明使用简体中文

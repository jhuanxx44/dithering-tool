---
name: dither-light
description: Bayer 有序抖动（dithering）光影特效。当用户想把本地图片/照片处理成复古网点画、1-bit 抖动风格，或给网页项目添加抖动光影背景特效时使用。提供零依赖单文件 Web Component（dither-light.js），无需构建即可嵌入任意前端项目（含 React / Vue）。
---

# Dither Light Skill

把「Bayer 有序抖动」能力带给用户：图片风格化处理 + 网页光影特效组件。

## 能力清单（本仓库文件）

| 文件 | 作用 |
| --- | --- |
| `dither-light.js` | **核心资产，唯一需要分发的文件**。注册 `<dither-light>` 自定义元素，零依赖 |
| `examples/image-processor.html` | 独立图片处理器：选图 → 实时调参 → 下载 PNG |
| `examples/background.html` | 背景特效最小嵌入示例 |
| `index.html` | 完整游乐场（所有参数的交互演示） |
| `README.md` | 完整属性 / API / 事件文档 |

## 场景一：用户想处理本地图片（核心场景）

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

## 场景二：用户想把特效集成到自己的网页项目

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

完整参数表见 `README.md` 的「作为组件使用」章节。

## 约束

- 组件必须保持单文件、零依赖、可直接 `<script src>` 引入；不要引入 npm 包、构建工具或 CDN 依赖
- 界面与交付给用户的说明使用简体中文

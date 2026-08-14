# 路径 C：图片 / 照片抖动

把照片变成复古网点画。这条路径最简单，也最常被请求。

## 交付方式（推荐）

拷 `dither-light.js` + `examples/image-processor.html` 到用户的工作目录（或图片所在目录）：

1. 两个文件放同一目录，把页面里的 `src="../dither-light.js"` 改成 `src="dither-light.js"`
2. `python3 -m http.server 8000`
3. 告诉用户访问 `http://localhost:8000/image-processor.html`，选择或拖入图片，调参后点「下载 PNG」

⚠️ **不要让用户双击 `file://` 打开**：canvas 会被污染，抖动计算和 PNG 导出都会失败。

## 用户给了具体图片路径时

可以生成一个预置图片的页面（与图片同目录）：

```html
<!doctype html>
<meta charset="utf-8">
<style>html,body{height:100%;margin:0}dither-light{width:100vw;height:100vh}</style>
<dither-light src="图片文件名.png" preset="shadow" matrix="8" grid="5"></dither-light>
<script src="dither-light.js"></script>
```

加载完成后可直接调 `document.querySelector('dither-light').downloadPNG()`。

## JS 接法

```js
await fx.setImage(fileOrBlobOrUrlOrImg);   // File / Blob / URL / HTMLImageElement
fx.downloadPNG();                          // 默认文件名 dithered-原图名.png
fx.clearImage();                           // 清除，恢复渐变模式
```

图片模式是**静态快照语义**：按脏标记重绘，静态画面零开销。每帧变化的画面要用 `attachSource()`（见 [threejs.md](threejs.md)）。

## 调参建议

| 想要的效果 | 参数 |
| --- | --- |
| 照片细腻 | `grid` 3–5，`matrix="8"` |
| 海报 / 强风格 | `grid` 8–14，`matrix="4"` 或 `"2"` |
| 明暗层次不够 | 调 `contrast`（默认 1.35） |
| 暗部太死 | 调 `ambient`（默认 0.22） |

三种预设在图片模式下的映射：

- `shadow` —— 白底黑点，经典印刷网点
- `highlight` —— 黑底白点
- `duotone` —— 深紫 + 暖橙双色调

## 边界

- **图片模式优先级最高**：设了 `src` 或调过 `setImage()` 时，`scene` 自动让位
- 图片模式下 `light` 和 `speed` 无效（没有光场可动）
- **跨域图片**如需导出 PNG，要加 `crossorigin="anonymous"` 且服务端允许 CORS，否则 canvas 被污染、导出失败
- 导出是纯本地行为，不上传任何数据——用户问隐私时可以明确这点

## 事件

```js
fx.addEventListener('dither-load',  e => console.log(e.detail));  // { name, width, height }
fx.addEventListener('dither-clear', e => {});                     // {}
fx.addEventListener('dither-error', e => console.warn(e.detail));  // { message }
```

事件均 `bubbles` 且 `composed`，可穿透 Shadow DOM 在外层监听。

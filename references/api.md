# 完整 API 参考

`<dither-light>` 的全部属性、方法与事件。需要精确签名时读这个文件。

## 引入

```html
<script src="dither-light.js"></script>
```

或 jsDelivr（建议锁 tag，`@main` 会跟着仓库变）：

```html
<script src="https://cdn.jsdelivr.net/gh/jhuanxx44/dither-light@main/dither-light.js"></script>
```

尺寸完全由使用者的 CSS 控制（默认 `display: block`，**需要给定高度**）。内部自动适配尺寸变化与高 DPI（上限 2×）。

## 属性

所有属性都可随时 `setAttribute` 修改，实时生效。

| 属性 | 取值 | 默认 | 说明 |
| --- | --- | --- | --- |
| `scene` | `off` / `blob` / `sphere` / `torus` / `cut` / `gem` | `off` | 设为造型名进入 3D 模式。未知值按 `off` 处理 |
| `src` | 图片 URL | — | 设置后进入图片模式，**优先级高于 `scene`** |
| `preset` | `shadow` / `highlight` / `duotone` | `shadow` | 白底黑点 / 黑底白点 / 双色调（渐变模式下分别对应 multiply / screen / overlay） |
| `matrix` | `2` / `3` / `4` / `8` | `8` | Bayer 矩阵阶数，越高网点分布越细腻 |
| `grid` | `2` – `14` | `5` | 网点边长（px），越小越细腻、计算量越大 |
| `contrast` | `0.2` – `3` | `1.35` | 明暗过渡的对比强度 |
| `ambient` | `0` – `0.7` | `0.22` | 全局提亮程度 |
| `light` | `auto` / `pointer` | `auto` | 光源自动游走或跟随指针（作用域为组件自身；图片模式下无效） |
| `speed` | `0` – `3` | `1` | 动画速度（图片模式下无效；系统开启「减少动态」时强制为 0） |

超出范围的数值会被夹到边界，非法值回落到默认值——不会抛错。

## 方法

```js
const fx = document.querySelector('dither-light');
```

| 方法 | 说明 |
| --- | --- |
| `await fx.setImage(source)` | 进入图片模式。`source` 可以是 `File` / `Blob` / URL 字符串 / `HTMLImageElement` |
| `fx.clearImage()` | 清除图片，恢复渐变模式 |
| `fx.attachSource(source)` | 接入实时画面源。`source` 是 canvas 或带 `domElement` 的对象（如 Three.js renderer） |
| `fx.detachSource()` | 断开实时源 |
| `fx.renderFrame()` | 立即用当前源重绘一帧（WebGL 源需在 `render()` 后同步调用） |
| `fx.downloadPNG(filename?)` | 导出当前画面，默认文件名 `dithered-原图名.png` |

`attachSource()` 传入非 canvas 会抛 `TypeError`。

## 只读属性

| 属性 | 说明 |
| --- | --- |
| `fx.hasImage` | 是否处于图片 / 实时源模式 |
| `fx.is3D` | 是否处于 3D 场景模式 |

## 静态快照 vs 实时源

| | `setImage()` | `attachSource()` |
| --- | --- | --- |
| 语义 | 静态快照 | 每帧重采样 |
| 亮度缓存 | 有（按脏标记重绘） | 无 |
| 派发 `dither-load` | 是 | 否 |

用 `setImage()` 接每帧变化的画面会复用第一帧的亮度场，并把事件刷爆。

## 事件

均 `bubbles` 且 `composed`，可穿透 Shadow DOM 在外层监听。

| 事件 | 时机 | `event.detail` |
| --- | --- | --- |
| `dither-load` | 图片加载完成 | `{ name, width, height }` |
| `dither-clear` | 图片已清除 | `{}` |
| `dither-error` | 图片加载失败 | `{ message }` |

## 模式优先级

```
图片 / 实时源  >  3D 场景（scene）  >  渐变（默认）
```

## 浏览器要求

Custom Elements、Shadow DOM、Canvas 2D、ResizeObserver、`mix-blend-mode`。不需要网络、不需要安装。尊重 `prefers-reduced-motion`。

# Dithering Light · 渐变光影抖动

一个单文件、零依赖的交互式网页：用 **Bayer 有序抖动**在顶层生成光影图层，叠加在**漂移渐变**底层之上。纯 HTML + CSS + Canvas 实现，打开即用。

![效果预览](preview.png)

## 特性

- 单文件 `index.html`，无任何依赖、无构建步骤，双击即可运行
- Bayer 有序抖动矩阵：`2×2` / `3×3` / `4×4` / `8×8` 实时切换
- 三种预设（对应三种 CSS 混合模式）：
  - `Shadow · multiply`：暗部抖出阴影，渐变底层透出
  - `Highlight · screen`：亮部抖出高光
  - `Duotone · overlay`：暗部 / 亮部同时抖动，双色调效果
- 光源控制：自动游走（双光源缓慢运动）或跟随指针
- 实时参数：速度、网点大小、对比度、环境光
- 细节适配：`prefers-reduced-motion`（减少动态）、高 DPI 渲染、移动端单列布局

## 快速开始

直接打开：

```bash
open index.html
```

或用任意静态服务器（推荐，便于后续扩展）：

```bash
# Python
python3 -m http.server 8000

# Node
npx serve .
```

然后访问 `http://localhost:8000`。

## 参数说明

| 参数 | 说明 | 默认值 | 范围 |
| --- | --- | --- | --- |
| Preset | 预设：阴影 / 高光 / 双色调（multiply / screen / overlay） | Shadow | 3 种 |
| 光源 | 自动游走，或跟随指针（指针处亮、对侧暗） | 自动游走 | 2 种 |
| Bayer 矩阵 | 抖动矩阵阶数，阶数越高网点分布越细腻 | 8×8 | 2 / 3 / 4 / 8 |
| 速度 | 光源与渐变动画的速度倍数 | 1.00 | 0 – 3 |
| 网点 | 单个网点边长（px），越小越细腻、计算量越大 | 5 px | 2 – 14 px |
| 对比度 | 明暗过渡的对比强度 | 1.35 | 0.2 – 3 |
| 环境光 | 全局提亮程度，数值越大暗部越亮 | 0.22 | 0 – 0.7 |

## 实现原理

- **底层**：`#gradient` 叠加多层 `radial-gradient`（暖橙 / 粉红 / 紫）与深色 `linear-gradient`，用 CSS 动画缓慢漂移、缩放。
- **顶层**：`canvas#dither` 按网格逐格计算光照值，与 Bayer 阈值矩阵比较，决定该网点着黑 / 着白 / 透明。
- **混合**：通过 `mix-blend-mode`（`multiply` / `screen` / `overlay`）把抖动图层与渐变底层合成。
- **性能**：每帧在低分辨率离屏 canvas 上逐格计算，再关闭平滑拉伸到全屏，保证实时交互流畅。

## 浏览器支持

现代浏览器即可（依赖 Canvas 2D、`mix-blend-mode`、`backdrop-filter`、`matchMedia`）。不需要网络、不需要任何安装。

## 许可证

[MIT](LICENSE)

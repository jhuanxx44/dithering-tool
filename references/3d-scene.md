# 路径 A：内置 3D 抖动场景

用户想要 3D 抖动效果，但**没有自己的模型**。内置造型直接能跑，纯 CPU、不需要 WebGL。

## 最小可用

```html
<script src="dither-light.js"></script>
<dither-light scene="blob" preset="shadow" grid="4"
              style="width: 100%; aspect-ratio: 16 / 9;"></dither-light>
```

直接拷 `examples/scene-3d.html` 给用户就是一个能跑的完整页面（自带造型 / 预设 / 光源 / 网点切换）。

## 五种内置造型

| `scene` | 造型 | 适合 |
| --- | --- | --- |
| `blob` | 融合球（平滑并集） | 默认推荐，形体最饱满耐看 |
| `sphere` | 单球 | 最省算力的基准 |
| `torus` | 圆环 | 有孔洞，能体现抖动的层次 |
| `cut` | 立方挖球（布尔差集） | 展示硬边 + 布尔运算 |
| `gem` | 八面体融球 | 尖锐造型，海报感强 |

未知值按 `off` 处理（退回渐变模式），所以拼错造型名不会报错、只会看起来没生效——检查拼写。

## 关键参数

- `grid`：网点边长。**越小越细腻但开销越大**。全屏 1280×800 下 `grid=4` 约 11ms/帧、`grid=6` 约 5ms、`grid=8` 约 3ms。日常 4–6 最稳，海报感用 8–14
- `matrix`：Bayer 阶数。`8` 过渡最平滑，`2` 颗粒感最强
- `light="pointer"`：光照方向跟随指针，适合做可交互的 hero 区块
- `contrast` / `ambient`：调明暗分布与暗部提亮

## 必须知道的边界

- **3D 模式输出不透明画面**，不参与 `mix-blend-mode`。不适合当半透明背景叠在内容下面——那种需求走路径 D
- 设了 `src` 或调过 `setImage()` 时**图片模式优先**，`scene` 自动让位
- 用户系统开启「减少动态」时动画会停（`speed` 强制为 0），这是有意行为

## 加自定义 SDF 造型

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

现成的图元与算子：

| 函数 | 签名 |
| --- | --- |
| `sdSphere` | `(px, py, pz, r)` |
| `sdBox` | `(px, py, pz, bx, by, bz, r)` — `r` 是圆角半径 |
| `sdTorus` | `(px, py, pz, major, minor)` |
| `sdOctahedron` | `(px, py, pz, s)` |
| `smoothUnion` | `(a, b, k)` — `k` 越大过渡越圆润 |
| `smoothSubtract` | `(a, b, k)` — 从 `a` 挖掉 `b` |
| `rotY` | `(px, pz, angle)` → `[px, pz]` |

⚠️ **新造型必须留在包围球 `BOUND_R`（默认 1.55）内**，否则会被剔除逻辑切掉、看起来像被凭空削掉一块。造型更大就同步调大这个常量，并重新测性能——包围球剔除是这条路径最重要的优化（见 [lighting.md](lighting.md) 末尾的性能说明）。

加完造型记得：五种以上造型都要能出形且互不相同，再跑一次密度采样确认没有整片实心或满屏噪点。

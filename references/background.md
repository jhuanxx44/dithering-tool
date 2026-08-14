# 路径 D：网页抖动光影背景

用户想要垫在内容下面的背景特效。**这是唯一输出半透明画面的模式**，也是唯一参与 `mix-blend-mode` 的模式。

## 接法

```html
<script src="dither-light.js"></script>
<dither-light preset="shadow" light="auto" speed="1"
              style="position: fixed; inset: 0; z-index: -1;"></dither-light>
```

不设 `scene` 也不设 `src` 时就是渐变模式（默认）。参考 `examples/background.html`。

## 为什么背景不能用 3D 模式

3D 与图片模式都输出**不透明**画面，会把下面的内容整个挡住。如果用户想要「3D 造型当背景」，要么：

- 给组件一个独立区块（比如 hero 区），内容不压在上面
- 或者接受它是一块不透明的视觉元素，不是背景

不要试图给 3D 模式加透明度——它不参与混合模式是设计决定，不是缺陷。

## 三种预设对应的混合模式

| `preset` | `mix-blend-mode` | 观感 |
| --- | --- | --- |
| `shadow` | `multiply` | 白底黑点，压暗 |
| `highlight` | `screen` | 黑底白点，提亮 |
| `duotone` | `overlay` | 双色调 |

## 集成到用户项目

1. 把 `dither-light.js` 拷进项目（保持单文件，不要加依赖或构建步骤）
2. 尺寸由使用者的 CSS 控制（默认 `display: block`，**需要给定高度**）
3. 属性随时 `setAttribute` 实时生效

框架接入（Web Component 是浏览器原生标准，不需要适配层）：

- **Vue / Svelte / Angular**：模板里直接写 `<dither-light>`，属性正常绑定
- **React 19+**：原生支持自定义元素的 props 与事件
- **React 18 及以下**：用 `ref` 设置属性、监听事件

```jsx
// React 18
const ref = useRef(null);
useEffect(() => {
  ref.current.setAttribute('preset', 'shadow');
}, []);
return <dither-light ref={ref} style={{ position: 'fixed', inset: 0, zIndex: -1 }} />;
```

## 参数

- `light="auto"` 光源自动游走；`light="pointer"` 跟随指针（作用域是组件自身，不是整个页面）
- `speed` 控制漂移速度，`0` 为静止
- 用户系统开启「减少动态」时 `speed` 强制为 0——这是有意行为，不要绕过

## 性能

渐变模式比 3D 便宜得多：底层是 CSS 动画驱动的 `radial-gradient`，顶层只按网格算一遍光场。放心当全屏背景用。

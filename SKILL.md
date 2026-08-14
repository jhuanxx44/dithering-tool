---
name: dither-light
description: 实时 1-bit 抖动（dithering）渲染器。当用户想要 Obra Dinn 式的 3D 抖动效果、想给自己的 3D 模型（Three.js / glTF / 白模）加抖动后处理、想把照片处理成复古网点画，或给网页添加抖动光影背景时使用。零依赖单文件 Web Component（dither-light.js），内置 SDF raymarch 3D 场景，纯 CPU 不需要 WebGL，无需构建即可嵌入任意前端项目（含 React / Vue）。
---

# Dither Light

零依赖的实时 1-bit 抖动渲染器。核心资产是单文件 `dither-light.js`（注册 `<dither-light>` 自定义元素）。

四种模式共用同一套 Bayer 抖动管线，**区别只在亮度从哪来**。先按下表定位用户要哪条路径，再读对应的参考文件。

## 先做这一步：判断走哪条路径

| 用户想做什么 | 典型话术 | 路径 | 接下来读 |
| --- | --- | --- | --- |
| 内置 3D 造型的抖动 | 「Obra Dinn 那种效果」「3D dithering」「立体抖动场景」 | **A** | [references/3d-scene.md](references/3d-scene.md) |
| **自己的** 3D 模型加抖动 | 「我的 threejs 白模能套吗」「给这个 glTF 加 dithering」 | **B** | [references/threejs.md](references/threejs.md) |
| 处理图片 / 照片 | 「把这张照片做成网点风格」「图片加 dithering」 | **C** | [references/image.md](references/image.md) |
| 网页背景特效 | 「给落地页加抖动背景」 | **D** | [references/background.md](references/background.md) |

判不准时的分界线：

- 用户提到 **Three.js / glTF / .glb / 自己的模型或场景文件** → 走 B，不要试图用内置造型糊弄
- 用户只说「3D 抖动」但没有自己的模型 → 走 A，内置造型直接能跑
- 用户给了图片文件或图片路径 → 走 C（图片模式优先级高于 `scene`）
- 用户要的是「垫在内容下面的背景」→ 走 D（只有这个模式输出半透明）

一次请求可能涉及多条（例如「hero 放 3D 抖动、头像用图片抖动」）：分别按对应路径处理，同一页面可以放多个组件实例。

## 最快的交付方式

多数请求的最短路径是**直接拷对应的 `examples/*.html` + `dither-light.js` 到用户目录**：

1. 两个文件放同一目录，把页面里的 `src="../dither-light.js"` 改成 `src="dither-light.js"`
2. `python3 -m http.server 8000`
3. 把访问地址明确告诉用户，再按需调参

## 所有路径都必须遵守

**① 走 http://，不要 file://**

`file://` 下 canvas 会被浏览器安全策略污染，抖动计算与 PNG 导出都会失败。必须通过本地服务打开。

**② 1-bit 配光四条铁律**

只要涉及配光（路径 A、B 必然涉及），这四条决定效果好不好看。**抖动只有两级，形体靠区域之间的密度差读出来，不是绝对亮度。**

1. 排出三段密度差：背景最亮（几乎不出网点）→ 地面次之（稀疏）→ 造型暗面最暗（密集）
2. **背景要给亮**：`shadow` 预设里墨点跟着暗部走，深色背景会整片长满网点、把主体吞掉。这条最反直觉
3. 不要压到中灰：整幅挤在中间调会退化成满屏 50% 噪点，轮廓完全溶掉
4. 不要让亮部顶到 1.0：会变成一整片实心，同样丢形体；造型亮面还要**低于**背景亮度

改完配光要用密度采样验证（分区统计墨点占比），不要只靠肉眼看截图。方法见 [references/lighting.md](references/lighting.md)。

**③ 零依赖**

`dither-light.js` 必须保持单文件、零依赖、可直接 `<script src>` 引入，不要给它加 npm 包、构建步骤或 CDN 依赖。唯一例外是 `examples/threejs-source.html`（引 Three.js CDN，需联网）。

## 仓库文件

| 文件 | 作用 |
| --- | --- |
| `dither-light.js` | **核心资产，唯一需要分发的文件** |
| `examples/scene-3d.html` | 路径 A 的完整可跑页面（五种造型可切） |
| `examples/threejs-source.html` | 路径 B 的左右对照示例（需联网） |
| `examples/image-processor.html` | 路径 C 的独立处理器（选图 → 调参 → 下载 PNG） |
| `examples/background.html` | 路径 D 的最小嵌入示例 |
| `index.html` | 完整游乐场（所有参数的交互演示） |
| `README.md` | 完整文档（英文；中文版 `README.zh.md`） |

## 参考文件索引

按需读取，不要一次全读：

| 文件 | 什么时候读 |
| --- | --- |
| [references/3d-scene.md](references/3d-scene.md) | 路径 A；也包括用户想加自定义 SDF 造型 |
| [references/threejs.md](references/threejs.md) | 路径 B；含 `preserveDrawingBuffer` 等必踩的坑 |
| [references/image.md](references/image.md) | 路径 C；含跨域导出限制 |
| [references/background.md](references/background.md) | 路径 D |
| [references/lighting.md](references/lighting.md) | 配光不好看、需要密度验证方法时 |
| [references/api.md](references/api.md) | 需要完整属性表 / JS API / 事件签名时 |

## 装法（用户问怎么安装时）

frontmatter 用的是 `name` + `description` 通用格式，Claude Code 与 Codex 都认：

```bash
# 任意 agent，自动识别安装路径
npx skills add jhuanxx44/dithering-tool

# 或手动克隆
git clone https://github.com/jhuanxx44/dithering-tool.git ~/.claude/skills/dither-light
git clone https://github.com/jhuanxx44/dithering-tool.git ~/.codex/skills/dither-light
```

## 交付约定

- 界面文案与交付说明使用简体中文
- 起完服务要把访问地址明确告诉用户
- 涉及配光的改动，交付前自己先确认渲染结果，别把满屏噪点或整片实心交出去

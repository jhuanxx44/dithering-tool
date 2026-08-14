# 路径 B：给用户自己的 3D 模型加抖动

用户已经有模型（glTF / .glb / 白模 / 现成的 Three.js 场景）。

**内置造型是隐式曲面，喂不进三角网格**，所以走后处理：Three.js 照常渲染，把它的 canvas 当亮度源交给抖动层。渲染开销只跟网点数有关，**与模型面数无关**。

## 接法

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

左右对照的完整示例：`examples/threejs-source.html`（**需要联网**，从 CDN 引 Three.js）。要换成用户自己的模型，把 `buildShape()` 里的几何体换成 `GLTFLoader` 加载的场景即可，抖动那一侧不用动。

## 三个必踩的坑

**① `preserveDrawingBuffer: true` 不能省**

否则 WebGL 的 drawing buffer 在合成后被清空，晚一帧采样只会拿到**空白画面**。症状是抖动层一片死白或一片实心。

替代方案：保证 `renderFrame()` 与 `renderer.render()` 在同一个任务里同步执行。但加这个 flag 更稳。

**② 用 `attachSource()`，不要用 `setImage()`**

| | `setImage()` | `attachSource()` |
| --- | --- | --- |
| 语义 | 静态快照 | 每帧重采样 |
| 亮度缓存 | 有 | 无 |
| 派发 `dither-load` | 是 | 否 |

用 `setImage()` 接每帧变化的画面会**复用第一帧的亮度场**（画面看起来卡住不动），并把 `dither-load` 事件刷爆。

**③ 白模必须重新配光**

这是效果好不好看的关键，也是最容易翻车的地方。默认的纯白材质 + 强光会顶到 1.0，抖动只有 1 bit，顶满就是**一整片实心，形体全丢**。

不要过度纠正：把整幅压到中灰会变成**满屏 50% 噪点**，轮廓直接化掉。

具体怎么配见 [lighting.md](lighting.md)。一句话版本：**背景给亮、造型亮面低于背景、暗面给足密度**。

## 观感说明

抖动图案锚定在屏幕空间，所以镜头移动时网点会有轻微 swimming。这不是 bug，正是 Obra Dinn 观感的来源。

## 性能参考

1200×700 实测（叠在 Three.js 自己的渲染时间之上）：

| `grid` | 抖动层耗时 |
| --- | --- |
| 3 | 0.7ms/帧 |
| 4 | 0.4ms/帧 |
| 6 | 0.2ms/帧 |

比内置 3D 场景便宜得多——因为这条路径不做 raymarch，只是采样一张已有的 canvas。

## 断开

```js
fx.detachSource();   // 恢复渐变 / 3D 模式
```

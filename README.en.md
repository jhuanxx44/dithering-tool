# Dither Light

[简体中文](README.md) · **English**

A zero-dependency, single-file **real-time 1-bit dithering renderer**. One `<dither-light>` custom element that quantizes any image into two levels — ink or paper — as Bayer halftone dots. The *Return of the Obra Dinn* look.

Ships with an SDF ray-marched 3D scene. Pure CPU, no WebGL. Can also post-process any Three.js model.

**Cost scales with dot count, not polygon count.** Fullscreen 1280×800 at `grid=4` runs about 11ms/frame.

![Real-time dithering of five built-in SDF shapes](preview.png)

*Five built-in shapes, all rendered in real time on the CPU. Top right uses the `duotone` preset.*

## Two ways to use it

**① As a Skill for AI agents** — clone into your skills directory, then just ask in plain language. The agent reads `SKILL.md` and wires things up for you:

```bash
# Claude Code
git clone https://github.com/jhuanxx44/dithering-tool.git ~/.claude/skills/dither-light
```

> "Make me an Obra Dinn style 3D dithering effect"
> "Apply dithering to my Three.js model"
> "Turn this photo into a halftone print"

For Codex and other agents, see [Using it as a Skill](#using-it-as-a-skill).

**② As a plain frontend component** — single file, just copy it:

```html
<script src="dither-light.js"></script>
<dither-light scene="blob" style="width: 100%; height: 480px;"></dither-light>
```

That's it. No build step, no npm, no framework.

## Contents

- [Using it as a Skill](#using-it-as-a-skill)
- [Four modes](#four-modes) · [3D scene](#1-3d-scene-built-in) · [Three.js](#2-any-3d-model-threejs) · [Image dithering](#3-image-dithering) · [Gradient background](#4-gradient-light-background)
- [Component reference](#component-reference): [Attributes](#attributes) · [JS API](#js-api) · [Events](#events) · [Frameworks](#using-with-frameworks)
- [Tuning and lighting](#tuning-and-lighting)
- [How it works](#how-it-works)

---

## Using it as a Skill

`SKILL.md` uses the `name` + `description` frontmatter format, which **both Claude Code and Codex understand**. The same repository works for either tool with no changes — only the install directory differs:

```bash
# Claude Code
git clone https://github.com/jhuanxx44/dithering-tool.git ~/.claude/skills/dither-light

# Codex CLI
git clone https://github.com/jhuanxx44/dithering-tool.git ~/.codex/skills/dither-light
```

To use both without cloning twice, symlink it:

```bash
git clone https://github.com/jhuanxx44/dithering-tool.git ~/src/dither-light
ln -s ~/src/dither-light ~/.claude/skills/dither-light
ln -s ~/src/dither-light ~/.codex/skills/dither-light
```

Once installed, just ask in plain language. The agent reads `SKILL.md` and figures out what to do:

| You say | The agent does |
| --- | --- |
| "Make me an Obra Dinn style 3D dithering effect" | Copies the component and an example page, serves it locally so you can see it |
| "Apply dithering to my Three.js model" | Wires up `attachSource()` and relights the scene per the 1-bit rules |
| "Turn this photo into a halftone print" | Sets up an image processor page, tunes it, exports a PNG |
| "Add a dithered background to my landing page" | Integrates gradient mode into your project |

Two files drive this:

- **`SKILL.md`** — capability description for agents: when to use it, how, and what the pitfalls are
- **`AGENTS.md`** — development rules for agents working *on this repository*. Codex reads `AGENTS.md` from the repo root automatically; `CLAUDE.md` is a symlink to it, so both tools share one source of truth

---

## Four modes

All four share the same Bayer dithering pipeline. The only difference is **where the luminance comes from**.

| Mode | Luminance source | Output |
| --- | --- | --- |
| 3D scene | Built-in SDF raymarch shading | Opaque |
| Three.js | External canvas, sampled every frame | Opaque |
| Image dithering | Image luminance | Opaque |
| Gradient background | Built-in gradient light field | Translucent, participates in blend modes |

### 1. 3D scene (built-in)

Set `scene` to a shape name to enter 3D mode:

```html
<dither-light scene="blob" preset="shadow" grid="4"
              style="width: 100%; aspect-ratio: 16 / 9;"></dither-light>
```

Five built-in shapes, all implicit surfaces, switchable at any time:

| `scene` | Shape | SDF technique |
| --- | --- | --- |
| `blob` | Merged spheres | Smooth union (`smoothUnion`) |
| `sphere` | Single sphere | Cheapest baseline |
| `torus` | Torus | Rotation + torus distance field |
| `cut` | Cube minus sphere | Smooth subtraction (boolean) |
| `gem` | Gem | Octahedron fused with a sphere |

Runnable page: [`examples/scene-3d.html`](examples/scene-3d.html)

#### Adding your own shape

Add a `(px, py, pz, time) => distance` function to `SHAPES` in `dither-light.js`. The render pipeline stays untouched:

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

Available primitives and operators: `sdSphere` / `sdBox` / `sdTorus` / `sdOctahedron`, `smoothUnion` / `smoothSubtract` / `rotY`.

⚠️ New shapes must fit inside the bounding sphere `BOUND_R` (default 1.55), or the culling logic will clip them. Enlarge that constant for bigger shapes — it's the key performance optimization, see [How it works](#how-it-works).

### 2. Any 3D model (Three.js)

Built-in shapes are implicit surfaces, so **triangle meshes can't be fed in**. For arbitrary models (glTF, untextured models), go through post-processing: let Three.js render as usual and treat its canvas as the luminance source.

```js
const renderer = new THREE.WebGLRenderer({
  canvas,
  preserveDrawingBuffer: true   // required, see below
});

fx.attachSource(renderer.domElement);   // attach once

function frame() {
  renderer.render(scene, camera);
  fx.renderFrame();                      // call synchronously after render
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
```

Two gotchas:

- **`preserveDrawingBuffer: true` is not optional.** Without it the WebGL drawing buffer is cleared after compositing, and sampling one frame later yields a blank image. Alternatively, guarantee that `renderFrame()` runs synchronously in the same task as `renderer.render()`.
- **Untextured models need relighting.** A pure white material under strong light saturates at 1.0, goes fully solid, and loses all form. See [Tuning and lighting](#tuning-and-lighting).

Side-by-side example: [`examples/threejs-source.html`](examples/threejs-source.html)

> This is the **only file in the repo that needs network access** (it pulls Three.js from a CDN). The component itself, `dither-light.js`, is always dependency-free.

### 3. Image dithering

Turn photos into retro halftone prints. Setting `src` enters image mode (which takes priority over `scene`):

```html
<dither-light src="photo.jpg" preset="duotone" matrix="8" grid="5"
              style="width: 100%; aspect-ratio: 4 / 3;"></dither-light>
```

You can also pass a `File` / `Blob` via JS (file picker, drag and drop):

```js
await fx.setImage(file);
fx.downloadPNG();          // exports locally, nothing is uploaded
```

Standalone processor page (pick → tune → download): [`examples/image-processor.html`](examples/image-processor.html)

> To export PNGs from cross-origin images, add `crossorigin="anonymous"` and make sure the server allows CORS. Otherwise the canvas is tainted and export fails.

### 4. Gradient light background

With neither `scene` nor `src` set, the component runs in gradient mode: drifting layered gradients plus a translucent dither layer composited via `mix-blend-mode`. Good for sitting behind content.

```html
<dither-light preset="shadow" light="auto" speed="1"
              style="position: fixed; inset: 0; z-index: -1;"></dither-light>
```

See [`examples/background.html`](examples/background.html).

> This is the only mode with translucent output. 3D and image modes are opaque and don't participate in `mix-blend-mode` — use gradient mode for backgrounds.

---

## Component reference

### Installing

Single file, just copy it:

```html
<script src="dither-light.js"></script>
```

Or via jsDelivr (pin a tag — `@main` tracks the repository):

```html
<script src="https://cdn.jsdelivr.net/gh/jhuanxx44/dithering-tool@main/dither-light.js"></script>
```

Sizing is entirely up to your CSS (`display: block` by default, so **give it a height**). Resize and high-DPI handling (capped at 2×) are automatic.

### Attributes

Every attribute can be changed with `setAttribute` at any time and takes effect immediately.

| Attribute | Values | Default | Notes |
| --- | --- | --- | --- |
| `scene` | `off` / `blob` / `sphere` / `torus` / `cut` / `gem` | `off` | A shape name enters 3D mode. Unknown values are treated as `off` |
| `src` | Image URL | — | Enters image mode; takes priority over `scene` |
| `preset` | `shadow` / `highlight` / `duotone` | `shadow` | Black on white / white on black / duotone (in gradient mode these map to multiply / screen / overlay) |
| `matrix` | `2` / `3` / `4` / `8` | `8` | Bayer matrix order; higher is finer |
| `grid` | `2` – `14` | `5` | Dot size in px; smaller is finer and costlier |
| `contrast` | `0.2` – `3` | `1.35` | Contrast of the light-to-dark transition |
| `ambient` | `0` – `0.7` | `0.22` | Global lift |
| `light` | `auto` / `pointer` | `auto` | Light drifts automatically or follows the pointer (scoped to the element; no effect in image mode) |
| `speed` | `0` – `3` | `1` | Animation speed (no effect in image mode; forced to 0 when the OS requests reduced motion) |

### JS API

```js
const fx = document.querySelector('dither-light');

// Image mode (static snapshot semantics)
await fx.setImage(fileOrBlobOrUrlOrImg);
fx.clearImage();

// Live source (re-sampled every frame)
fx.attachSource(canvasOrThreeRenderer);
fx.renderFrame();
fx.detachSource();

// Export
fx.downloadPNG();          // optional filename; defaults to dithered-<name>.png

// Read-only state
fx.hasImage;               // in image / live-source mode?
fx.is3D;                   // in 3D scene mode?
```

How `attachSource()` differs from `setImage()`:

| | `setImage()` | `attachSource()` |
| --- | --- | --- |
| Semantics | Static snapshot | Re-sampled every frame |
| Luminance cache | Yes (redraws on dirty flag) | No |
| Fires `dither-load` | Yes | No |

Using `setImage()` for per-frame content will reuse the first frame's luminance field and flood you with events.

### Events

All events `bubble` and are `composed`, so they cross the Shadow DOM boundary.

| Event | When | `event.detail` |
| --- | --- | --- |
| `dither-load` | Image finished loading | `{ name, width, height }` |
| `dither-clear` | Image cleared | `{}` |
| `dither-error` | Image failed to load | `{ message }` |

### Using with frameworks

Web Components are a browser standard, so no adapter layer is needed.

- **Vue / Svelte / Angular**: write `<dither-light>` in templates, bind attributes normally
- **React 19+**: custom element props and events work natively
- **React 18 and below**: use a `ref` to set attributes and attach listeners

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

## Tuning and lighting

### Picking parameters

| Goal | Parameters |
| --- | --- |
| Fine detail in photos | `grid` 3–5, `matrix="8"` |
| Poster / heavy style | `grid` 8–14, `matrix="4"` or `"2"` |
| Everyday 3D | `grid` 4–6 (fullscreen `grid=4` ≈ 11ms/frame, `grid=6` ≈ 5ms) |
| Not enough tonal separation | Raise `contrast` |
| Shadows too dead | Raise `ambient` |

### Four rules for 1-bit lighting

These decide whether a 3D scene or an untextured Three.js model actually reads well. **Dithering has only two levels, so form comes from density differences between regions, not from absolute brightness.**

1. **Establish three density bands.** Background brightest (almost no dots) → ground next (sparse) → the shape's dark side darkest (dense). The built-in scene measures 0% → 5% → 26%.
2. **Keep the background bright.** In the `shadow` preset, ink follows darkness, so a dark background fills solid with dots and swallows the subject. This is the least intuitive rule.
3. **Don't crush everything to mid-grey.** Squeezing the whole frame into the midtones degenerates into 50% noise and dissolves the silhouette entirely.
4. **Don't let highlights saturate at 1.0.** That goes fully solid and loses form too. The shape's lit side must also stay **below** background brightness, or its outline dissolves into the background.

After changing lighting, verify with density sampling (ink percentage per region) rather than eyeballing screenshots.

---

## How it works

**Bayer ordered dithering**: the canvas takes one luminance value per grid cell and compares it against a Bayer threshold matrix to decide ink or paper. The matrix is anchored in screen space, so dots shimmer slightly as the camera moves — which is exactly where the Obra Dinn look comes from.

**3D scene**: each dot is a view ray, ray-marched against the shape's SDF (up to 48 steps). On hit, the normal comes from central differences, then Lambert diffuse + half-vector specular + rim darkening. The ground is a plane solved analytically, then marched toward the light for soft shadows.

**3D performance**: two levels of culling do the heavy lifting. A bounding sphere rejects rays heading for the sky or distant ground (the vast majority), and the ground's shadow march only runs for points near that sphere. Together these took fullscreen 1280×800 from 25ms/frame down to 11ms/frame (`grid=4`), with ink density matching within 0.2% — an equivalent optimization.

**Image mode**: the image is cover-sampled into a grid luminance field and cached, redrawn on a dirty flag, so static frames cost nothing.

**Gradient mode**: the base layer is several `radial-gradient`s plus a dark `linear-gradient` drifting via CSS animation; the dither canvas on top composites with `mix-blend-mode`.

---

## Repository layout

```
├── dither-light.js      The component; the only file you need to ship (zero-dep)
├── index.html           Playground (3D scene by default, all parameters live)
├── examples/
│   ├── scene-3d.html          3D scene, five switchable shapes
│   ├── threejs-source.html    Any Three.js model, side by side (needs network)
│   ├── image-processor.html   Standalone image processor
│   └── background.html        Minimal gradient background
├── SKILL.md             Skill definition (works for Claude Code and Codex)
├── AGENTS.md            Agent development rules (CLAUDE.md symlinks to it)
├── README.md            Chinese docs
├── README.en.md         English docs
└── preview.png
```

## Running locally

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

⚠️ **Don't just double-click to open it over `file://`.** Under `file://` the canvas gets tainted by browser security policy, breaking both dithering and PNG export.

## Browser support

Any modern browser: Custom Elements, Shadow DOM, Canvas 2D, ResizeObserver, `mix-blend-mode`. No network, no install. Respects `prefers-reduced-motion`.

## License

[MIT](LICENSE)

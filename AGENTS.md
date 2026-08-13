# AGENTS.md — dithering-tool

本文件是仓库根目录的 agent 行为规则，适用于 Codex、Claude Code 等编码 agent。

## 项目定位

- 零依赖的交互式前端小工具 + 可复用 Web Component：Bayer 有序抖动 + 渐变底层光影效果
- 面向开源分享，坚持「小而美」：无构建步骤、无框架、无 npm 依赖
- 仓库同时是一个 Claude Skill（`SKILL.md`）：`SKILL.md` 的 frontmatter（`name` / `description`）是 agent 的发现入口，必须保持合法；组件能力变化时同步更新 `SKILL.md`、`examples/` 与 `README.md`
- 核心资产是两个文件：
  - `dither-light.js`：组件本体（`<dither-light>` 自定义元素），所有渲染逻辑都在里面
  - `index.html`：演示 / 游乐场页面，基于组件实现，引擎不在此重复
- `examples/` 是给使用者和 Skill 的可拷贝模板，保持最小、无依赖

## 基本规则

- 界面文案与文档使用简体中文
- 不要引入构建工具、npm 包、CDN 引用或外部字体；如确有必要，先与用户确认
- 渲染引擎只维护 `dither-light.js` 一份；新增渲染能力改组件，`index.html` 只做面板交互
- 保持零依赖与「打开即用」：任何改动都不应要求用户安装或联网；组件必须保持单文件、可直接 `<script src>` 引入

## 编辑与验证

- 修改只动必要的文件，保持 diff 最小
- 修改 `index.html` 后必须手动验证：浏览器打开页面，确认渲染正常、控件可交互
- 涉及视觉或交互改动时，重点检查：三种预设混合模式、光源切换、`prefers-reduced-motion`、移动端单列布局、高 DPI 缩放
- 效果有实质变化时更新 `preview.png`（重新截图），否则不要改动
- 参数或 UI 改动后，同步更新 `README.md` 的「参数说明」小节

## 提交约定

- 不擅自 `git commit` / `push`，提交前先向用户确认
- 提交信息用中文，说明改动内容；涉及 LICENSE / README 的改动需单独说明
- 不在仓库里写 changelog 或对话记录（用 git 历史即可）

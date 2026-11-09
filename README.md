# dsh-sgv-preview

让 DSH 的 .md 默认用 **SuperGoodViewer（超好读）** 的排版引擎渲染。

## 原理

1. Host 半注册 \`POST /api/dsh-sgv/preview\`：按会话工作区解析路径，调用
   \`%LOCALAPPDATA%\SuperGoodViewer\sgv-cli.exe export <md> -o <pdf> -f <format> -t <theme>\`，
   把导出的 PDF 直接回传给浏览器。
2. Client 半向 \`documentPreviews\` 注册一个 \`priority: 'extension'\` 的 \`.md\` 渲染器，
   因此它排在内置 \`builtin\` markdown 渲染器之前，成为默认查看器；
   在下拉里仍可切回内置渲染器。

## 配置

在 profile 的 \`cordis.patch.yml\` 中：

\`\`\`yaml
- insert:
    - id: dsh-sgv-preview
      name: dsh-sgv-preview
      config:
        format: a4        # a4 | a4-landscape | fluid | slide
        fontSize: 11      # 正文字号（pt）
        theme: light      # 仅当客户端未传主题时生效
        timeoutMs: 20000
        cliPath: ''       # 留空则用 %LOCALAPPDATA%\SuperGoodViewer\sgv-cli.exe
\`\`\`

## 依赖

- SuperGoodViewer 便携版已解压在 \`%LOCALAPPDATA%\SuperGoodViewer\`，其中 \`sgv-cli.exe\`
  与 \`sogood_core.dll\` 必须同目录。

## 界面

预览由 PDF.js 自绘，而不是浏览器内置 PDF 查看器：

- **默认无侧栏、无工具栏**，只显示文档本身；
- **向上滚动**时顶部浮现 HUD（缩放 / 适应宽度 / 页码），**向下滚动**立即隐藏；
- HUD 空闲 2.4 秒且鼠标离开后自动淡出；
- 页面按视口懒渲染，缩放范围 40%–300%，默认适应面板宽度。

## 开发

\`\`\`bash
pnpm install
pnpm build      # 用 esbuild 把 src/client.js 打包成 lib/client.js
\`\`\`

\`lib/client.js\` 是构建产物，需要一并提交；DSH 启动时直接加载它。

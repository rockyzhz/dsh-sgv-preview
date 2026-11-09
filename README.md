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

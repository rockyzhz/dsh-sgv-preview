# dsh-sgv-preview

让 DeepSeek Harness 侧边栏里的 Markdown，看起来像一本排好版的书。

[English](#english) | 中文

## 它是什么

一个给 DSH 用的 Markdown 阅读插件。装上以后，在右侧栏点开 .md 文件，看到的不再是朴素的纯文本，而是认真排过版的页面：标题、正文、表格、公式、代码块、流程图，都按出版物的规则排好。

## 它从哪来

排版不是这个插件自己做的。

它借用的是 [SuperGoodViewer（超好读）](https://github.com/dotsg/SuperGoodViewer) 的能力——一个用 Rust 写的开源桌面阅读器，专门把 Markdown 排成出版级的 PDF，以“字体讲究、公式漂亮、跨平台像素级一致”著称。

本插件做的事情只有一件：让 DSH 在预览 Markdown 时，请 SuperGoodViewer 把文档排好，再把结果放进侧边栏。

所以这里看到的排版，和你在 SuperGoodViewer 里看到的是同一份。

## 能做什么

- 在右侧栏直接阅读排版好的文档，不用离开 DSH；
- 顶部工具栏平时收起，向上滚动或鼠标移到顶部才出现，不打扰阅读；
- 可在 **A4 分页** 与 **连续长卷轴** 两种版式间一键切换；
- 支持缩放、跳页、缩略图侧栏、下载 PDF、打印；
- 需要完整功能时，点「在超好读中打开」，用 SuperGoodViewer 原生应用打开同一个文件（大纲、查找、演示模式都在那边）。

## 安装

### 第一步：安装 SuperGoodViewer

先准备好 SuperGoodViewer 自带的命令行工具，插件靠它排版。

**Windows**

1. 到 [Releases](https://github.com/dotsg/SuperGoodViewer/releases) 下载 windows-x64.zip；
2. 解压到 %LOCALAPPDATA%\SuperGoodViewer，确保 sgv-cli.exe 和 sogood_core.dll 在同一个目录里。

**macOS**

1. 下载 .dmg 并安装；
2. 打开 SuperGoodViewer，进入偏好设置（Cmd + ,）→ 命令行工具 → 点「一键安装 sgv 工具」。

**Linux**

1. 下载 linux-amd64.tar.gz 并解压；
2. 把包里的 bin/sgv 加入 PATH，例如软链到 /usr/local/bin/sgv。

**如果装在了别的地方**

可以用环境变量 SGV_CLI 直接告诉插件 sgv-cli 的完整路径；SGV_APP 用来指定 SuperGoodViewer 主程序的位置。

### 第二步：安装插件

DSH 的插件放在 profile 目录里，默认是：

- Windows：%USERPROFILE%\.dsh\profiles\desktop
- macOS / Linux：~/.dsh/profiles/desktop

在这个目录下操作：

1. 把插件下载到 plugins 目录：

   ```bash
   mkdir -p plugins
   git clone https://github.com/rockyzhz/dsh-sgv-preview.git plugins/dsh-sgv-preview
   ```

2. 编辑 profile 里的 package.json，在 dependencies 中加入：

   ```json
   "dsh-sgv-preview": "link:./plugins/dsh-sgv-preview"
   ```

   > 请用 link:，不要用 file:。file: 会复制一份到 node_modules，之后更新插件不会生效。

3. 在 profile 目录执行：

   ```bash
   pnpm install
   ```

4. 编辑 cordis.patch.yml，在文件末尾追加：

   ```yaml
   - insert:
       - id: dsh-sgv-preview
         name: dsh-sgv-preview
   ```

5. 完全退出 DeepSeek Harness，再重新打开。

### 第三步：确认

打开任意一个 .md 文件，右侧栏预览的左上角应该出现「超好读」的渲染器。如果还是旧的纯文本预览，检查一下是不是漏了第 5 步的重启。

## 常见问题

**预览提示找不到 sgv-cli**

说明第一步没有装好，或者装在了非默认位置。设置环境变量 SGV_CLI 指向它即可。

**某个 Mermaid 图显示 Mermaid Render Error**

SuperGoodViewer 的命令行导出对部分较新的 Mermaid 写法支持不全。把图里的箭头改成标准写法（例如 A == 文字 ==> B）就能正常显示。原生应用里通常没这个问题。

**点「在超好读中打开」没有反应**

确认 SuperGoodViewer 已经安装；macOS 上应用名需要是 SuperGoodViewer，如果改过名字，用 SGV_APP 指定。

## 许可

本插件以 MIT 许可发布。

SuperGoodViewer 是独立项目，排版与渲染能力归它所有，请遵循它自己的许可与使用条款。

---

<a id="english"></a>

# dsh-sgv-preview (English)

Read your Markdown like a properly typeset book, right inside DeepSeek Harness.

[中文](#dsh-sgv-preview) | English

## What it is

A Markdown preview plugin for DSH. Once installed, opening a .md file in the right sidebar shows a properly typeset page instead of plain text — headings, body copy, tables, formulas, code blocks and diagrams, all laid out by publication rules.

## Where it comes from

The typesetting is not done by this plugin.

It borrows the engine of [SuperGoodViewer](https://github.com/dotsg/SuperGoodViewer), an open-source Rust desktop reader that turns Markdown into publication-grade PDF, known for careful typography, beautiful formulas and pixel-consistent output across platforms.

All this plugin does is ask SuperGoodViewer to typeset the document, then place the result in DSH's sidebar.

What you see here is the same output you would see in SuperGoodViewer itself.

## Features

- Read typeset documents directly in the right sidebar, without leaving DSH;
- The toolbar stays hidden while reading, and appears only when you scroll up or move the pointer to the top;
- Switch between **A4 pages** and a **continuous long scroll**;
- Zoom, jump to a page, thumbnail sidebar, download PDF, and print;
- When you need the full experience, click **"Open in SuperGoodViewer"** to open the same file in the native app (outline, search and presentation mode live there).

## Installation

### 1. Install SuperGoodViewer

The plugin relies on SuperGoodViewer's command-line tool to do the typesetting.

**Windows**

1. Download windows-x64.zip from [Releases](https://github.com/dotsg/SuperGoodViewer/releases);
2. Extract it to %LOCALAPPDATA%\SuperGoodViewer, keeping sgv-cli.exe and sogood_core.dll in the same folder.

**macOS**

1. Download and install the .dmg;
2. Open SuperGoodViewer, go to Preferences (Cmd + ,) → Command Line Tool → "Install sgv".

**Linux**

1. Download and extract linux-amd64.tar.gz;
2. Put bin/sgv on your PATH, for example by linking it to /usr/local/bin/sgv.

**Installed somewhere else?**

Set SGV_CLI to the full path of sgv-cli, and SGV_APP to the main SuperGoodViewer executable.

### 2. Install the plugin

DSH plugins live in a profile directory, by default:

- Windows: %USERPROFILE%\.dsh\profiles\desktop
- macOS / Linux: ~/.dsh/profiles/desktop

Inside that directory:

1. Clone the plugin into plugins:

   ```bash
   mkdir -p plugins
   git clone https://github.com/rockyzhz/dsh-sgv-preview.git plugins/dsh-sgv-preview
   ```

2. Edit the profile's package.json and add to dependencies:

   ```json
   "dsh-sgv-preview": "link:./plugins/dsh-sgv-preview"
   ```

   > Use link:, not file:. file: copies the package into node_modules, so later updates are ignored.

3. In the profile directory, run:

   ```bash
   pnpm install
   ```

4. Append to cordis.patch.yml:

   ```yaml
   - insert:
       - id: dsh-sgv-preview
         name: dsh-sgv-preview
   ```

5. Quit DeepSeek Harness completely and start it again.

### 3. Verify

Open any .md file — the renderer selector in the top-left of the right sidebar should now offer "超好读". If you still see the plain text preview, make sure you did step 5.

## Troubleshooting

**"Cannot find sgv-cli"**

The command line tool is missing or installed in a non-default location. Point SGV_CLI at it.

**A Mermaid diagram shows "Mermaid Render Error"**

The command-line exporter of SuperGoodViewer does not support some newer Mermaid syntax. Rewriting the arrows in the standard form (for example A == text ==> B) fixes it. The native app usually handles it fine.

**"Open in SuperGoodViewer" does nothing**

Make sure SuperGoodViewer is installed. On macOS the app must be named SuperGoodViewer; if you renamed it, set SGV_APP.

## License

MIT for this plugin.

SuperGoodViewer is a separate project; its typesetting and rendering capabilities remain under its own license and terms.

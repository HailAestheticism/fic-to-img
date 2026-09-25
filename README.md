# 文转条图（fic-to-img）

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Platform](https://img.shields.io/badge/platform-Windows%2010%2B-lightgrey)
![Electron](https://img.shields.io/badge/Electron-37-47848F?logo=electron&logoColor=white)
![Vue 3](https://img.shields.io/badge/Vue-3-4FC08D?logo=vuedotjs&logoColor=white)

> 面向同人文作者的纯本地长文转条图工具：流式长文编辑，分章节排版，一键导出高清长图。

`fic-to-img`：fic（同人小说）to img——把写好的长文，变成一条能直接发到社交媒体的长图。

## 为什么做这个

同人文写作里有一个一直没被解决好的痛点：长文很难转成一张清晰的长图发布到社交媒体。现有的「可编辑流式文档 + 导出图片」类工具，普遍存在两个问题：

1. 导出图片不够清晰；
2. 导出成品的排版与编辑器里的预览对不上。

文转条图正是为这两个问题而生：**导出与预览共用同一条渲染管线，所见即所得**，并支持 300DPI 高清输出。它面向同人文作者，移除了这个写作场景用不到的功能（无 AI、无云服务、无 PDF），只保留把长文又快又清晰地变成图片所必需的能力。

## 功能

- **流式编辑**：富文本（大标题/标题/段落/图片/表格/引用/分割线）、字体字号行距颜色、手动章节符与「第 X 章」自动分章
- **排版**：A4～32 开、小红书卡片、PC/手机长图等画布预设与自定义尺寸；页边距、页眉页脚页码；背景与自由图层（贴纸/形状/文字/水印）
- **预设样式**：页面设置/文本样式/背景/整套四类预设，套用只改样式、不动内容
- **导出中心**：长图 PNG/JPEG、分章节与分页打包 ZIP；清晰度三档（原图 / 300DPI 高清 / ≤2MB 压缩）；导出前画廊预览、体积预测、导出检查
- **手机协同**：局域网内 PC 起服务，手机浏览器装 PWA 即可读写文档，双向同步
- **纯本地**：JSON 文件存储，无账号、无联网组件，文档完全属于你

## 下载

前往 [Releases](https://github.com/HailAestheticism/fic-to-img/releases) 下载：

- `文转条图-Setup-x.y.z.exe`：安装版
- `文转条图-x.y.z-便携版.exe`：便携版，免安装

支持 Windows 10/11 x64。安装包未做代码签名，SmartScreen 首次可能提示「未知发布者」，选择「更多信息 → 仍要运行」即可。

## 本地开发

```bash
npm install
npm run dev      # 开发模式
npm run dist     # 打包，输出到 release/
```

需要 Node.js ≥ 20。技术栈：Electron + Vue 3 + TypeScript + Tiptap + Fabric.js。

## 许可

[MIT](LICENSE)。本项目依赖均为 MIT / BSD / Apache 等宽松许可，感谢 Electron、Vue、Tiptap、Fabric.js 等开源项目。

## 维护

个人项目，不定期维护。Issue 与 PR 欢迎提出，但不保证及时回应。

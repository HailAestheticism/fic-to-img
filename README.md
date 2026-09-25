# 文转条图（fic-to-img）

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Platform](https://img.shields.io/badge/platform-Windows%2010%2B-lightgrey)
![Electron](https://img.shields.io/badge/Electron-37-47848F?logo=electron&logoColor=white)
![Vue 3](https://img.shields.io/badge/Vue-3-4FC08D?logo=vuedotjs&logoColor=white)

> 面向同人文作者的纯本地长文转条图工具：流式长文编辑，分章节排版，一键导出高清长图。

## 下载

前往 [Releases](https://github.com/HailAestheticism/fic-to-img/releases) 下载：

- `文转条图-Setup-x.y.z.exe`：安装版

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

# ArkiGo 维护说明

使用方法见 [SKILL.md](SKILL.md)。

## 目录

| 位置 | 用途 |
| --- | --- |
| `SKILL.md`、`references/` | 技能入口及按任务选读的指引 |
| `scripts/arkigo.mjs`、`scripts/commands/`、`scripts/lib/` | 命令入口、处理器和共享逻辑 |
| `scripts/page.mjs`、`assets/` | 离线页面生成器和浏览器资源 |
| `schemas/`、`tests/` | 文件协议与 core、page、browser、e2e 测试 |
| `LICENSE`、`package.json`、`package-lock.json` | 独立安装所需的授权和依赖信息 |

## 测试

在 `skills/arkigo/` 下运行。需要 Node.js 22 或以上。

```sh
npm ci
npx playwright install chromium webkit
npm test
```

## 手动安装

在仓库根目录运行，把 `<新目录>` 换成尚未创建的技能安装目录。

```sh
node skills/arkigo/scripts/arkigo.mjs install "<新目录>"
```

进入安装目录，执行安装器回执里的依赖安装命令，再检查版本。

```sh
npm ci --omit=dev --ignore-scripts --no-audit --no-fund
node scripts/arkigo.mjs version
```

`dependencies.ajv` 应为 `true`。之后，在用户项目内通过安装目录里的 `scripts/arkigo.mjs` 调用技能。

## 发布前

确认包清单和锁文件版本一致、两份许可证一致，并用临时目录验证 `install` 后的 `version`、`init`、`change` 和 `render`。运行全部测试。在仓库根检查自身设计的 `check` 和 `verify` 结果，以不带 `--editor` 的 `render` 生成离线示例。

# dsh-session-shred

为 DeepSeek Harness（DSH）增加「永久删除会话」功能。

- 在侧边栏每个会话的「…」菜单里新增一项 **永久删除**（排在「归档」之后）。
- 点击后弹出**应用内确认弹窗**一次；确认后从磁盘上 **彻底删除** 该会话的对话日志，**不可找回**。
- 删除范围：会话的持久化对话日志（`session.jsonl.zstd` / `session.v4.jsonl.zstd`），并把该会话从归档集合里移除。
- 保护：**运行中**（正在生成回复）的会话、以及**当前正在查看**的会话都会被拒绝删除，避免损坏运行状态或误删。

## 物理数据位置

删除操作删除 DSH 数据根目录（默认 `~/.dsh`）下该会话的整个日志目录：

```
~/.dsh/sessions/<工作区目录名>/session-<uuid>/
```

> 会话的投影缓存（`~/.dsh/storages/session_projcache/` 下的派生标题/统计元数据）目前**不删除**：直接删 per-session 文件会让存储域索引（`session_projcache.json`）残留不一致条目。它是派生数据，不会让会话重新出现，也不影响使用。

## 安装（本地 profile）

本插件通过宿主端 `connection.fetch.register` 注册的自定义端点（`/api/dsh-session-shred/delete`）与浏览器端通信，不依赖任何额外依赖，仅需 `@deepseek-ai/cordis` 作为 peer 依赖（DSH 自带）。

### 方式 A：脚本安装（推荐）

```powershell
# 在插件目录下运行（会把插件安装到 desktop 与 web 两个 profile 并加入 bundle）
powershell -ExecutionPolicy Bypass -File install.ps1
```

装完后 **重启 DSH**（网页端刷新页面、桌面端重启应用）即可生效。

### 方式 B：手动安装

1. 把本目录放到一个稳定位置（例如 `C:\Users\<你>\.dsh\local-plugins\dsh-session-shred`）。
2. 对每个 profile（`~/.dsh/profiles/desktop` 与 `~/.dsh/profiles/web`）执行：

   ```powershell
   cd ~/.dsh/profiles/<profile>
   pnpm add file:<插件绝对路径>
   ```

3. 编辑该 profile 的 `package.json`，在 `dsh.profile.bundles` 数组末尾追加 `"dsh-session-shred"`。
4. 重启 DSH。

## 说明

- 会话列表的「归档」是 DSH 自带的软删除（文件仍在磁盘上）；本插件的「永久删除」才会真正删除文件。
- 由于没有回收站，删除后无法找回，请谨慎操作（插件已内置一次确认弹窗）。

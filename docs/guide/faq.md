# 常见问题

## Ollama 配置问题

### 如何解决 Ollama 403 跨域访问问题？

 [Ollama 默认禁用跨域访问](https://github.com/ollama/ollama/issues/669)，需要特殊配置才能在浏览器扩展中使用。按系统进行如下“通配符 * 快速修复”配置即可。

 - macOS：在终端执行下面指令，允许跨域：
   ```bash
   launchctl setenv OLLAMA_ORIGINS "*"
   ```
   然后使用以下命令启动 App：
   ```bash
   OLLAMA_ORIGINS="*" ollama serve
   ```
   
 - Windows：打开系统环境变量（用户变量）新建 2 个变量，然后启动 App：
   - 变量名：`OLLAMA_HOST`，变量值：`0.0.0.0`
   - 变量名：`OLLAMA_ORIGINS`，变量值：`*`

   ```bash
   OLLAMA_ORIGINS="*" ollama serve
   ```

 - Linux：直接命令行启动。
   ```bash
   OLLAMA_ORIGINS="*" ollama serve
   ```

#### 配置验证

配置完成后，你可以通过以下方式验证配置是否生效：

1. **查看启动日志**：启动 Ollama 后，在控制台日志中应该能看到类似信息：
```
OLLAMA_ORIGINS:[... * ...]
```
或
```
OLLAMA_ORIGINS:[... chrome-extension://* ...]
```

2. **测试 API 连通性**：在终端中测试 API 是否可访问：
```bash
curl -X POST http://localhost:11434/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model": "your-model-name", "messages": [{"role": "user", "content": "Hello"}], "stream": false}'
```

### 正确的 Ollama 接口地址

使用 Ollama 时，请确保在 FluentRead 插件设置中使用正确的接口地址：

```
http://localhost:11434/v1/chat/completions
```

### 故障排除

如果仍然遇到 403 错误，请按以下步骤排查：

1. **确认环境变量设置**：
   - macOS: 执行 `launchctl getenv OLLAMA_ORIGINS` 查看是否设置成功
   - Windows: 在命令提示符中执行 `echo %OLLAMA_ORIGINS%` 查看环境变量
   - Linux: 执行 `echo $OLLAMA_ORIGINS` 查看环境变量

2. **完全重启 Ollama**：
   - 完全退出 Ollama 应用
   - 等待几秒钟
   - 重新启动 Ollama

3. **检查插件配置**：
   - 翻译服务选择："⭐自定义⭐️"
   - API 地址：`http://localhost:11434/v1/chat/completions`
   - Token：可设置为任意值（例如：`test`）
   - 模型：确保使用本地已安装的模型名称

4. **查看浏览器控制台**：
   - 打开浏览器开发者工具（F12）
   - 查看 Console 和 Network 标签页中的错误信息

::: tip 提示
如果遇到连接问题，请确保：
1. Ollama 服务已正常启动
2. 已正确配置跨域访问，并在日志中确认生效
3. 接口地址完全正确，包括 `/v1/chat/completions` 路径
4. 本地已安装了相应的模型（可通过 `ollama list` 查看已安装模型）
::: 
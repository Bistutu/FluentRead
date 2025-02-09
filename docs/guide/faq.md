# 常见问题

## Ollama 配置问题

### 如何解决 Ollama 403 跨域访问问题？

[Ollama 默认禁用跨域访问](https://github.com/ollama/ollama/issues/669)，需要特殊配置才能在浏览器扩展中使用。以下是不同系统的解决方案：

#### 方案一：使用特殊启动命令

直接使用以下命令启动 Ollama，允许跨域访问：

```bash
OLLAMA_ORIGINS=chrome-extension://* ollama serve
```

#### 方案二：配置环境变量

通过设置环境变量，允许跨域访问。

##### macOS 配置步骤

1. 打开终端，执行以下命令：
```bash
launchctl setenv OLLAMA_ORIGINS "chrome-extension://*"
```
2. 重启 Ollama 应用

##### Linux 配置步骤

1. 编辑 systemd 服务配置：
```bash
systemctl edit ollama.service
```

2. 在 [Service] 部分添加：
```ini
[Service]
Environment="OLLAMA_ORIGINS=chrome-extension://*"
```

3. 重启服务：
```bash
systemctl daemon-reload
systemctl restart ollama
```

##### Windows 配置步骤

1. 打开系统环境变量设置
   - Windows 11：在"设置"中搜索"环境变量"
   - Windows 10：通过"控制面板" → "系统" → "高级系统设置" → "环境变量"

2. 添加新的环境变量：
   - 变量名：`OLLAMA_ORIGINS`
   - 变量值：`chrome-extension://*`

3. 保存设置并重启 Ollama

### 正确的 Ollama 接口地址

使用 Ollama 时，请确保在插件设置中使用正确的接口地址：

```
http://localhost:11434/v1/chat/completions
```

::: tip 提示
如果遇到连接问题，请确保：
1. Ollama 服务已正常启动
2. 已正确配置跨域访问
3. 接口地址完全正确，包括 `/v1/chat/completions` 路径
::: 
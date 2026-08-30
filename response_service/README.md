# OCS Responses AI 题库服务

这个目录是可供原版 OCS 直接使用的独立 HTTP 题库服务。它只依赖原版 OCS 题库协议保证提供的 `title`、`options` 和 `type`，调用 OpenAI Responses 兼容接口，并把答案转换成原版 OCS 能匹配和填写的字符串。

浏览器中只保存服务访问令牌；OpenAI API Key、模型和思考强度都留在服务器。

服务端仍能识别旧修改版提交的扩展字段，但这些字段不再是运行前提。原版 OCS 不会传材料层级、独立选项数组、下划线标记等 DOM 关系，因此这类信息无法可靠恢复；服务端不会假装它们存在。

## 1. 安装

在服务器克隆本仓库后，从仓库根目录执行：

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -U pip
python -m pip install -r response_service/requirements.txt
cp response_service/.env.example response_service/.env
```

编辑 `response_service/.env`：

```env
OPENAI_BASE_URL=https://api.openai.com
OPENAI_API_KEY=sk-your-key
OPENAI_MODEL=gpt-5.6-sol
OPENAI_REASONING_EFFORT=xhigh

SERVICE_ACCESS_TOKEN=change-this-to-a-long-random-value

REQUEST_TIMEOUT_SECONDS=170
IMAGE_TIMEOUT_SECONDS=30
MAX_IMAGES=24
MAX_IMAGE_BYTES=12582912
ANSWER_SEPARATOR=#
REQUIRE_DECLARED_IMAGES=true
```

`OPENAI_BASE_URL` 必须支持 Responses API。可以填写站点根地址、以 `/v1` 结尾的地址或完整的 `/v1/responses` 地址。

## 2. 运行

继续在仓库根目录执行：

```bash
source .venv/bin/activate
uvicorn response_service.app:app \
  --host 0.0.0.0 \
  --port 8000 \
  --env-file response_service/.env
```

上面的反斜杠续行写法适用于 Linux Bash。Windows PowerShell 请使用单行命令：

```powershell
.\.venv\Scripts\python.exe -m uvicorn response_service.app:app --host 0.0.0.0 --port 8000 --env-file response_service\.env
```

Windows 也可以直接使用配套批处理：

```powershell
.\response_service\install.bat
notepad .\response_service\.env
.\response_service\start.bat
```

`install.bat` 会创建 `.venv`、安装依赖，并只在 `.env` 不存在时从示例复制一份；不会覆盖已经填写的密钥。`start.bat` 会从仓库根目录启动服务。

检查服务：

```bash
curl http://127.0.0.1:8000/health
```

公网部署请设置 `SERVICE_ACCESS_TOKEN`，并在 Nginx 或其他反向代理上启用 HTTPS。原版 OCS 会把题目中图片的 URL 混入题干或选项文本，服务端会尝试下载并转为 Responses 图片输入；受登录态保护、已过期或防盗链拦截的 URL 仍可能无法读取。

## 3. Nginx 示例

```nginx
server {
    listen 443 ssl;
    server_name answer.example.com;

    client_max_body_size 8m;
    proxy_connect_timeout 30s;
    proxy_send_timeout 190s;
    proxy_read_timeout 190s;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

## 4. 配置原版 OCS

使用 `ocsjs/ocsjs` 发布的原版 OCS，无需安装或修改本仓库的用户脚本。进入 `OCS → 通用 → 全局设置 → 题库配置`，复制 `response_service/ocs-answerer-wrapper.json.example` 的完整内容，并替换：

- `https://your-service.example.com`：你的题库服务域名；
- `change-me`：与服务器 `SERVICE_ACCESS_TOKEN` 完全相同的值。

配置中的请求数据只有三个原版字段：

```json
{
  "title": "${title}",
  "options": "${options}",
  "type": "${type}"
}
```

原版 OCS 当前会把超星的单选、多选、判断和各种主观题归一为 `single`、`multiple`、`judgement`、`completion`，并对 `line`、`fill`、`reader` 保留自己的顺序回填逻辑。服务端相应返回：

- 单选：模型选择 `A` 后，服务端返回 A 对应的原始选项文本；
- 多选：模型选择 `A#C` 后，服务端返回两个原始选项文本并用 `#` 连接；
- 判断：`正确` 或 `错误`；
- 一个主观作答区：直接返回正文；
- 多空、连线、完形和阅读：按页面顺序用 `#` 连接。

原版没有传出来的下划线、挖空样式、共用选项对应关系和复合材料层级无法由服务端补造，遇到这些题以原版 OCS 自身能提取和回填的内容为准。

高级设置建议：

- 原版 OCS 的“搜题最大耗时”设为界面允许的最大值 `180` 秒，服务端 `REQUEST_TIMEOUT_SECONDS` 建议设为 `170`，给网络和响应解析留出余量；
- 线程数量：`sol + xhigh` 先使用 `1`，确认 API 并发限制后再提高；
- 答案分隔符保留默认值，其中必须包含 `#`；
- 初次测试选择“不保存也不提交”。

只启用这一份 Responses AI 题库配置，避免 OCS 同时请求多个 AI 题库。

## 5. 兼容范围

本适配以 `ocsjs/ocsjs` 的 `upstream/4.0` 原版 `defaultAnswerWrapperHandler` 为准，不要求客户端出现 `option_items`、`material`、`subquestions`、`images` 等修改版字段。只要原版继续支持 AnswererWrapper 的 `title/options/type` 环境和 `[题目, 答案]` 返回值，这份配置就能直接使用。

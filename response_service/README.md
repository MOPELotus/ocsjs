# OCS Responses AI 题库服务

这个目录是 MOPELotus OCS 修改版配套的独立 HTTP 题库服务。它接收 OCS 传来的题干、独立选项和图片地址，调用 OpenAI Responses 兼容接口，并返回 OCS 可以直接填写的答案。

浏览器中只保存服务访问令牌；OpenAI API Key、模型和思考强度都留在服务器。

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
OPENAI_MODEL=gpt-5.2
OPENAI_REASONING_EFFORT=medium

SERVICE_ACCESS_TOKEN=change-this-to-a-long-random-value

REQUEST_TIMEOUT_SECONDS=180
IMAGE_TIMEOUT_SECONDS=20
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

检查服务：

```bash
curl http://127.0.0.1:8000/health
```

公网部署请设置 `SERVICE_ACCESS_TOKEN`，并在 Nginx 或其他反向代理上启用 HTTPS。普通模式由服务器下载题目图片，因此目前不需要浏览器 Base64 取图配置。

## 3. Nginx 示例

```nginx
server {
    listen 443 ssl;
    server_name answer.example.com;

    client_max_body_size 8m;
    proxy_read_timeout 180s;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

## 4. 配置 OCS

先安装本仓库构建的全域名修改版：

```text
https://raw.githubusercontent.com/MOPELotus/ocsjs/dist/ocs.common.user.js
```

然后进入 `OCS → 通用 → 全局设置 → 题库配置`，复制 `response_service/ocs-answerer-wrapper.json.example` 的完整内容，并替换：

- `https://your-service.example.com`：你的题库服务域名；
- `change-me`：与服务器 `SERVICE_ACCESS_TOKEN` 完全相同的值。

高级设置建议：

- 搜题最大耗时：`180` 秒；
- 线程数量：先使用 `1`；
- 答案分隔符保留默认值，其中必须包含 `#`；
- 初次测试选择“不保存也不提交”。

只启用这一份 Responses AI 题库配置，避免 OCS 同时请求多个 AI 题库。

## 5. 修改版与上游更新

修改版直接维护在本 fork 的 `4.0` 分支。GitHub Action 会定期合并 `ocsjs/ocsjs` 的 `4.0` 分支，运行后端测试，构建全域名脚本，并发布到 `dist` 分支。

脚本的 `updateURL` 和 `downloadURL` 都指向本 fork，不会自动切回官方未修改版。上游变更产生合并冲突或破坏修改逻辑时，Action 会失败并保留上一次可用构建。

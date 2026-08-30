from __future__ import annotations

import base64
import binascii
import json
import mimetypes
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

import httpx

from .config import Settings

URL_PATTERN = re.compile(r"https?://[^\s<>\"'\])}，。；;]+", re.IGNORECASE)
BLANK_PATTERN = re.compile(r"([\(（\[])[ \t\xa0]{2,}([\)）\]])|(?:_{3,}|＿{2,}|﹍{2,})")
IMAGE_DATA_PATTERN = re.compile(
    r"^data:(image/[a-z0-9.+-]+);base64,([a-z0-9+/=\r\n]+)$", re.IGNORECASE
)

_EXTENDED_OCS_FIELDS = {
    "option_items",
    "images",
    "attachments",
    "material",
    "subquestions",
    "shared_options",
    "matching_groups",
    "native_type",
    "blank_count",
    "underline_count",
}

_QUESTION_TYPE_ALIASES = {
    "singlechoice": "single",
    "single_choice": "single",
    "单选": "single",
    "单选题": "single",
    "multiplechoice": "multiple",
    "multiple_choice": "multiple",
    "多选": "multiple",
    "多选题": "multiple",
    "judgment": "judgement",
    "truefalse": "judgement",
    "true_false": "judgement",
    "判断": "judgement",
    "判断题": "judgement",
    "fillblank": "completion",
    "fill_blank": "completion",
    "填空": "completion",
    "填空题": "completion",
    "简答": "completion",
    "简答题": "completion",
}

_CORRECT_WORDS = {"true", "t", "yes", "1", "对", "是", "正确", "√"}
_INCORRECT_WORDS = {"false", "f", "no", "0", "错", "否", "错误", "×", "x"}


def _sniff_image_mime(content: bytes) -> str:
    if content.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if content.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if content.startswith((b"GIF87a", b"GIF89a")):
        return "image/gif"
    if content.startswith(b"RIFF") and content[8:12] == b"WEBP":
        return "image/webp"
    if content.startswith(b"BM"):
        return "image/bmp"
    return ""


class ImagePreparationError(RuntimeError):
    pass


@dataclass(frozen=True)
class Attachment:
    label: str
    source_url: str = ""
    data_url: str = ""


@dataclass(frozen=True)
class NormalizedQuestion:
    question_type: str
    title: str
    options: tuple[str, ...]
    attachments: tuple[Attachment, ...]
    context: Mapping[str, Any]
    standard_ocs: bool


def _option_label(index: int) -> str:
    if index < 26:
        return chr(65 + index)
    return str(index + 1)


def _split_options(value: Any) -> list[str]:
    if isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
        return [str(item).strip() for item in value if str(item).strip()]
    text = str(value or "").replace("\r\n", "\n").replace("\r", "\n")
    return [line.strip() for line in text.split("\n") if line.strip()]


def _normalize_blanks(value: str) -> str:
    existing = [int(item) for item in re.findall(r"\[BLANK_(\d+)\]", value, re.IGNORECASE)]
    counter = max(existing, default=0)

    def replace(match: re.Match[str]) -> str:
        nonlocal counter
        counter += 1
        marker = f"[BLANK_{counter}]"
        if match.group(1):
            return f"{match.group(1)}{marker}{match.group(2)}"
        return marker

    return BLANK_PATTERN.sub(replace, value)


def _normalize_question_type(value: Any, options: Sequence[str]) -> str:
    raw_type = str(value or "").strip().casefold()
    raw_type = _QUESTION_TYPE_ALIASES.get(raw_type, raw_type)
    if raw_type not in {"", "unknown", "undefined", "null", "none"}:
        return raw_type

    if options:
        normalized_options = {
            re.sub(r"[\s、,，;；:：.．()（）]", "", option).casefold()
            for option in options
        }
        judgement_words = _CORRECT_WORDS | _INCORRECT_WORDS
        if len(options) == 2 and normalized_options.issubset(judgement_words):
            return "judgement"
        # 原版 OCS 的其它平台不一定都能稳定提供 type。保留一个不预设
        # 单选/多选的选择题类型，让模型按题意返回一个或多个选项字母。
        return "choice"
    return "completion"


def _incoming_attachments(value: Any) -> list[Attachment]:
    if not isinstance(value, Sequence) or isinstance(value, (str, bytes, bytearray)):
        return []
    result: list[Attachment] = []
    for index, item in enumerate(value):
        if isinstance(item, str):
            result.append(Attachment(label=f"未分类图片 {index + 1}", data_url=item if item.startswith("data:") else "", source_url=item if item.startswith("http") else ""))
            continue
        if not isinstance(item, Mapping):
            continue
        result.append(
            Attachment(
                label=str(item.get("label") or f"未分类图片 {index + 1}"),
                source_url=str(item.get("source_url") or item.get("url") or ""),
                data_url=str(item.get("data_url") or item.get("data") or ""),
            )
        )
    return result


def normalize_question(payload: Mapping[str, Any]) -> NormalizedQuestion:
    raw_title = str(payload.get("title") or "").strip()
    raw_options = _split_options(payload.get("option_items") or payload.get("options"))
    supplied = _incoming_attachments(payload.get("images") or payload.get("attachments"))

    discovered: list[Attachment] = []
    title_urls = URL_PATTERN.findall(raw_title)
    for index, url in enumerate(title_urls, 1):
        discovered.append(Attachment(label=f"题干/材料图片 {index}", source_url=url))
    for option_index, option in enumerate(raw_options):
        letter = _option_label(option_index)
        for image_index, url in enumerate(URL_PATTERN.findall(option), 1):
            discovered.append(Attachment(label=f"选项 {letter} 图片 {image_index}", source_url=url))

    context_keys = (
        "material",
        "subquestions",
        "shared_options",
        "matching_groups",
        "native_type",
        "blank_count",
        "underline_count",
    )
    raw_context = {key: payload.get(key) for key in context_keys if payload.get(key) not in (None, "", [], {})}

    def normalize_context(value: Any, scope: str) -> Any:
        if isinstance(value, Mapping):
            return {
                str(key): normalize_context(item, f"{scope}/{key}")
                for key, item in value.items()
            }
        if isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
            return [normalize_context(item, f"{scope} {index + 1}") for index, item in enumerate(value)]
        if not isinstance(value, str):
            return value
        urls = URL_PATTERN.findall(value)
        for index, url in enumerate(urls, 1):
            discovered.append(Attachment(label=f"{scope} 图片 {index}", source_url=url))
        url_index = 0

        def replace_url(_: re.Match[str]) -> str:
            nonlocal url_index
            url_index += 1
            return f"[{scope}图片 {url_index}]"

        return _normalize_blanks(URL_PATTERN.sub(replace_url, value))

    context = {key: normalize_context(value, key) for key, value in raw_context.items()}

    # Flat OCS options and structured subquestions may reference the same URL.
    # Send one image attachment with all semantic labels instead of downloading
    # and billing the same image twice.
    deduplicated: list[Attachment] = []
    discovered_by_url: dict[str, int] = {}
    for item in discovered:
        existing_index = discovered_by_url.get(item.source_url)
        if existing_index is None:
            discovered_by_url[item.source_url] = len(deduplicated)
            deduplicated.append(item)
            continue
        existing = deduplicated[existing_index]
        labels = list(dict.fromkeys([*existing.label.split("；"), item.label]))
        deduplicated[existing_index] = Attachment(label="；".join(labels), source_url=item.source_url)
    discovered = deduplicated

    supplied_by_url: dict[str, list[Attachment]] = {}
    for item in supplied:
        if item.source_url:
            supplied_by_url.setdefault(item.source_url, []).append(item)

    attachments: list[Attachment] = []
    used_supplied: set[int] = set()
    for discovered_item in discovered:
        matching = supplied_by_url.get(discovered_item.source_url, [])
        supplied_item = next((item for item in matching if id(item) not in used_supplied), None)
        if supplied_item is not None:
            used_supplied.add(id(supplied_item))
            attachments.append(
                Attachment(
                    label=discovered_item.label,
                    source_url=discovered_item.source_url,
                    data_url=supplied_item.data_url,
                )
            )
        else:
            attachments.append(discovered_item)
    attachments.extend(item for item in supplied if id(item) not in used_supplied)

    def mark_urls(text: str, scope: str) -> str:
        index = 0

        def replace(_: re.Match[str]) -> str:
            nonlocal index
            index += 1
            return f"[{scope}图片 {index}]"

        return URL_PATTERN.sub(replace, text)

    title = _normalize_blanks(mark_urls(raw_title, "题干/材料"))
    options = tuple(
        _normalize_blanks(mark_urls(option, f"选项 {_option_label(index)} "))
        for index, option in enumerate(raw_options)
    )
    standard_ocs = not any(
        key in payload and payload.get(key) not in (None, "", [], {})
        for key in _EXTENDED_OCS_FIELDS
    )
    return NormalizedQuestion(
        question_type=_normalize_question_type(
            payload.get("type") or payload.get("question_type"),
            options,
        ),
        title=title,
        options=options,
        attachments=tuple(attachments),
        context=context,
        standard_ocs=standard_ocs,
    )


class OCSResponseEngine:
    def __init__(self, settings: Settings, client: httpx.Client | None = None) -> None:
        self.settings = settings
        self._client = client

    def _validate_data_url(self, value: str) -> str:
        matched = IMAGE_DATA_PATTERN.match(value.strip())
        if not matched:
            raise ImagePreparationError("浏览器提交的图片不是有效的 image data URL")
        try:
            size = len(base64.b64decode(matched.group(2), validate=True))
        except (ValueError, binascii.Error) as error:
            raise ImagePreparationError("浏览器提交的图片 Base64 无效") from error
        if size > self.settings.max_image_bytes:
            raise ImagePreparationError(f"图片超过服务端大小限制（{size} bytes）")
        return value.strip()

    def _download_image(self, url: str) -> str:
        headers = {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36"
            ),
            "Referer": "https://p.ananas.chaoxing.com/",
        }
        client = self._client or httpx.Client(follow_redirects=True, timeout=self.settings.image_timeout_seconds)
        close_client = self._client is None
        try:
            response = client.get(url, headers=headers)
            response.raise_for_status()
            content_type = response.headers.get("content-type", "").split(";", 1)[0].strip().casefold()
            if not content_type.startswith("image/"):
                content_type = mimetypes.guess_type(url)[0] or ""
            if not content_type.startswith("image/"):
                content_type = _sniff_image_mime(response.content)
            if not content_type.startswith("image/"):
                raise ImagePreparationError(f"远端内容不是图片：{content_type or 'unknown'}")
            if len(response.content) > self.settings.max_image_bytes:
                raise ImagePreparationError(f"图片超过服务端大小限制（{len(response.content)} bytes）")
            return f"data:{content_type};base64,{base64.b64encode(response.content).decode('ascii')}"
        except httpx.HTTPError as error:
            raise ImagePreparationError(f"服务端无法读取图片 {url}: {error}") from error
        finally:
            if close_client:
                client.close()

    def _prepare_attachments(self, question: NormalizedQuestion) -> tuple[list[tuple[str, str]], list[str]]:
        prepared: list[tuple[str, str]] = []
        warnings: list[str] = []
        for attachment in question.attachments[: self.settings.max_images]:
            try:
                image = self._validate_data_url(attachment.data_url) if attachment.data_url else self._download_image(attachment.source_url)
                prepared.append((attachment.label, image))
            except ImagePreparationError as error:
                warnings.append(f"{attachment.label}: {error}")
        if question.attachments and not prepared and self.settings.require_declared_images:
            raise ImagePreparationError(
                "题目包含图片，但服务端没有拿到任何可读图片。请安装 OCS 异步取图补丁，让浏览器提交 data URL。"
            )
        return prepared, warnings

    def build_request(self, payload: Mapping[str, Any]) -> tuple[dict[str, Any], NormalizedQuestion, list[str]]:
        question = normalize_question(payload)
        prepared, warnings = self._prepare_attachments(question)
        explicit_blank_count = question.context.get("blank_count", 0)
        try:
            explicit_blank_count = int(explicit_blank_count)
        except (TypeError, ValueError):
            explicit_blank_count = 0
        blank_count = max(
            explicit_blank_count,
            len(re.findall(r"\[BLANK_\d+\]", question.title, re.IGNORECASE)),
        )
        completion_hint = (
            "填空题 answer 返回按 [BLANK_n] 顺序排列的字符串数组"
            if blank_count
            else "填空/主观题若只有一个作答区，answer 直接返回可填写正文；有多个作答区才返回顺序数组"
        )
        standard_shape_hint = {
            "single": "单选题 answer 返回选项字母，例如 A",
            "multiple": "多选题 answer 返回选项字母数组，例如 [\"A\", \"C\"]",
            "choice": "选择题按题意返回一个选项字母，或在多选时返回选项字母数组",
            "judgement": "判断题 answer 只返回 正确 或 错误",
            "completion": completion_hint,
            "line": "连线题 answer 返回按左侧项目顺序排列的一维字符串数组",
            "fill": "完形填空 answer 返回各小题选项字母的一维顺序数组",
            "reader": "阅读理解 answer 返回各小题答案的一维顺序数组；选择子题使用选项字母",
        }.get(question.question_type, "answer 只返回字符串或一维字符串数组")
        extended_shape_hint = {
            "single": "单选题 answer 返回选项字母，例如 A",
            "multiple": "多选题 answer 返回选项字母数组，例如 [\"A\", \"C\"]",
            "evaluation": "测评选择题 answer 返回选项字母数组，例如 [\"A\", \"C\"]",
            "judgement": "判断题 answer 只返回 正确 或 错误",
            "completion": completion_hint,
            "shortanswer": "简答、名词解释或论述题 answer 直接返回可填写正文",
            "calculation": "计算题 answer 直接返回可填写的计算过程和结果正文",
            "accounting": "分录题 answer 返回按作答区顺序排列的字符串数组",
            "writing": "写作题 answer 直接返回可填写正文",
            "other": completion_hint,
            "fill": "完形填空 answer 返回各小题选项字母的顺序数组",
            "cloze": "完形填空 answer 返回各小题选项字母的顺序数组",
            "line": "连线或匹配题 answer 返回按左侧项目顺序排列的右侧值数组",
            "matching": "连线或匹配题 answer 返回 pairs 数组，每项包含 left 和 right",
            "ordering": "排序题 answer 返回按正确顺序排列的选项字母或选项文本数组",
            "reader": "阅读理解 answer 按子题顺序返回答案数组；混合题型可返回带 answer 的对象数组",
            "reading": "阅读理解 answer 按子题顺序返回答案数组；混合题型可返回带 answer 的对象数组",
            "listening": "听力复合题 answer 按子题顺序返回答案数组；混合题型可返回带 answer 的对象数组",
            "shared_options": "共用选项题 answer 按子题顺序返回所选共用选项字母或文本数组",
            "composite": "资料/复合题 answer 按 subquestions 顺序返回答案数组，必须保留每个子题的答案结构",
            "poll": "投票题没有唯一知识答案，不要臆造；answer 返回空字符串",
            "oral": "口语题需要录音作答，answer 返回空字符串",
            "oral_evaluation": "口语测评需要录音作答，answer 返回空字符串",
        }.get(question.question_type, "按题目要求返回字符串、数组或保留对应关系的对象")
        if question.standard_ocs:
            instructions = (
                "你是原版 OCS 的课程题目答题服务。只输出 JSON 对象 "
                "{\"answer\": ..., \"confidence\": 0到1}，不要解释、不要 Markdown。"
                "原版 OCS 只提供题干、换行分隔的选项和基础题型，不要假设存在额外 DOM 结构。"
                "若服务端从题干或选项 URL 下载到了图片，必须依据附件前的题干/选项标签判断对应关系。"
                "answer 只能是字符串或一维字符串数组；不得返回嵌套对象。"
                f"{standard_shape_hint}。主观题 answer 只放可直接填写的正文。"
            )
        else:
            instructions = (
                "你是 OCS 的课程题目答题服务。只输出 JSON 对象 "
                "{\"answer\": ..., \"confidence\": 0到1}，不要解释、不要 Markdown。"
                "必须严格依据附件前的对应标签判断图片属于题干、材料还是某个选项。"
                "[BLANK_n] 表示第 n 个挖空，[UNDERLINE]...[/UNDERLINE] 表示原文下划线，答案必须保持顺序和对应关系。"
                f"{extended_shape_hint}。主观题 answer 只放可直接填写的正文。"
            )
        user_payload = {
            "question_type": question.question_type,
            "title": question.title,
            "options": [
                {"label": _option_label(index), "text": option}
                for index, option in enumerate(question.options)
            ],
        }
        user_payload.update(question.context)
        content: list[dict[str, Any]] = [
            {"type": "input_text", "text": json.dumps(user_payload, ensure_ascii=False)}
        ]
        for index, (label, image) in enumerate(prepared, 1):
            content.append(
                {
                    "type": "input_text",
                    "text": f"[附件 {index} 对应关系] {label}。紧随其后的图片只属于这个标签。",
                }
            )
            content.append({"type": "input_image", "image_url": image, "detail": "auto"})
        request = {
            "model": self.settings.openai_model,
            "instructions": instructions,
            "input": [{"role": "user", "content": content}],
            "reasoning": {"effort": self.settings.reasoning_effort},
            "text": {"format": {"type": "json_object"}},
            "store": False,
        }
        return request, question, warnings

    @staticmethod
    def _parse_response(body: Mapping[str, Any]) -> tuple[Any, float]:
        text = body.get("output_text")
        if not isinstance(text, str):
            for item in body.get("output", []) if isinstance(body.get("output"), list) else []:
                if not isinstance(item, Mapping):
                    continue
                for child in item.get("content", []) if isinstance(item.get("content"), list) else []:
                    if isinstance(child, Mapping) and child.get("type") in {"output_text", "text"}:
                        text = child.get("text")
                        break
        if not isinstance(text, str) or not text.strip():
            raise RuntimeError("Responses 返回中没有文本答案")
        cleaned = text.strip()
        fenced = re.match(r"^```(?:json)?\s*(.*?)\s*```$", cleaned, re.IGNORECASE | re.DOTALL)
        if fenced:
            cleaned = fenced.group(1).strip()
        decoded = json.loads(cleaned)
        if not isinstance(decoded, Mapping) or "answer" not in decoded:
            raise RuntimeError("Responses JSON 缺少 answer")
        confidence = decoded.get("confidence", 0.0)
        if isinstance(confidence, bool) or not isinstance(confidence, (int, float)):
            confidence = 0.0
        return decoded.get("answer"), max(0.0, min(1.0, float(confidence)))

    def format_ocs_answer(self, answer: Any, question: NormalizedQuestion) -> str:
        if question.standard_ocs:
            values: list[str] = []

            def flatten(value: Any) -> None:
                if value is None:
                    return
                if isinstance(value, Mapping):
                    if "pairs" in value:
                        flatten(value["pairs"])
                        return
                    for key in ("answer", "options", "text", "right", "value", "option", "content"):
                        if key in value:
                            flatten(value[key])
                            return
                    for item in value.values():
                        flatten(item)
                    return
                if isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
                    for item in value:
                        flatten(item)
                    return
                text_value = str(value).strip()
                if text_value:
                    values.append(text_value)

            flatten(answer)
            answer = self.settings.answer_separator.join(values)

        compound_types = {"reader", "reading", "listening", "composite"}
        if isinstance(answer, Mapping):
            if "options" in answer:
                answer = answer["options"]
            elif "text" in answer:
                answer = answer["text"]
            elif question.question_type in {"line", "matching"} and "pairs" in answer:
                answer = answer["pairs"]
            elif question.question_type in {"line", "matching"}:
                answer = list(answer.values())
            elif question.question_type in compound_types:
                return json.dumps(answer, ensure_ascii=False, separators=(",", ":"))
            else:
                return json.dumps(answer, ensure_ascii=False, separators=(",", ":"))
        if isinstance(answer, Sequence) and not isinstance(answer, (str, bytes, bytearray)):
            if question.question_type in compound_types and any(
                isinstance(item, Mapping)
                or (isinstance(item, Sequence) and not isinstance(item, (str, bytes, bytearray)))
                for item in answer
            ):
                return json.dumps(answer, ensure_ascii=False, separators=(",", ":"))
            values: list[str] = []
            for item in answer:
                if isinstance(item, Mapping):
                    value = item.get("right") or item.get("answer") or item.get("value") or item.get("option")
                    if value is None and len(item) == 1:
                        value = next(iter(item.values()))
                else:
                    value = item
                if str(value or "").strip():
                    values.append(str(value).strip())
            return self.settings.answer_separator.join(values)
        text = str(answer or "").strip()
        if question.question_type == "single":
            matched = re.fullmatch(r"\s*([A-Z])(?:[.、:：)）])?\s*", text, re.IGNORECASE)
            if matched:
                return matched.group(1).upper()
        if question.question_type in {"multiple", "evaluation", "choice"}:
            letters = re.findall(r"[A-Z]", text.upper())
            if letters and re.fullmatch(r"[\sA-Z,，、#;；|]+", text.upper()):
                return self.settings.answer_separator.join(dict.fromkeys(letters))
        if question.question_type in {"fill", "reader", "line"}:
            letters = re.findall(r"[A-Z]", text.upper())
            if letters and re.fullmatch(r"[\sA-Z,，、#;；|]+", text.upper()):
                return self.settings.answer_separator.join(letters)
        if question.question_type == "judgement":
            lowered = text.casefold()
            if lowered in {"true", "t", "yes", "1", "对", "是", "正确", "√"}:
                return "正确"
            if lowered in {"false", "f", "no", "0", "错", "否", "错误", "×", "x"}:
                return "错误"
        return text

    def answer(self, payload: Mapping[str, Any]) -> dict[str, Any]:
        self.settings.validate_ai()
        request, question, warnings = self.build_request(payload)
        headers = {
            "Authorization": f"Bearer {self.settings.openai_api_key}",
            "Content-Type": "application/json",
        }
        client = self._client or httpx.Client(timeout=self.settings.request_timeout_seconds)
        close_client = self._client is None
        try:
            try:
                response = client.post(self.settings.responses_url, headers=headers, json=request)
                response.raise_for_status()
            except httpx.HTTPStatusError as error:
                response_text = error.response.text.strip()
                if len(response_text) > 2000:
                    response_text = response_text[:2000] + "..."
                detail = response_text or error.response.reason_phrase or "empty response"
                raise RuntimeError(
                    f"上游 Responses 返回 HTTP {error.response.status_code}：{detail}"
                ) from error
            except httpx.HTTPError as error:
                raise RuntimeError(f"无法连接上游 Responses：{error}") from error

            try:
                response_body = response.json()
            except ValueError as error:
                preview = response.text.strip()[:2000]
                raise RuntimeError(f"上游 Responses 返回的不是有效 JSON：{preview or 'empty response'}") from error

            try:
                raw_answer, confidence = self._parse_response(response_body)
            except json.JSONDecodeError as error:
                raise RuntimeError(f"Responses 答案不是有效 JSON：{error}") from error
        finally:
            if close_client:
                client.close()
        answer = self.format_ocs_answer(raw_answer, question)
        if not answer:
            raise RuntimeError("AI 返回了空答案")
        return {
            "question": str(payload.get("title") or ""),
            "answer": answer,
            "confidence": confidence,
            "model": self.settings.openai_model,
            "warnings": warnings,
        }

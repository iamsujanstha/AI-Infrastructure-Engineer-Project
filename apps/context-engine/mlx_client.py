"""Bounded client for a locally hosted MLX-LM OpenAI-compatible endpoint."""
import json
import os
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime

MAX_PROMPT_CHARACTERS = 32_000
MAX_HISTORY_MESSAGES = 100
MAX_RESPONSE_BYTES = 2 * 1024 * 1024
DEFAULT_TIMEOUT_SECONDS = 180
DEFAULT_MAX_OUTPUT_TOKENS = 512
DEFAULT_CONTEXT_WINDOW_TOKENS = 8192
DEFAULT_MODEL = "mlx-community/Qwen3-8B-4bit"
CHAT_TEMPLATE_TOKEN_RESERVE = 256


@dataclass(frozen=True)
class GenerationResult:
    text: str
    prompt_token_estimate: int
    reserved_output_tokens: int
    context_window_tokens: int


class MlxConfigurationError(ValueError):
    """The local MLX endpoint or request limits are invalid."""


class MlxRequestError(RuntimeError):
    """The local inference request failed or returned an invalid response."""


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, new_url):
        return None


def _loopback_endpoint(value):
    try:
        parsed = urllib.parse.urlsplit(value)
        port = parsed.port
        is_loopback = parsed.hostname == "localhost" or (
            parsed.hostname is not None and ip_address_is_loopback(parsed.hostname)
        )
    except (ValueError, TypeError):
        is_loopback = False
        parsed = None
        port = None
    if (not is_loopback or parsed is None or parsed.scheme != "http" or port is None
            or parsed.username is not None or parsed.password is not None
            or parsed.query or parsed.fragment or parsed.path not in {"", "/", "/v1"}):
        raise MlxConfigurationError("MLX_BASE_URL must be an HTTP loopback URL with an optional /v1 path.")
    return f"http://{parsed.netloc}/v1/chat/completions"


def ip_address_is_loopback(hostname):
    import ipaddress

    return ipaddress.ip_address(hostname).is_loopback


def _positive_integer(value, name, maximum):
    try:
        number = int(value)
    except (TypeError, ValueError) as error:
        raise MlxConfigurationError(f"{name} must be an integer.") from error
    if str(number) != str(value) or not 1 <= number <= maximum:
        raise MlxConfigurationError(f"{name} must be between 1 and {maximum}.")
    return number


def generate(prompt, *, history=None, base_url=None, model=None, timeout_seconds=None, max_output_tokens=None, context_window_tokens=None):
    """Generate one turn using validated prior turns; prompt contents are never logged."""
    if not isinstance(prompt, str) or not prompt.strip() or len(prompt) > MAX_PROMPT_CHARACTERS:
        raise MlxConfigurationError(f"Prompt must contain 1 to {MAX_PROMPT_CHARACTERS} characters.")
    prior_messages = history or []
    if (not isinstance(prior_messages, list) or len(prior_messages) > MAX_HISTORY_MESSAGES
            or len(prior_messages) % 2 != 0):
        raise MlxConfigurationError(f"Conversation history must contain up to {MAX_HISTORY_MESSAGES} complete user/assistant messages.")
    for index, message in enumerate(prior_messages):
        expected_role = "user" if index % 2 == 0 else "assistant"
        if (not isinstance(message, dict) or message.get("role") != expected_role
                or not isinstance(message.get("content"), str) or not message["content"].strip()):
            raise MlxConfigurationError("Conversation history contains an invalid message sequence.")
    endpoint = _loopback_endpoint(base_url or os.environ.get("MLX_BASE_URL", "http://127.0.0.1:8080"))
    selected_model = model if model is not None else os.environ.get("MLX_MODEL", DEFAULT_MODEL)
    if not isinstance(selected_model, str) or not selected_model.strip() or len(selected_model) > 250:
        raise MlxConfigurationError("Set MLX_MODEL to the model served by mlx_lm.server.")
    timeout = _positive_integer(
        timeout_seconds if timeout_seconds is not None else os.environ.get("MLX_TIMEOUT_SECONDS", DEFAULT_TIMEOUT_SECONDS),
        "MLX_TIMEOUT_SECONDS", 600,
    )
    output_limit = _positive_integer(
        max_output_tokens if max_output_tokens is not None else os.environ.get("MLX_MAX_OUTPUT_TOKENS", DEFAULT_MAX_OUTPUT_TOKENS),
        "MLX_MAX_OUTPUT_TOKENS", 4096,
    )
    context_window = _positive_integer(
        context_window_tokens if context_window_tokens is not None else os.environ.get(
            "MLX_CONTEXT_WINDOW_TOKENS", DEFAULT_CONTEXT_WINDOW_TOKENS,
        ),
        "MLX_CONTEXT_WINDOW_TOKENS", 1_000_000,
    )
    local_now = datetime.now().astimezone().isoformat(timespec="seconds")
    system_message = f"The current local date and time is {local_now}. Use this value for questions about the current date or time."
    messages = [
        {"role": "system", "content": system_message},
        *prior_messages,
        {"role": "user", "content": prompt},
    ]
    prompt_estimate = (
        sum(len(message["content"].encode("utf-8")) for message in messages)
        + CHAT_TEMPLATE_TOKEN_RESERVE
    )
    if prompt_estimate + output_limit > context_window:
        raise MlxConfigurationError(
            "Prompt estimate plus reserved output exceeds MLX_CONTEXT_WINDOW_TOKENS; shorten the prompt, clear earlier history, or adjust the configured model budget."
        )
    request_body = json.dumps({
        "model": selected_model.strip(),
        "messages": messages,
        "max_tokens": output_limit,
        "stream": False,
    }).encode("utf-8")
    request = urllib.request.Request(endpoint, data=request_body, headers={"Content-Type": "application/json"}, method="POST")
    try:
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), _NoRedirect())
        with opener.open(request, timeout=timeout) as response:
            body = response.read(MAX_RESPONSE_BYTES + 1)
    except (urllib.error.URLError, OSError) as error:
        raise MlxRequestError(
            "Local MLX inference is unavailable or timed out; start mlx_lm.server for the configured model and retry."
        ) from error
    if len(body) > MAX_RESPONSE_BYTES:
        raise MlxRequestError("Local MLX response exceeded the 2 MiB response limit.")
    try:
        payload = json.loads(body)
        content = payload["choices"][0]["message"]["content"]
    except (json.JSONDecodeError, KeyError, IndexError, TypeError) as error:
        raise MlxRequestError("Local MLX returned an invalid chat completion.") from error
    if not isinstance(content, str) or not content.strip():
        raise MlxRequestError("Local MLX returned no assistant text.")
    return GenerationResult(
        text=content,
        prompt_token_estimate=prompt_estimate,
        reserved_output_tokens=output_limit,
        context_window_tokens=context_window,
    )

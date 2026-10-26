"""Bounded compatibility candidates using official LangChain model adapters.

Construction never invokes a provider. Credentials stay in environment variables;
metadata contains fixed public configuration only. Rates are conservative budget
inputs, not provider invoices, and do not imply a model has passed a live probe.
"""
from copy import deepcopy
import os
from urllib.parse import urlsplit


_PROFILES = {
    "qwen-flash": {
        "provider": "dashscope", "harnessProvider": "openai", "model": "qwen3.8-flash", "adapter": "langchain_openai.ChatOpenAI",
        "modelEnv": "AGENT_MODEL",
        "apiKeyEnv": "DASHSCOPE_API_KEY", "baseUrlEnv": "AGENT_BASE_URL",
        "defaultBaseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "inputCnyPerMillion": 1.1, "outputCnyPerMillion": 3.5,
        "pricingBasis": "Conservative Qwen budget rates; actual account region/cache/free allowances and invoices remain separate.",
    },
    "qwen-plus": {
        "provider": "dashscope", "harnessProvider": "openai", "model": "qwen3.7-plus", "adapter": "langchain_openai.ChatOpenAI",
        "modelEnv": "QWEN_COMPARISON_MODEL",
        "apiKeyEnv": "DASHSCOPE_API_KEY", "baseUrlEnv": "AGENT_BASE_URL",
        "defaultBaseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "inputCnyPerMillion": 3.0, "outputCnyPerMillion": 12.0,
        "pricingBasis": "Upper budget rates for supported Beijing/Singapore endpoints and input below 256K tokens; not an invoice.",
    },
    "deepseek-flash": {
        "provider": "deepseek", "harnessProvider": "deepseek", "model": "deepseek-flash", "adapter": "langchain_deepseek.ChatDeepSeek",
        "modelEnv": "DEEPSEEK_FLASH_MODEL",
        "apiKeyEnv": "DEEPSEEK_API_KEY", "baseUrlEnv": "DEEPSEEK_BASE_URL",
        "defaultBaseUrl": "https://api.deepseek.com",
        "inputCnyPerMillion": 3.0, "outputCnyPerMillion": 12.0,
        "pricingBasis": "Conservative peak-rate budget converted at 10 CNY/USD; not actual FX or invoice.",
        "pricingSource": "https://api-docs.deepseek.com/quick_start/pricing/",
    },
    "deepseek-pro": {
        "provider": "deepseek", "harnessProvider": "deepseek", "model": "deepseek-v4-pro", "adapter": "langchain_deepseek.ChatDeepSeek",
        "modelEnv": "DEEPSEEK_PRO_MODEL",
        "apiKeyEnv": "DEEPSEEK_API_KEY", "baseUrlEnv": "DEEPSEEK_BASE_URL",
        "defaultBaseUrl": "https://api.deepseek.com",
        "inputCnyPerMillion": 13.2, "outputCnyPerMillion": 39.6,
        "pricingBasis": "Conservative peak-rate budget converted at 10 CNY/USD; not actual FX or invoice.",
        "pricingSource": "https://api-docs.deepseek.com/quick_start/pricing/",
    },
    "claude-reference": {
        "provider": "anthropic", "harnessProvider": "anthropic", "model": "claude-sonnet-5-5", "adapter": "langchain_anthropic.ChatAnthropic",
        "modelEnv": "ANTHROPIC_REFERENCE_MODEL",
        "apiKeyEnv": "ANTHROPIC_API_KEY", "baseUrlEnv": "ANTHROPIC_BASE_URL",
        "defaultBaseUrl": "https://api.anthropic.com",
        "inputCnyPerMillion": 25.0, "outputCnyPerMillion": 100.0,
        "pricingBasis": "Worst-case reference budget including prompt-cache write input at USD2.50/M, converted at 10 CNY/USD; not normal list price, actual FX or invoice.",
    },
}
PROFILE_NAMES = tuple(_PROFILES)


class CandidateConfigurationError(RuntimeError):
    """Stable safe code; never retain or print provider exception messages."""

    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


def metadata(name: str) -> dict:
    """Return public, detached profile metadata; never inspect credential values."""
    if name not in _PROFILES:
        raise CandidateConfigurationError("UNKNOWN_MODEL_PROFILE")
    return {"name": name, **deepcopy(_PROFILES[name]), "budgetRatesOnly": True,
            "streaming": True, "maxTokens": 5000, "timeoutSeconds": 75, "maxRetries": 0,
            "liveCompatibility": "Not Run by this module"}


def _configuration(name: str):
    profile = metadata(name)
    configured_model = os.getenv(profile["modelEnv"], "").strip()
    if configured_model and configured_model != profile["model"]:
        raise CandidateConfigurationError("MODEL_ID_MISMATCH")
    key = os.getenv(profile["apiKeyEnv"], "").strip()
    if not key:
        raise CandidateConfigurationError("MISSING_API_KEY")
    base = os.getenv(profile["baseUrlEnv"], "").strip() or profile["defaultBaseUrl"]
    try:
        url = urlsplit(base)
        valid = (url.scheme in {"https", "http"} and bool(url.hostname) and not url.username
                 and not url.password and not url.query and not url.fragment
                 and not any(character.isspace() for character in base))
        _ = url.port  # Validate an explicitly supplied port before creating a client.
    except ValueError:
        valid = False
    if not valid:
        raise CandidateConfigurationError("INVALID_BASE_URL")
    allowed_hosts = {
        "dashscope": {"dashscope.aliyuncs.com", "dashscope-intl.aliyuncs.com"},
        "deepseek": {"api.deepseek.com"},
        "anthropic": {"api.anthropic.com"},
    }
    if url.scheme != "https" or url.hostname.lower() not in allowed_hosts[profile["provider"]] or url.port not in (None, 443):
        raise CandidateConfigurationError("PRICE_ENDPOINT_UNVERIFIED")
    return profile, key, base


def build_candidate(name: str):
    """Construct exactly the requested official adapter; never silently fall back."""
    profile, key, base = _configuration(name)
    common = {"model": profile["model"], "api_key": key, "base_url": base,
              "streaming": True, "max_tokens": 5000, "timeout": 75, "max_retries": 0}
    try:
        if profile["provider"] == "dashscope":
            from langchain_openai import ChatOpenAI
            return ChatOpenAI(**common, use_responses_api=False, stream_usage=True, temperature=0.3,
                              extra_body={"enable_thinking": False})
        if profile["provider"] == "deepseek":
            from langchain_deepseek import ChatDeepSeek
            return ChatDeepSeek(**common, use_responses_api=False, stream_usage=True, temperature=0.3,
                                extra_body={"thinking": {"type": "disabled"}})
        from langchain_anthropic import ChatAnthropic
        # Sonnet 5.5 rejects temperature and forced tool_choice. Leave Anthropic
        # defaults intact; framework tool binding is validated by the live probe.
        return ChatAnthropic(**common)
    except ImportError:
        raise CandidateConfigurationError("ADAPTER_IMPORT_FAILED") from None
    except Exception:
        raise CandidateConfigurationError("MODEL_CONFIGURATION_FAILED") from None

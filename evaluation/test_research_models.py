"""Offline adapter configuration tests; these do not establish live model quality."""
import importlib.util
import json
import sys
from unittest.mock import patch

import pytest

from evaluation.research_models import (
    PROFILE_NAMES, CandidateConfigurationError, build_candidate, metadata,
)


@pytest.fixture(autouse=True)
def isolated_provider_configuration(monkeypatch):
    for key in ("DASHSCOPE_API_KEY", "DEEPSEEK_API_KEY", "ANTHROPIC_API_KEY"):
        monkeypatch.setenv(key, "offline-fixture-never-a-real-key")
    for name in PROFILE_NAMES:
        info = metadata(name)
        monkeypatch.setenv(info["baseUrlEnv"], info["defaultBaseUrl"])
        monkeypatch.setenv(info["modelEnv"], info["model"])
    # A generic OpenAI key must never replace a missing provider-specific key.
    monkeypatch.setenv("OPENAI_API_KEY", "unrelated-openai-fixture")


@pytest.mark.parametrize("name,model,adapter,input_rate,output_rate", [
    ("qwen-flash", "qwen3.8-flash", "langchain_openai.ChatOpenAI", 1.1, 3.5),
    ("qwen-plus", "qwen3.7-plus", "langchain_openai.ChatOpenAI", 3, 12),
    ("deepseek-flash", "deepseek-flash", "langchain_deepseek.ChatDeepSeek", 3, 12),
    ("deepseek-pro", "deepseek-v4-pro", "langchain_deepseek.ChatDeepSeek", 13.2, 39.6),
    ("claude-reference", "claude-sonnet-5-5", "langchain_anthropic.ChatAnthropic", 25, 100),
])
def test_fixed_public_metadata_matches_requested_candidates(name, model, adapter, input_rate, output_rate):
    info = metadata(name)
    assert info["model"] == model and info["adapter"] == adapter
    assert info["inputCnyPerMillion"] == input_rate and info["outputCnyPerMillion"] == output_rate
    assert info["budgetRatesOnly"] is True
    serialized = json.dumps(info)
    assert "offline-fixture-never-a-real-key" not in serialized
    assert "unrelated-openai-fixture" not in serialized
    assert "example.org" not in serialized  # Actual custom endpoints are also omitted.
    info["model"] = "local-mutation"
    assert metadata(name)["model"] == model


@pytest.mark.parametrize("name", ["qwen-flash", "qwen-plus"])
def test_qwen_uses_explicit_openai_adapter_configuration(name):
    from langchain_openai import ChatOpenAI
    model = build_candidate(name)
    assert type(model) is ChatOpenAI
    assert model.model_name == metadata(name)["model"]
    assert model.streaming is True and model.max_tokens == 5000 and model.request_timeout == 75
    assert model.max_retries == 0 and model.root_client.max_retries == 0 and model.root_async_client.max_retries == 0
    assert model.temperature == .3 and model.use_responses_api is False
    assert model.stream_usage is True
    assert model.extra_body == {"enable_thinking": False}
    assert model.openai_api_base == metadata(name)["defaultBaseUrl"]


@pytest.mark.parametrize("name", ["deepseek-flash", "deepseek-pro"])
def test_deepseek_uses_official_adapter_configuration(name):
    if importlib.util.find_spec("langchain_deepseek") is None:
        pytest.skip("Official langchain-deepseek installation pending; not a live fallback")
    from langchain_deepseek import ChatDeepSeek
    model = build_candidate(name)
    assert type(model) is ChatDeepSeek
    assert model.model_name == metadata(name)["model"]
    assert model.streaming is True and model.max_tokens == 5000 and model.request_timeout == 75
    assert model.max_retries == 0 and model.root_client.max_retries == 0 and model.root_async_client.max_retries == 0
    assert model.temperature == .3 and model.use_responses_api is False
    assert model.stream_usage is True
    assert model.extra_body == {"thinking": {"type": "disabled"}}


def test_claude_uses_official_defaults_without_temperature_or_forced_tool_flags():
    from langchain_anthropic import ChatAnthropic
    model = build_candidate("claude-reference")
    assert type(model) is ChatAnthropic
    assert model.model == "claude-sonnet-5-5"
    assert model.streaming is True and model.max_tokens == 5000 and model.default_request_timeout == 75
    assert model.max_retries == 0 and model.temperature is None
    assert not {"temperature", "tool_choice", "thinking", "use_responses_api"} & model.model_kwargs.keys()


@pytest.mark.parametrize("name", PROFILE_NAMES)
def test_missing_provider_key_never_uses_another_providers_key(name, monkeypatch):
    monkeypatch.delenv(metadata(name)["apiKeyEnv"])
    with pytest.raises(CandidateConfigurationError) as raised:
        build_candidate(name)
    assert raised.value.code == "MISSING_API_KEY"
    assert str(raised.value) == "MISSING_API_KEY"


def test_unknown_profile_is_rejected_without_echoing_untrusted_input():
    with pytest.raises(CandidateConfigurationError) as raised:
        build_candidate("secret-looking-unknown-input")
    assert raised.value.code == "UNKNOWN_MODEL_PROFILE"
    assert "secret-looking" not in str(raised.value)


@pytest.mark.parametrize("base", ["file:///tmp/key", "https://user:password@example.org/v1",
    "https://example.org/v1?api_key=private", "https://example.org/v1#private", "https://example.org:invalid/v1"])
def test_invalid_endpoint_configuration_has_safe_error_without_key_or_url(base, monkeypatch):
    monkeypatch.setenv("AGENT_BASE_URL", base)
    with pytest.raises(CandidateConfigurationError) as raised:
        build_candidate("qwen-flash")
    assert raised.value.code == "INVALID_BASE_URL"
    assert str(raised.value) == "INVALID_BASE_URL"


def test_adapter_constructor_error_is_sanitized_and_not_retried():
    with patch("langchain_openai.ChatOpenAI", side_effect=RuntimeError("DO_NOT_EXPOSE_SECRET")) as constructor:
        with pytest.raises(CandidateConfigurationError) as raised:
            build_candidate("qwen-flash")
        constructor.assert_called_once()
    assert raised.value.code == "MODEL_CONFIGURATION_FAILED"
    assert "DO_NOT_EXPOSE" not in str(raised.value)


def test_missing_official_adapter_is_reported_without_openai_fallback(monkeypatch):
    monkeypatch.setitem(sys.modules, "langchain_deepseek", None)
    with patch("langchain_openai.ChatOpenAI") as fallback:
        with pytest.raises(CandidateConfigurationError) as raised:
            build_candidate("deepseek-flash")
        fallback.assert_not_called()
    assert raised.value.code == "ADAPTER_IMPORT_FAILED"


@pytest.mark.parametrize("name,provider", [("qwen-flash", "openai"), ("qwen-plus", "openai"),
    ("deepseek-flash", "deepseek"), ("deepseek-pro", "deepseek"), ("claude-reference", "anthropic")])
def test_harness_provider_matches_official_adapter(name, provider):
    assert metadata(name)["harnessProvider"] == provider


@pytest.mark.parametrize("name", PROFILE_NAMES)
def test_configured_model_must_match_fixed_price_profile(name, monkeypatch):
    monkeypatch.setenv(metadata(name)["modelEnv"], "unverified-secret-looking-model")
    with pytest.raises(CandidateConfigurationError) as raised:
        build_candidate(name)
    assert raised.value.code == "MODEL_ID_MISMATCH"
    assert "secret-looking" not in str(raised.value)


@pytest.mark.parametrize("name,endpoint", [
    ("qwen-flash", "https://example.org/v1"),
    ("qwen-plus", "https://api.deepseek.com/v1"),
    ("qwen-flash", "http://dashscope.aliyuncs.com/compatible-mode/v1"),
    ("qwen-flash", "https://dashscope.aliyuncs.com:444/compatible-mode/v1"),
    ("deepseek-flash", "https://dashscope.aliyuncs.com/compatible-mode/v1"),
    ("deepseek-pro", "https://api.deepseek.com.untrusted.example/v1"),
    ("claude-reference", "https://api.anthropic.com.untrusted.example/v1"),
])
def test_unknown_price_endpoint_is_rejected_before_any_adapter_construction(name, endpoint, monkeypatch):
    monkeypatch.setenv(metadata(name)["baseUrlEnv"], endpoint)
    with patch("langchain_openai.ChatOpenAI") as openai_constructor, patch("langchain_anthropic.ChatAnthropic") as anthropic_constructor:
        with pytest.raises(CandidateConfigurationError) as raised:
            build_candidate(name)
        openai_constructor.assert_not_called()
        anthropic_constructor.assert_not_called()
    assert raised.value.code == "PRICE_ENDPOINT_UNVERIFIED"
    assert endpoint not in str(raised.value)


def test_supported_qwen_singapore_https_endpoint_keeps_fixed_model(monkeypatch):
    monkeypatch.setenv("AGENT_BASE_URL", "https://dashscope-intl.aliyuncs.com/compatible-mode/v1")
    model = build_candidate("qwen-plus")
    assert model.model_name == "qwen3.7-plus"
    assert model.openai_api_base == "https://dashscope-intl.aliyuncs.com/compatible-mode/v1"
    assert model.stream_usage is True

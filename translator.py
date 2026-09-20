import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml
from openai import AsyncOpenAI


@dataclass(slots=True)
class TranslationContext:
    text: str

    kind: str

    artist: str | None = None
    track_name: str | None = None
    album: str | None = None


class LLMTranslator:
    def __init__(
        self,
        *,
        base_url: str,
        api_key: str,
        model: str,
        target_language: str,
        style: str,
        timeout: float = 30,
        max_retries: int = 2,
        temperature: float | None = None,
        extra_headers: dict[str, str] | None = None,
    ):
        self.model = model
        self.target_language = target_language
        self.style = style
        self.temperature = temperature

        self.client = AsyncOpenAI(
            base_url=base_url,
            api_key=api_key,
            timeout=timeout,
            max_retries=max_retries,
            default_headers=extra_headers or {},
        )

    async def translate(
        self,
        context,
    ):
        params: dict[str, Any] = {
            "model": self.model,
            "messages": [
                {
                    "role": "system",
                    "content": self._system_prompt(),
                },
                {
                    "role": "user",
                    "content": self._user_prompt(context),
                },
            ],
        }

        if self.temperature is not None:
            params["temperature"] = self.temperature

        response = await self.client.chat.completions.create(
            **params
        )

        if not response.choices:
            raise RuntimeError(
                "LLM returned no choices"
            )

        content = response.choices[0].message.content

        if not content:
            raise RuntimeError(
                "LLM returned empty content"
            )

        return content.strip()

    def _system_prompt(self) -> str:
        return f"""
You localize spoken narration for a music DJ.

Target language:
{self.target_language}

The result will be sent directly to a text-to-speech
engine, so return only the final spoken narration.

Rules:

- Preserve the meaning and intent of the original.
- Produce natural spoken language, not a literal translation.
- Artist names must not be translated.
- Track names must not be translated.
- Album names must not be translated.
- When a protected name occurs in the original, preserve its
  spelling exactly as supplied in the metadata.
- Do not invent facts about artists, tracks, albums or the listener.
- Prefer idiomatic {self.target_language} over literal translation.
- Do not use Markdown.

Desired DJ style:

{self.style}
""".strip()

    def _user_prompt(
        self,
        context: TranslationContext,
    ) -> str:
        return f"""
Narration type: {context.kind}

Protected metadata:
Artist: {context.artist or ""}
Track: {context.track_name or ""}
Album: {context.album or ""}

Original narration:
{context.text}
""".strip()

def load_translator(
    path: str | Path = "config.yaml",
) -> tuple[LLMTranslator, set[str]]:
    raw = Path(path).read_text(
        encoding="utf-8"
    )

    raw = os.path.expandvars(raw)

    config = yaml.safe_load(raw)

    llm = config["llm"]
    translation = config["translation"]

    api_key = llm.get("api_key", "")

    if (
        not api_key
        or api_key.startswith("${")
    ):
        raise RuntimeError(
            "LLM API key is not configured"
        )

    translator = LLMTranslator(
        base_url=llm["base_url"],
        api_key=api_key,
        model=llm["model"],

        target_language=translation.get(
            "target_language",
            "Russian",
        ),

        style=translation.get(
            "style",
            "",
        ),

        timeout=llm.get(
            "timeout",
            30,
        ),

        max_retries=llm.get(
            "max_retries",
            2,
        ),

        temperature=llm.get(
            "temperature"
        ),

        extra_headers=llm.get(
            "extra_headers"
        ),
    )

    prefetch_kinds = set(
        translation.get(
            "prefetch_kinds",
            ["intro", "jump", "outro"],
        )
    )

    return translator, prefetch_kinds
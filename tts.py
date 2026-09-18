from dataclasses import dataclass
import os
import yaml
from pathlib import Path

import numpy as np
import soundfile as sf
import torch

from omnivoice import OmniVoice


@dataclass(slots=True)
class VoiceDesignConfig:
    instruct: str


@dataclass(slots=True)
class VoiceCloneConfig:
    ref_audio: str
    ref_text: str | None = None


class OmniVoiceTTS:
    def __init__(
        self,
        *,
        model_name: str,
        device: str,
        language: str,
        output_dir: str,
        mode: str,
        design: VoiceDesignConfig | None = None,
        clone: VoiceCloneConfig | None = None,
        num_steps: int = 32,
        speed: float = 1.0,
    ):
        self.language = language
        self.mode = mode

        self.design = design
        self.clone = clone

        self.num_steps = num_steps
        self.speed = speed

        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(
            parents=True,
            exist_ok=True,
        )

        print("[TTS] Loading OmniVoice...")

        self.model = OmniVoice.from_pretrained(
            model_name,
            device_map=device,
            dtype=torch.float16,
        )

        self.sampling_rate = (
            self.model.sampling_rate
        )

        self.voice_clone_prompt = None

        if mode == "clone":
            self._prepare_clone_voice()

        print(
            f"[TTS] OmniVoice ready "
            f"({self.sampling_rate} Hz)"
        )

    def _prepare_clone_voice(self):
        if self.clone is None:
            raise RuntimeError(
                "Clone mode requires clone config"
            )

        print(
            "[TTS] Preparing voice clone..."
        )

        self.voice_clone_prompt = (
            self.model.create_voice_clone_prompt(
                ref_audio=self.clone.ref_audio,
                ref_text=self.clone.ref_text,
            )
        )

        print(
            "[TTS] Voice clone ready"
        )

    def synthesize(
        self,
        *,
        text: str,
        output_path: str | Path,
    ) -> Path:
        output_path = Path(output_path)

        kwargs = {
            "text": text,
            "language": self.language,
            "num_step": self.num_steps,
            "speed": self.speed,
        }

        if self.mode == "design":
            if self.design is None:
                raise RuntimeError(
                    "Design mode requires "
                    "design config"
                )

            kwargs["instruct"] = (
                self.design.instruct
            )

        elif self.mode == "clone":
            if self.voice_clone_prompt is None:
                raise RuntimeError(
                    "Voice clone prompt "
                    "is not initialized"
                )

            kwargs["voice_clone_prompt"] = (
                self.voice_clone_prompt
            )

        else:
            raise RuntimeError(
                f"Unknown voice mode: {self.mode}"
            )

        audio: list[np.ndarray] = (
            self.model.generate(**kwargs)
        )

        sf.write(
            output_path,
            audio[0],
            self.sampling_rate,
        )

        return output_path\


def load_tts(
    path: str | Path = "config.yaml"):
    raw = Path(path).read_text(
        encoding="utf-8"
    )
    raw = os.path.expandvars(raw)
    config = yaml.safe_load(raw)
    llm = config["llm"]
    translation = config["translation"]
    api_key = llm.get("api_key", "")

    voice = config["voice"]
    tts_config = config["tts"]

    mode = voice["mode"]

    tts = OmniVoiceTTS(
        model_name=tts_config[
            "model"
        ],

        device=tts_config[
            "device"
        ],

        language=tts_config.get(
            "language",
            "ru",
        ),

        output_dir=tts_config.get(
            "output_dir",
            "./cache/audio",
        ),

        mode=mode,

        design=VoiceDesignConfig(
            instruct=voice[
                "design"
            ]["instruct"]
        )
        if mode == "design"
        else None,

        clone=VoiceCloneConfig(
            ref_audio=voice[
                "clone"
            ]["ref_audio"],

            ref_text=voice[
                "clone"
            ].get("ref_text"),
        )
        if mode == "clone"
        else None,

        num_steps=tts_config[
            "generation"
        ].get(
            "num_steps",
            32,
        ),

        speed=tts_config[
            "generation"
        ].get(
            "speed",
            1.0,
        ),
    )

    return tts
from tts import (
    OmniVoiceTTS,
    VoiceDesignConfig,
)


tts = OmniVoiceTTS(
    model_name="k2-fsa/OmniVoice",

    device="cuda:0",

    language="ru",

    output_dir="./cache/audio",

    mode="design",

    design=VoiceDesignConfig(
        instruct=(
            "male, young adult, "
            "low pitch"
        )
    ),
)


tts.synthesize(
    text=(
        "Дальше у меня есть пара треков, "
        "от которых ты просто такой: круто. "
        "The Strokes задают тон."
    ),

    output_path="test.wav",
)
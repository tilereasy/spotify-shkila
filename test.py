import asyncio

from translator import (
    TranslationContext,
    load_translator,
)


async def main():
    translator, _ = load_translator()

    result = await translator.translate(
        TranslationContext(
            kind="intro",

            artist="The Strokes",
            track_name="Happy Ending",
            album="Comedown Machine",

            text=(
                'Keeping it going. First, check out '
                '"Happy Ending", from The Strokes. '
                'Could be a fresh find for you.'
            ),
        )
    )

    print(result)


asyncio.run(main())
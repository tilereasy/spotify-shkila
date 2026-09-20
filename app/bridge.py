from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi import HTTPException

import asyncio

from pydantic import BaseModel

from typing import Any
from enum import Enum

from translator import (
    TranslationContext,
    load_translator
)

from tts import (load_tts)

from hashlib import sha256
from pathlib import Path

AUDIO_DIR = Path("cache/audio")

class SpotifyDJEvent(BaseModel):
    type: str
    timestamp: int
    data: dict[str, Any]

class Event(BaseModel):
    type: str
    timestamp: int
    data: dict[str, Any]

class NarrationStatus(str, Enum):
    PENDING = "pending"
    TRANSLATING = "translating"
    SYNTHESIZING = "synthesizing"
    READY = "ready"
    FAILED = "failed"

class Narration(BaseModel):
    key: str

    kind: str

    track_uri: str | None = None
    spotify_id: str | None = None

    track_name: str | None = None
    artist: str | None = None
    album: str | None = None

    segment: str | None = None

    decision_id: str | None = None
    commentary_id: str | None = None
    commentary_type: str | None = None

    ssml: str | None = None
    text: str

    translated_text: str | None = None

    status: NarrationStatus = NarrationStatus.PENDING
    error: str | None = None

    audio_path: str | None = None

narration_cache: dict[str, Narration] = {}

processing_queue: asyncio.Queue[str] = asyncio.Queue()

def audio_cache_path(
    narration_key: str,
) -> Path:
    digest = sha256(
        narration_key.encode("utf-8")
    ).hexdigest()

    return AUDIO_DIR / f"{digest}.wav"


async def narration_worker():
    print("[worker] started")

    while True:
        key = await processing_queue.get()

        narration = narration_cache.get(key)

        if narration is None:
            processing_queue.task_done()
            continue

        try:
            narration.status = (
                NarrationStatus.TRANSLATING
            )

            print(
                f"[TRANSLATING] "
                f"{narration.artist} — "
                f"{narration.track_name}"
            )

            narration.translated_text = (
                await translator.translate(
                    TranslationContext(
                        text=narration.text,
                        kind=narration.kind,

                        artist=narration.artist,
                        track_name=narration.track_name,
                        album=narration.album,
                    )
                )
            )

            print(
                "[TRANSLATED]",
                narration.translated_text,
            )

            narration.status = (
                NarrationStatus.SYNTHESIZING
            )

            output_path = (
                audio_cache_path(
                    narration.key
                )
            )

            print(
                f"[SYNTHESIZING] "
                f"{output_path}"
            )

            await asyncio.to_thread(
                tts.synthesize,

                text=narration.translated_text,
                output_path=output_path,
            )

            narration.audio_path = str(
                output_path
            )

            narration.status = (
                NarrationStatus.READY
            )

            print(
                f"[READY] {key}"
            )

        except Exception as error:
            narration.status = (
                NarrationStatus.FAILED
            )

            narration.error = str(error)

            print(
                f"[ERROR] {key}: {error}"
            )

        finally:
            processing_queue.task_done()



async def handle_prefetch(data: dict[str, Any]):
    key = data.get("key")

    if not key:
        print(
            "[PREFETCH] received without key"
        )
        return

    if key in narration_cache:
        print(
            f"[PREFETCH] already cached: {key}"
        )
        return

    

    narration = Narration(
        key=key,

        kind=data.get("kind", "unknown"),

        track_uri=data.get("trackUri"),
        spotify_id=data.get("spotifyId"),

        track_name=data.get("trackName"),
        artist=data.get("artist"),
        album=data.get("album"),

        segment=data.get("segment"),

        decision_id=data.get("decisionId"),
        commentary_id=data.get("commentaryId"),
        commentary_type=data.get(
            "commentaryType"
        ),

        ssml=data.get("ssml"),

        text=data.get("text", ""),
    )

    narration_cache[key] = narration

    

    print()
    print("=" * 60)
    print("[PREFETCH]")
    print("=" * 60)

    if narration.kind not in prefetch_kinds:
            print(
            f"[PREFETCH] skipping "
            f"{narration.kind}"
            )
            return


    print(
        f"{narration.artist} — "
        f"{narration.track_name}"
    )

    print(
        f"kind: {narration.kind}"
    )

    print(
        f"segment: {narration.segment}"
    )

    print(
        f"key: {narration.key}"
    )

    print()

    print(
        narration.text
    )
    
    await processing_queue.put(
        narration.key
    )



async def handle_start(data: dict[str, Any]):
    key = data.get(
        "matchedNarrationKey"
    )

    print()
    print("=" * 60)
    print("[START]")
    print("=" * 60)

    print(
        f'{data.get("artist")} — '
        f'{data.get("trackName")}'
    )

    print(
        f'kind: {data.get("kind")}'
    )

    print(
        f'match method: '
        f'{data.get("matchMethod")}'
    )

    if not key:
        print(
            "No matched narration key."
        )
        return

    narration = narration_cache.get(
        key
    )

    if narration is None:
        print(
            f"CACHE MISS: {key}"
        )
        return

    print(
        f"CACHE HIT: {key}"
    )

    print(
        f"status: {narration.status}"
    )

    if narration.status == NarrationStatus.READY:
        print()
        print("TRANSLATED:")
        print(
            narration.translated_text
        )

    elif narration.status == NarrationStatus.PROCESSING:
        print(
            "Translation is still processing!"
        )

    elif narration.status == NarrationStatus.FAILED:
        print(
            f"Translation failed: "
            f"{narration.error}"
        )



app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*", "https://xpui.app.spotify.com"],
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True
)

translator, prefetch_kinds = (
    load_translator("config.yaml")
)

tts = load_tts("config.yaml")




@app.on_event("startup")
async def startup():
    asyncio.create_task(
        narration_worker()
    )

@app.get("/health")
async def health():
    return {
        "status": "ok"
    }

@app.get("/narrations")
async def narrations():
    return list(
        narration_cache.values()
    )

@app.get("/narrations/{key}")
async def narration(key: str):
    return narration_cache.get(key)

@app.get("/narrations/{key}/audio")
async def narration_audio(key: str):
    narration = narration_cache.get(key)

    if narration is None:
        raise HTTPException(
            status_code=404,
            detail="Narration not found",
        )

    if narration.status != NarrationStatus.READY:
        raise HTTPException(
            status_code=409,
            detail=f"Narration is not ready: {narration.status}",
        )

    if not narration.audio_path:
        raise HTTPException(
            status_code=404,
            detail="Narration has no audio",
        )

    path = Path(narration.audio_path)

    if not path.is_file():
        raise HTTPException(
            status_code=404,
            detail="Audio file does not exist",
        )

    return FileResponse(
        path,
        media_type="audio/wav",
        headers={
            "Cache-Control": "no-store",
        },
    )

@app.get("/test-audio")
async def test_audio():
    return FileResponse(
        "test.wav",
        media_type="audio/wav",
    )






@app.post("/events")
async def events(event: Event):
    if event.type == "prefetch":
        await handle_prefetch(
            event.data
        )

    elif event.type == "start":
        await handle_start(
            event.data
        )

    else:
        print(
            f"[UNKNOWN EVENT] "
            f"{event.type}"
        )

    return {
        "ok": True
    }

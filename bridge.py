from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import asyncio

from pydantic import BaseModel

from typing import Any
from enum import Enum


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
    PROCESSING = "processing"
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

narration_cache: dict[str, Narration] = {}

processing_queue: asyncio.Queue[str] = asyncio.Queue()

async def translate(text: str) -> str:
    # will do soomething later
    await asyncio.sleep(0.5)
    return f"TRANSLATED: {text}"

async def narration_worker():
    print("[shkila-worker] started")

    while True:
        key = await processing_queue.get()

        narration = narration_cache.get(key)

        if narration is None:
            processing_queue.task_done()
            continue

        try:
            narration.status = NarrationStatus.PROCESSING

            print()
            print(
                f"[PROCESS] "
                f"{narration.artist} — "
                f"{narration.track_name}"
            )

            narration.translated_text = (
                await translate(narration.text)
            )

            narration.status = NarrationStatus.READY

            print(
                f"[READY] {key}"
            )

            print(
                narration.translated_text
            )

        except Exception as error:
            narration.status = NarrationStatus.FAILED
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

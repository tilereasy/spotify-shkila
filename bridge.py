from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from pydantic import BaseModel

from typing import Any


class SpotifyDJEvent(BaseModel):
    type: str
    timestamp: int
    data: dict[str, Any]

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*", "https://xpui.app.spotify.com"],
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True
)

@app.get("/health")
async def health():
    return {
        "status": "ok"
    }

@app.post("/events")
async def events(event: SpotifyDJEvent):
    print()
    print("=" * 60)
    print(f"EVENT: {event.type}")
    print("=" * 60)

    if event.type == "prefetch":
        print(
            f'{event.data.get("artist")} — '
            f'{event.data.get("trackName")}'
        )

        print(
            f'kind: {event.data.get("kind")}'
        )

        print(
            f'segment: {event.data.get("segment")}'
        )

        print()

        print(
            event.data.get("text")
        )

    elif event.type == "start":
        print(
            f'kind: {event.data.get("kind")}'
        )

        print(
            f'matched: {event.data.get("matched")}'
        )

        print(
            f'method: {event.data.get("matchMethod")}'
        )

        print(
            f'{event.data.get("artist")} — '
            f'{event.data.get("trackName")}'
        )

    else:
        print(event.data)

    return {
        "ok": True
    }
const BRIDGE_URL = "http://127.0.0.1:8765";
const PREFIX = "[Shkila DJ Probe]";

let activeReplacement = null;


function getNarrationAudioUrl(key) {
    return (
        `${BRIDGE_URL}/narrations/` +
        `${encodeURIComponent(key)}/audio`
    );
}

function handleReplacementSongChange() {
    const replacement =
        activeReplacement;

    if (
        !replacement ||
        replacement.finishing
    ) {
        return;
    }

    console.log(
        PREFIX,
        "Spotify changed item during replacement; cancelling"
    );

    stopReplacementAudio(replacement);

    Spicetify.Player.play();
}


function stopReplacementAudio(
    replacement = activeReplacement
) {
    if (
        !replacement ||
        activeReplacement !== replacement
    ) {
        return;
    }

    const {
        audio,
        objectUrl,
    } = activeReplacement;

    activeReplacement = null;

    replacement.abortController?.abort();

    try {
        audio?.pause();

        if (audio) {
            audio.currentTime = 0;
        }
    } catch {
        // ignore
    }

    if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
    }
}

async function sendEvent(type, data) {
    try {
        const response = await fetch(
            `${BRIDGE_URL}/events`,
            {
                method: "POST",

                headers: {
                    "Content-Type": "application/json",
                },

                body: JSON.stringify({
                    type,
                    timestamp: Date.now(),
                    data,
                }),
            }
        );

        if (!response.ok) {
            console.warn(
                PREFIX,
                `Bridge returned HTTP ${response.status}`
            );
        }
    } catch (error) {
        console.debug(
            PREFIX,
            "Bridge unavailable:",
            error.message
        );
    }
}

async function playReplacementNarration(
    narration,
    narrationItem
) {
    if (activeReplacement) {
        console.warn(
            PREFIX,
            "Replacement already active"
        );

        return;
    }

    const originalUri =
        narrationItem?.uri ?? null;

    console.log(
        PREFIX,
        "Replacing narration:",
        narration.artist,
        "—",
        narration.trackName
    );

    const replacement = {
        audio: null,
        objectUrl: null,

        originalUri,

        narrationKey:
            narration.key,

        narrationKind:
            narration.kind,

        finishing: false,
        abortController:
            new AbortController(),
    };

    activeReplacement = replacement;

    Spicetify.Player.pause();

    try {
        const response = await fetch(
            getNarrationAudioUrl(
                narration.key
            ),
            {
                cache: "no-store",
                signal:
                    replacement
                        .abortController
                        .signal,
            }
        );

        if (!response.ok) {
            throw new Error(
                `Audio unavailable: HTTP ${response.status}`
            );
        }

        const blob =
            await response.blob();

        if (
            activeReplacement !==
            replacement
        ) {
            return;
        }

        replacement.objectUrl =
            URL.createObjectURL(blob);

        const audio =
            new Audio(
                replacement.objectUrl
            );

        replacement.audio = audio;

        audio.volume =
            Spicetify.Player.getVolume();

        audio.muted =
            Spicetify.Player.getMute();

        audio.addEventListener(
            "ended",
            async () => {
                await finishReplacement(
                    replacement
                );
            },
            {
                once: true,
            }
        );

        audio.addEventListener(
            "error",
            () => {
                failReplacement(
                    new Error(
                        "HTMLAudioElement playback error"
                    ),
                    replacement
                );
            },
            {
                once: true,
            }
        );

        await audio.play();

        if (
            activeReplacement !==
            replacement
        ) {
            return;
        }

        console.log(
            PREFIX,
            "Replacement playback started"
        );

    } catch (error) {
        if (
            activeReplacement !==
            replacement
        ) {
            return;
        }

        console.error(
            PREFIX,
            "Replacement failed:",
            error
        );

        stopReplacementAudio(
            replacement
        );

        Spicetify.Player.play();
    }
}

async function finishReplacement(
    replacement = activeReplacement
) {
    if (
        !replacement ||
        activeReplacement !== replacement
    ) {
        return;
    }

    replacement.finishing = true;

    console.log(
        PREFIX,
        "Replacement finished"
    );

    replacement.audio.pause();

    if (replacement.objectUrl) {
        URL.revokeObjectURL(
            replacement.objectUrl
        );

        replacement.objectUrl = null;
    }

    // Release the completed narration before switching tracks.
    // The songchange handler can then start a replacement for an
    // immediately following narration (for example, outro -> intro).
    activeReplacement = null;

    let changed = false;

    try {
        changed =
            replacement.narrationKind ===
            "intro"
                ? await finishCurrentItemAndWait()
                : await nextAndWait();
    } catch (error) {
        console.error(
            PREFIX,
            "Cannot advance past replaced narration:",
            error
        );
    }

    if (!changed) {
        console.warn(
            PREFIX,
            "No songchange after completing replacement; resuming anyway"
        );
    }

    // A consecutive narration may already have paused Spotify and
    // started loading its own audio. Do not resume the built-in DJ
    // over that replacement.
    if (!activeReplacement) {
        Spicetify.Player.play();
    }
}

function nextAndWait(
    timeout = 2000
) {
    return runAndWaitForSongChange(
        () => {
            Spicetify.Player.next();
        },
        timeout
    );
}

function finishCurrentItemAndWait(
    timeout = 2000
) {
    return runAndWaitForSongChange(
        () => {
            const duration =
                Spicetify.Player.getDuration();

            if (
                Number.isFinite(duration) &&
                duration > 0
            ) {
                Spicetify.Player.seek(duration);
            } else {
                // Spicetify treats values from 0 to 1 as a
                // percentage of the current item's duration.
                Spicetify.Player.seek(1);
            }

            Spicetify.Player.play();
        },
        timeout
    );
}

function runAndWaitForSongChange(
    action,
    timeout
) {
    return new Promise(
        (resolve, reject) => {
            let finished = false;

            const cleanup = () => {
                if (finished) {
                    return;
                }

                finished = true;

                Spicetify.Player.removeEventListener(
                    "songchange",
                    onChange
                );

                clearTimeout(timer);
            };

            const onChange = () => {
                cleanup();
                resolve(true);
            };

            Spicetify.Player.addEventListener(
                "songchange",
                onChange
            );

            const timer =
                setTimeout(
                    () => {
                        cleanup();
                        resolve(false);
                    },
                    timeout
                );

            try {
                action();
            } catch (error) {
                cleanup();
                reject(error);
            }
        }
    );
}

function failReplacement(
    error,
    replacement = activeReplacement
) {
    if (
        !replacement ||
        activeReplacement !== replacement
    ) {
        return;
    }

    console.error(
        PREFIX,
        "Replacement playback error:",
        error
    );

    stopReplacementAudio(replacement);

    Spicetify.Player.play();
}

(function djNarrationProbe() {
    const NARRATION_KINDS = ["intro", "jump", "outro"];

    const knownNarrations = new Map();

    let activeNarrations = new Map();

    let lastQueueFingerprint = null;
    let currentNarrationKey = null;
    let pollTimer = null;

    function log(...args) {
        console.log(
            `%c${PREFIX}`,
            "font-weight:bold;color:#1db954",
            ...args
        );
    }

    function getMetadata(item) {
        return item?.metadata ?? {};
    }

    function getCurrentItem(state) {
        return (
            state?.item ??
            state?.track ??
            Spicetify.Queue?.track ??
            null
        );
    }

    function getNextItems(state) {
        const sources = [
            state?.nextItems,
            state?.next_tracks,
            Spicetify.Queue?.nextTracks,
        ];

        const result = [];
        const seen = new Set();

        for (const source of sources) {
            if (!Array.isArray(source)) {
                continue;
            }

            for (const item of source) {
                const key =
                    item?.uid ??
                    item?.uri ??
                    JSON.stringify(item);

                if (seen.has(key)) {
                    continue;
                }

                seen.add(key);
                result.push(item);
            }
        }

        return result;
    }

    function getSpotifyId(uri) {
        if (!uri) {
            return null;
        }

        return uri.split(":").at(-1) ?? null;
    }

    function hashString(value) {
        let hash = 2166136261;

        for (let i = 0; i < value.length; i++) {
            hash ^= value.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
        }

        return (hash >>> 0).toString(16);
    }


    function ssmlToText(ssml) {
        if (!ssml) {
            return null;
        }

        try {
            const document = new DOMParser().parseFromString(
                ssml,
                "application/xml"
            );

            return document.documentElement
                .textContent
                ?.replace(/\s+/g, " ")
                .trim() ?? null;
        } catch {
            return ssml
                .replace(/<[^>]+>/g, "")
                .replace(/\s+/g, " ")
                .trim();
        }
    }

    function normalizeSsml(ssml) {
        return ssmlToText(ssml)
            ?.toLowerCase()
            .replace(/\s+/g, " ")
            .trim() ?? null;
    }

    function extractManifestSsml(base64) {
        if (!base64) {
            return null;
        }

        try {
            const bytes = Uint8Array.from(
                atob(base64),
                char => char.charCodeAt(0)
            );

            const decoded = new TextDecoder().decode(bytes);

            return (
                decoded.match(
                    /<speak[\s\S]*?<\/speak>/
                )?.[0] ?? null
            );
        } catch (error) {
            console.warn(
                PREFIX,
                "Cannot decode media.manifest:",
                error
            );

            return null;
        }
    }


    function getArtistName(item) {
        const md = getMetadata(item);

        return (
            item?.artists
                ?.map(artist => artist.name)
                .filter(Boolean)
                .join(", ") ??
            md.artist_name ??
            null
        );
    }

    function createNarration(item, kind, queueIndex) {
        const md = getMetadata(item);

        const ssml =
            md[`narration.${kind}.ssml`];

        if (!ssml) {
            return null;
        }

        const commentaryId =
            md[`narration.${kind}.commentary_id`] ??
            null;

        const decisionId =
            md[`narration.${kind}.decision_id`] ??
            md.decision_id ??
            null;

        const trackUri =
            item?.uri ??
            null;

        const key = [
            trackUri ?? "",
            kind,
            commentaryId || hashString(ssml),
        ].join("|");

        return {
            key,

            kind,

            queueIndex,

            trackUri,
            spotifyId: getSpotifyId(trackUri),

            trackName:
                item?.name ??
                md.title ??
                null,

            artist:
                getArtistName(item),

            album:
                item?.album?.name ??
                md.album_title ??
                null,

            segment:
                md.segment ??
                null,

            decisionId,
            commentaryId,

            commentaryType:
                md[
                    `narration.${kind}.commentary_type`
                ] ?? null,

            ttsProvider:
                md[
                    `narration.${kind}.tts_provider`
                ] ?? null,

            voice:
                md[
                    `narration.${kind}.voice`
                ] ?? null,

            ssml,
            text: ssmlToText(ssml),

            rawItem: item,
        };
    }

    function extractNarrations(item, queueIndex) {
        const result = [];

        for (const kind of NARRATION_KINDS) {
            const narration =
                createNarration(
                    item,
                    kind,
                    queueIndex
                );

            if (narration) {
                result.push(narration);
            }
        }

        return result;
    }



    function createQueueItem(item, queueIndex) {
        const md = getMetadata(item);

        const narrations =
            extractNarrations(
                item,
                queueIndex
            );

        return {
            queueIndex,

            item,

            trackUri: item?.uri ?? null,
            spotifyId: getSpotifyId(item?.uri),

            trackName:
                item?.name ??
                md.title ??
                null,

            artist:
                getArtistName(item),

            segment:
                md.segment ??
                null,

            decisionId:
                md.decision_id ??
                narrations[0]?.decisionId ??
                null,

            narrations,
        };
    }

    function isDjItem(queueItem) {
        const md = getMetadata(queueItem.item);

        return (
            md.agentic_product_type === "dj" ||
            md.station_title === "DJ" ||
            md.source?.includes?.("YourDJ") ||
            md["source.components"]?.includes(
                "YourDJ"
            ) ||
            queueItem.narrations.length > 0
        );
    }

    function buildDjBlocks(items) {
        const blocks = [];
        let currentBlock = null;

        for (let i = 0; i < items.length; i++) {
            const queueItem =
                createQueueItem(items[i], i);

            if (!isDjItem(queueItem)) {
                continue;
            }

            const blockKey = [
                queueItem.decisionId ?? "?",
                queueItem.segment ?? "?",
            ].join("|");

            if (
                !currentBlock ||
                currentBlock.key !== blockKey
            ) {
                currentBlock = {
                    key: blockKey,
                    decisionId:
                        queueItem.decisionId,
                    segment:
                        queueItem.segment,
                    items: [],
                };

                blocks.push(currentBlock);
            }

            currentBlock.items.push(queueItem);
        }

        return blocks;
    }


    function narrationFingerprint(items) {
        return items
            .map((item, index) => {
                const md = getMetadata(item);

                const parts = [
                    index,
                    item?.uid,
                    item?.uri,
                    md.decision_id,
                    md.segment,
                ];

                for (
                    const kind
                    of NARRATION_KINDS
                ) {
                    const ssml =
                        md[
                            `narration.${kind}.ssml`
                        ];

                    if (ssml) {
                        parts.push(
                            kind,
                            hashString(ssml)
                        );
                    }
                }

                return parts.join(":");
            })
            .join("||");
    }

    function registerNarrations(blocks) {
        const nextActive = new Map();

        for (const block of blocks) {
            for (const item of block.items) {
                for (
                    const narration
                    of item.narrations
                ) {
                    nextActive.set(
                        narration.key,
                        narration
                    );

                    if (
                        !knownNarrations.has(
                            narration.key
                        )
                    ) {
                        knownNarrations.set(
                            narration.key,
                            narration
                        );

                        logNewNarration(
                            narration
                        );
                    }
                }
            }
        }

        activeNarrations = nextActive;
    }

    function logNewNarration(narration) {
        console.group(
            `%c[DJ PREFETCH] ${narration.kind.toUpperCase()} → ${narration.artist ?? "?"} — ${narration.trackName ?? "?"}`,
            "font-weight:bold;color:#44aaff"
        );

        console.log(
            "queue index:",
            narration.queueIndex
        );

        console.log(
            "segment:",
            narration.segment
        );

        console.log(
            "decision id:",
            narration.decisionId
        );

        console.log(
            "commentary id:",
            narration.commentaryId
        );

        console.log(
            "commentary type:",
            narration.commentaryType
        );

        console.log(
            "spotify id:",
            narration.spotifyId
        );

        console.log(
            "TTS:",
            narration.ttsProvider,
            "/",
            narration.voice
        );

        console.log(
            "text:",
            narration.text
        );

        console.log(
            "SSML:",
            narration.ssml
        );

        console.groupEnd();
        sendEvent(
    "prefetch",
    {
        key: narration.key,

        kind: narration.kind,

        trackUri: narration.trackUri,
        spotifyId: narration.spotifyId,

        trackName: narration.trackName,
        artist: narration.artist,
        album: narration.album,

        segment: narration.segment,

        decisionId: narration.decisionId,
        commentaryId: narration.commentaryId,
        commentaryType: narration.commentaryType,

        ttsProvider: narration.ttsProvider,
        voice: narration.voice,

        ssml: narration.ssml,
        text: narration.text,

        queueIndex: narration.queueIndex,
    }
);
    }


    function printBlocks(blocks) {
        console.groupCollapsed(
            `%c[DJ QUEUE] ${blocks.length} block(s)`,
            "font-weight:bold;color:#c084fc"
        );

        for (const block of blocks) {
            console.groupCollapsed(
                `[DJ BLOCK] segment=${block.segment ?? "?"} decision=${block.decisionId ?? "?"}`
            );

            for (const item of block.items) {
                const tags =
                    item.narrations
                        .map(
                            narration =>
                                narration.kind.toUpperCase()
                        )
                        .join(", ");

                const label =
                    tags
                        ? `[${tags}]`
                        : "[TRACK]";

                console.log(
                    `#${item.queueIndex} ${label} ${item.artist ?? "?"} — ${item.trackName ?? "?"}`
                );

                for (
                    const narration
                    of item.narrations
                ) {
                    console.log(
                        `   ${narration.kind}:`,
                        narration.text
                    );
                }
            }

            console.groupEnd();
        }

        console.groupEnd();
    }


    function findNarrationMatch(
        item,
        kind,
        manifestSsml
    ) {
        const md = getMetadata(item);

        const currentDecisionId =
            md.decision_id ??
            null;

        const currentSpotifyId =
            getSpotifyId(item?.uri);

        const active =
            [...activeNarrations.values()];

        const known =
            [...knownNarrations.values()];

        if (manifestSsml) {
            const normalized =
                normalizeSsml(manifestSsml);

            const match =
                active.find(
                    narration =>
                        narration.kind === kind &&
                        normalizeSsml(
                            narration.ssml
                        ) === normalized
                ) ??
                known.find(
                    narration =>
                        narration.kind === kind &&
                        normalizeSsml(
                            narration.ssml
                        ) === normalized
                );

            if (match) {
                return {
                    match,
                    method: "manifest-ssml",
                };
            }
        }

        if (currentSpotifyId) {
            const match =
                active.find(
                    narration =>
                        narration.kind === kind &&
                        narration.spotifyId ===
                            currentSpotifyId
                ) ??
                known.find(
                    narration =>
                        narration.kind === kind &&
                        narration.spotifyId ===
                            currentSpotifyId
                );

            if (match) {
                return {
                    match,
                    method: "spotify-id",
                };
            }
        }

        if (currentDecisionId) {
            const candidates =
                active.filter(
                    narration =>
                        narration.kind === kind &&
                        narration.decisionId ===
                            currentDecisionId
                );

            if (candidates.length === 1) {
                return {
                    match: candidates[0],
                    method:
                        "decision-id-fallback",
                };
            }
        }

        return {
            match: null,
            method: null,
        };
    }

    function detectCurrentNarration(state) {
        const item =
            getCurrentItem(state);

        if (!item) {
            return;
        }

        const md =
            getMetadata(item);

        const provider =
            item.provider ??
            md.provider ??
            "";

        const isNarration =
            provider.startsWith(
                "narration/"
            ) ||
            md.is_narration === "true" ||
            md.is_narration === true;

        if (!isNarration) {
            currentNarrationKey = null;
            return;
        }

        const kind =
            provider.startsWith(
                "narration/"
            )
                ? provider.split("/")[1]
                : "unknown";

        const decisionId =
            md.decision_id ??
            null;

        const narrationKey = [
            item?.uid ??
                item?.uri ??
                "",
            provider,
            decisionId ??
                "",
        ].join("|");

        if (
            narrationKey ===
            currentNarrationKey
        ) {
            return;
        }

        currentNarrationKey =
            narrationKey;

        const manifestSsml =
            extractManifestSsml(
                md["media.manifest"]
            );

        const {
            match,
            method,
        } = findNarrationMatch(
            item,
            kind,
            manifestSsml
        );

        sendEvent(
    "start",
    {
        kind,
        provider,

        narrationUri:
            item?.uri ?? null,

        spotifyId:
            getSpotifyId(item?.uri),

        decisionId,

        actualSsml:
            manifestSsml,

        actualText:
            ssmlToText(manifestSsml),

        matched:
            match !== null,

        matchMethod:
            method,

        matchedNarrationKey:
            match?.key ?? null,

        trackUri:
            match?.trackUri ?? null,

        trackName:
            match?.trackName ?? null,

        artist:
            match?.artist ?? null,

        segment:
            match?.segment ?? null,
    }
);

        if (match) {
            void playReplacementNarration(
                match,
                item
            );
        }

        console.group(
            `%c[DJ START] ${kind.toUpperCase()}`,
            "font-weight:bold;color:#ffb347"
        );

        console.log(
            "time:",
            new Date().toISOString()
        );

        console.log(
            "provider:",
            provider
        );

        console.log(
            "decision id:",
            decisionId
        );

        console.log(
            "narration URI:",
            item?.uri
        );

        console.log(
            "spotify id:",
            getSpotifyId(item?.uri)
        );

        if (manifestSsml) {
            console.log(
                "actual text:",
                ssmlToText(
                    manifestSsml
                )
            );

            console.log(
                "actual SSML:",
                manifestSsml
            );
        }

        if (match) {
            console.log(
                `%cMATCH via ${method}`,
                "font-weight:bold;color:#1db954"
            );

            console.log(
                "track:",
                `${match.artist ?? "?"} — ${match.trackName ?? "?"}`
            );

            console.log(
                "segment:",
                match.segment
            );

            console.log(
                "prefetched narration:",
                match
            );
        } else {
            console.warn(
                PREFIX,
                "No prefetched narration matched."
            );
        }

        console.log(
            "raw narration item:",
            item
        );

        console.groupEnd();
    }

    function scanQueue(state) {
        const items =
            getNextItems(state);

        const fingerprint =
            narrationFingerprint(items);

        if (
            fingerprint ===
            lastQueueFingerprint
        ) {
            return;
        }

        lastQueueFingerprint =
            fingerprint;

        const blocks =
            buildDjBlocks(items);

        registerNarrations(blocks);
        printBlocks(blocks);
    }

    function scan() {
        const state =
            Spicetify.Player?.data;

        if (!state) {
            return;
        }

        scanQueue(state);
        detectCurrentNarration(state);
    }


    function start() {
        if (
            typeof Spicetify ===
                "undefined" ||
            !Spicetify.Player ||
            !Spicetify.Queue
        ) {
            setTimeout(
                start,
                500
            );

            return;
        }

        log("started v2");

        Spicetify.Player.addEventListener(
            "songchange",
            handleReplacementSongChange
        );

        scan();

        Spicetify.Player.addEventListener(
            "songchange",
            scan
        );

        pollTimer =
            setInterval(
                scan,
                1000
            );

        window.DJProbe = {
            scan,

            get knownNarrations() {
                return [
                    ...knownNarrations.values()
                ];
            },

            get activeNarrations() {
                return [
                    ...activeNarrations.values()
                ];
            },

            get blocks() {
                return buildDjBlocks(
                    getNextItems(
                        Spicetify.Player.data
                    )
                );
            },
        };
    }

    start();
})();

(function djNarrationProbe() {
    const PREFIX = "[Shkila]";
    const NARRATION_KINDS = ["intro", "jump", "outro"];

    const seenPrefetch = new Set();
    let currentNarrationKey = null;

    function log(...args) {
        console.log(
            `%c${PREFIX}`,
            "font-weight: bold; color: #1db954",
            ...args
        );
    }

    function warn(...args) {
        console.warn(PREFIX, ...args);
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
            if (!Array.isArray(source)) continue;

            for (const item of source) {
                const key =
                    item?.uid ??
                    item?.uri ??
                    `${item?.name}:${item?.metadata?.decision_id}`;

                if (seen.has(key)) continue;

                seen.add(key);
                result.push(item);
            }
        }

        return result;
    }

    function plainTextFromSsml(ssml) {
        if (!ssml) return null;

        try {
            const document = new DOMParser().parseFromString(
                ssml,
                "application/xml"
            );

            return document.documentElement.textContent?.trim() ?? null;
        } catch {
            return ssml;
        }
    }

    function narrationInfo(item, kind) {
        const md = getMetadata(item);

        return {
            kind,

            ssml:
                md[`narration.${kind}.ssml`] ??
                null,

            decisionId:
                md[`narration.${kind}.decision_id`] ??
                null,

            commentaryId:
                md[`narration.${kind}.commentary_id`] ??
                null,

            commentaryType:
                md[`narration.${kind}.commentary_type`] ??
                null,

            voice:
                md[`narration.${kind}.voice`] ??
                null,

            ttsProvider:
                md[`narration.${kind}.tts_provider`] ??
                null,

            trackUri:
                item?.uri ??
                md.entity_uri ??
                null,

            trackName:
                item?.name ??
                md.title ??
                null,

            artist:
                item?.artists
                    ?.map(artist => artist.name)
                    .filter(Boolean)
                    .join(", ") ??
                md.artist_name ??
                null,
        };
    }

    function makeNarrationKey(info) {
        return [
            info.kind,
            info.decisionId ?? "",
            info.commentaryId ?? "",
            info.ssml ?? "",
        ].join("|");
    }

    function scanPrefetchedNarrations(state) {
        const nextItems = getNextItems(state);

        for (let index = 0; index < nextItems.length; index++) {
            const item = nextItems[index];
            const md = getMetadata(item);

            for (const kind of NARRATION_KINDS) {
                const ssml = md[`narration.${kind}.ssml`];

                if (!ssml) continue;

                const info = narrationInfo(item, kind);
                const key = makeNarrationKey(info);

                if (seenPrefetch.has(key)) {
                    continue;
                }

                seenPrefetch.add(key);

                console.group(
                    `%c[DJ PREFETCH] ${kind.toUpperCase()} → ${info.artist ?? "?"} — ${info.trackName ?? "?"}`,
                    "font-weight: bold; color: #44aaff"
                );

                console.log("queue index:", index);
                console.log("decision id:", info.decisionId);
                console.log("commentary id:", info.commentaryId);
                console.log("commentary type:", info.commentaryType);
                console.log("TTS provider:", info.ttsProvider);
                console.log("voice:", info.voice);
                console.log("track URI:", info.trackUri);

                console.log(
                    "text:",
                    plainTextFromSsml(info.ssml)
                );

                console.log("SSML:", info.ssml);
                console.log("raw item:", item);

                console.groupEnd();
            }
        }
    }

    function detectCurrentNarration(state) {
        const item = getCurrentItem(state);

        if (!item) return;

        const md = getMetadata(item);
        const provider = item.provider ?? md.provider ?? "";

        const isNarration =
            provider.startsWith("narration/") ||
            md.is_narration === "true" ||
            md.is_narration === true;

        if (!isNarration) {
            currentNarrationKey = null;
            return;
        }

        const kind = provider.startsWith("narration/")
            ? provider.split("/")[1]
            : "unknown";

        const decisionId =
            md.decision_id ??
            null;

        const key = [
            item.uid ?? item.uri ?? "",
            provider,
            decisionId ?? "",
        ].join("|");

        if (key === currentNarrationKey) {
            return;
        }

        currentNarrationKey = key;

        console.group(
            `%c[DJ START] ${kind.toUpperCase()}`,
            "font-weight: bold; color: #ffb347"
        );

        console.log("time:", new Date().toISOString());
        console.log("performance.now():", performance.now());

        console.log("provider:", provider);
        console.log("decision id:", decisionId);
        console.log("item URI:", item.uri);
        console.log("item UID:", item.uid);
        console.log("name:", item.name);
        console.log("metadata:", md);
        console.log("raw item:", item);

        console.groupEnd();
    }

    function scan() {
        const state = Spicetify.Player?.data;

        if (!state) return;

        scanPrefetchedNarrations(state);
        detectCurrentNarration(state);
    }

    function start() {
        if (
            typeof Spicetify === "undefined" ||
            !Spicetify.Player
        ) {
            setTimeout(start, 500);
            return;
        }

        log("started");

        scan();

        Spicetify.Player.addEventListener(
            "songchange",
            () => {
                scan();
            }
        );

        setInterval(scan, 1000);
    }

    start();
})();
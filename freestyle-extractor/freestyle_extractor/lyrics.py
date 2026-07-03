"""Selecting the lyrics-align input path for studio/melodic artists.

Spec 3 (Eminem / Juice WRLD input path), Phase 6 / Task 6.2: for artists whose
tracks are studio recordings with known lyrics, WhisperX transcription of the
sung/rapped vocal is unreliable. Instead we take the *ground-truth* lyrics —
provided on the request, or fetched via the optional ``lyricsgenius`` package
when it is installed — and hand them to :func:`forced_align.align_lyrics`, which
places their time spans against the isolated vocal. The resulting ``list[Word]``
feeds the SAME ``analyze()`` stage as the transcription path.

Everything here degrades gracefully: no lyrics, no ``lyricsgenius`` installed, no
Genius token, or any fetch error simply yields ``None`` so the pipeline falls
back to ordinary transcription.

Consumes: ``ExtractRequest`` (``artist``, ``lyrics``), ``VideoMeta`` (``title``),
          optional ``lyricsgenius`` package + ``config.GENIUS_TOKEN``.
Produces: ``LYRICS_ALIGN_ARTISTS``, ``uses_lyrics_align()``, ``fetch_lyrics()``,
          ``resolve_lyrics()``.
"""
from . import config
from .models import ExtractRequest, VideoMeta

# Artists whose input path is lyrics + forced-alignment rather than raw
# transcription (studio / melodic vocals). Bounded set; extend by editing here.
LYRICS_ALIGN_ARTISTS: set[str] = {"eminem", "juice_wrld"}


def uses_lyrics_align(artist: str | None) -> bool:
    """True when this artist's tracks should use the lyrics + forced-align path."""
    return (artist or "").strip().lower() in LYRICS_ALIGN_ARTISTS


def _genius_artist(artist: str) -> str:
    """`juice_wrld` -> `Juice Wrld` for the Genius search query."""
    return artist.replace("_", " ").title()


def fetch_lyrics(
    artist: str, title: str | None, token: str | None = None
) -> str | None:
    """Best-effort lyrics fetch via the optional ``lyricsgenius`` package.

    Returns ``None`` on any miss — no token, no title, package not installed, or
    a network/lookup failure — so callers can fall back to transcription.
    """
    token = token or config.GENIUS_TOKEN
    if not (title and token):
        return None
    try:
        import lyricsgenius  # optional dependency, not in requirements
    except Exception:
        return None
    try:
        genius = lyricsgenius.Genius(
            token, verbose=False, remove_section_headers=True
        )
        song = genius.search_song(title, _genius_artist(artist))
        text = getattr(song, "lyrics", None) if song is not None else None
        text = (text or "").strip()
        return text or None
    except Exception:
        return None


def resolve_lyrics(req: ExtractRequest, meta: VideoMeta | None) -> str | None:
    """Ground-truth lyrics for this request.

    Prefers the ``lyrics`` string passed on the request; otherwise attempts an
    optional ``lyricsgenius`` fetch keyed on the video title. ``None`` when
    neither yields text, so the caller falls back to transcription.
    """
    passed = (getattr(req, "lyrics", None) or "").strip()
    if passed:
        return passed
    title = meta.title if meta is not None else None
    return fetch_lyrics(req.artist, title)

"""`scripts/prompt_bundle.py` dumps a video's transcript + per-word phonetic keys
(canonical/delivered) as a compact JSON bundle for Claude Code to annotate, and a
loader that PUTs a produced annotation to the key-free `/ai-draft` endpoint.

The script itself makes NO LLM call and imports no `anthropic` SDK — Claude Code (the
user's Max plan) does the annotation pass externally, then this loader stores the result
as an AI draft. These tests are fully offline: `build_bundle` is a pure function, and the
HTTP helpers take an injectable `opener` so no real network is touched.
"""
import json
import sys
from pathlib import Path

# the script lives at <repo>/scripts (a sibling of freestyle-extractor); make it importable
_REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_REPO_ROOT / "scripts"))

import prompt_bundle as pb  # noqa: E402


# A minimal analysis payload shaped like `GET /api/videos/{id}/analysis`
# (VideoAnalysisDto, camelCase over the wire).
SAMPLE_ANALYSIS = {
    "video": {"id": "vjb7TegEIYs", "title": "HM", "artist": "harry_mack"},
    "words": [
        {"wordIndex": 0, "text": "cat", "start": 0.0, "end": 0.3,
         "ipa": "kæt", "vowelSeq": ["æ"], "deliveredIpa": "kæt"},
        {"wordIndex": 1, "text": "hat", "start": 0.3, "end": 0.6,
         "ipa": "hæt", "vowelSeq": ["æ"], "deliveredIpa": "hæt"},
        {"wordIndex": 2, "text": "the", "start": 0.6, "end": 0.7,
         "ipa": "ðə", "vowelSeq": ["ə"], "deliveredIpa": None},
    ],
    "events": [
        {"wordIndex": 0, "barIndex": 0, "intraBarIndex": 1,
         "canonicalKey": "AE_T", "deliveredKey": "AE", "detector": "end", "groupIndex": 0, "stress": 1},
        {"wordIndex": 1, "barIndex": 1, "intraBarIndex": 1,
         "canonicalKey": "AE_T", "deliveredKey": "AE", "detector": "end", "groupIndex": 0, "stress": 1},
    ],
    "groups": [{"groupIndex": 0, "hue": 200, "size": 2, "key": "AE_T"}],
    "scheme": {},
    "density": 0.5,
}


class FakeResponse:
    """Stand-in for the object `urllib.request.urlopen` returns."""

    def __init__(self, body: bytes = b"", status: int = 200):
        self._body = body
        self.status = status
        self.closed = False

    def read(self) -> bytes:
        return self._body

    def close(self) -> None:
        self.closed = True


# --- build_bundle (pure) ---------------------------------------------------

def test_build_bundle_carries_video_id_and_annotation_schema():
    bundle = pb.build_bundle(SAMPLE_ANALYSIS)
    assert bundle["video_id"] == "vjb7TegEIYs"
    # tells Claude Code the exact shape to produce (UserAnnotationDto)
    schema = bundle["annotation_schema"]
    assert set(schema) == {"bars", "groups", "paras", "types"}
    assert isinstance(bundle["instructions"], str) and bundle["instructions"]


def test_build_bundle_dumps_per_word_canonical_and_delivered_keys():
    bundle = pb.build_bundle(SAMPLE_ANALYSIS)
    words = bundle["words"]
    assert len(words) == 3
    w0 = words[0]
    assert w0["i"] == 0
    assert w0["text"] == "cat"
    # canonical/delivered phonetic keys come from the rhyme event
    assert w0["canonical"] == "AE_T"
    assert w0["delivered"] == "AE"
    # bar index is surfaced so Claude Code can seed bar boundaries
    assert w0["bar"] == 0


def test_build_bundle_falls_back_to_word_ipa_when_no_event():
    # word index 2 ("the") has no rhyme event → fall back to the word's own ipa
    bundle = pb.build_bundle(SAMPLE_ANALYSIS)
    w2 = bundle["words"][2]
    assert w2["canonical"] == "ðə"
    # deliveredIpa was None and there is no event → no delivered key emitted (compact)
    assert "delivered" not in w2
    assert "bar" not in w2  # no event → no bar index


def test_build_bundle_explicit_video_id_overrides_payload():
    bundle = pb.build_bundle(SAMPLE_ANALYSIS, video_id="override123")
    assert bundle["video_id"] == "override123"


def test_build_bundle_is_json_serialisable_and_compact():
    bundle = pb.build_bundle(SAMPLE_ANALYSIS)
    text = json.dumps(bundle)
    assert "vjb7TegEIYs" in text
    # compact words carry no null-valued phonetic keys
    for w in bundle["words"]:
        assert None not in w.values()


# --- fetch_analysis (GET, injectable opener) -------------------------------

def test_fetch_analysis_gets_the_analysis_endpoint():
    captured = {}

    def opener(req):
        captured["url"] = req.full_url
        captured["method"] = req.get_method()
        return FakeResponse(json.dumps(SAMPLE_ANALYSIS).encode())

    got = pb.fetch_analysis("vjb7TegEIYs", base_url="http://localhost:5007", opener=opener)
    assert captured["url"] == "http://localhost:5007/api/videos/vjb7TegEIYs/analysis"
    assert captured["method"] == "GET"
    assert got["video"]["id"] == "vjb7TegEIYs"


# --- push_draft (PUT /ai-draft, injectable opener) -------------------------

def test_push_draft_puts_annotation_to_ai_draft_endpoint():
    captured = {}

    def opener(req):
        captured["url"] = req.full_url
        captured["method"] = req.get_method()
        captured["body"] = req.data
        captured["content_type"] = req.get_header("Content-type")
        return FakeResponse(b"", status=204)

    annotation = {"bars": [[0], [1]], "groups": {"0": [0, 1]}, "paras": [], "types": {}}
    status = pb.push_draft("vjb7TegEIYs", annotation,
                           base_url="http://localhost:5007", opener=opener)

    assert status == 204
    assert captured["url"] == "http://localhost:5007/api/videos/vjb7TegEIYs/ai-draft"
    assert captured["method"] == "PUT"
    assert captured["content_type"] == "application/json"
    sent = json.loads(captured["body"])
    assert sent == annotation


def test_push_draft_rejects_annotation_missing_bars_or_groups():
    called = False

    def opener(req):  # pragma: no cover - must not run
        nonlocal called
        called = True
        return FakeResponse()

    try:
        pb.push_draft("vid", {"groups": {}}, opener=opener)
    except ValueError:
        pass
    else:
        raise AssertionError("expected ValueError for annotation missing 'bars'")
    assert called is False


# --- ToS / key-free guard --------------------------------------------------

def test_script_makes_no_llm_call_and_imports_no_anthropic_sdk():
    src = (_REPO_ROOT / "scripts" / "prompt_bundle.py").read_text()
    assert "import anthropic" not in src
    assert "from anthropic" not in src
    assert "ANTHROPIC_API_KEY" not in src

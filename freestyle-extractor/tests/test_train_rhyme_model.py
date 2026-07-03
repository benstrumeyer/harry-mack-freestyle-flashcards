"""`scripts/train_rhyme_model.py` closes the train-as-you-go loop: it pulls the user's
saved annotations from the backend, turns their rhyme groups into training pairs, and
fine-tunes the pretrained base (`rhyme_base.pt`) into a personalised `rhyme_user.pt`.

These tests are fully offline: the API access uses an injectable `opener` (no network),
and phoneme lookups use an injected `phone_of` so no CMUdict/`pronouncing` dependency and
no real base weights are needed — a tiny base model is trained in-test in the SAME token
space. Kept small/fast so it runs inside the normal extractor pytest suite.
"""
import json
import sys
from pathlib import Path

# the script lives at <repo>/scripts (a sibling of freestyle-extractor); make it importable
_REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_REPO_ROOT / "scripts"))

import train_rhyme_model as trm  # noqa: E402
from freestyle_extractor.rhyme_model import RhymeModel  # noqa: E402


# A fake pronunciation table in ARPABET tokens (the base's token space). "-AE T"
# words rhyme; "-AO G" words rhyme; the two families do not.
FAKE_PHONES = {
    "cat": ["K", "AE", "T"], "hat": ["H", "AE", "T"], "bat": ["B", "AE", "T"],
    "dog": ["D", "AO", "G"], "fog": ["F", "AO", "G"], "log": ["L", "AO", "G"],
}


def fake_phone_of(text):
    return FAKE_PHONES.get(text.strip(".,?!'\"").lower())


def _analysis(words, events):
    return {"video": {"id": "v"}, "words": words, "events": events,
            "groups": [], "scheme": {}, "density": 0.5}


def _word(i, text):
    return {"wordIndex": i, "text": text, "start": float(i), "end": i + 0.3,
            "ipa": None, "vowelSeq": [], "deliveredIpa": None}


def _event(i, bar, key):
    return {"wordIndex": i, "barIndex": bar, "intraBarIndex": 0,
            "canonicalKey": key, "deliveredKey": key, "detector": "end",
            "groupIndex": 0, "stress": 1}


# A single annotated song: 3 words rhyme on AE_T, 3 on AO_G, grouped by the user.
SAMPLE_DATASET = [{
    "video_id": "v1",
    "analysis": _analysis(
        words=[_word(0, "cat"), _word(1, "dog"), _word(2, "hat"),
               _word(3, "fog"), _word(4, "bat"), _word(5, "log")],
        events=[_event(0, 0, "AE_T"), _event(1, 0, "AO_G"), _event(2, 1, "AE_T"),
                _event(3, 1, "AO_G"), _event(4, 2, "AE_T"), _event(5, 2, "AO_G")],
    ),
    "annotation": {"bars": [[0, 1], [2, 3], [4, 5]],
                   "groups": {"0": [0, 2, 4], "1": [1, 3, 5]},
                   "paras": [], "types": {}},
}]


def _tiny_base(path):
    """Train a small base model in the ARPABET token space and save it, standing in
    for `models/rhyme_base.pt` without needing CMUdict pretraining."""
    pairs = []
    for _ in range(6):
        pairs += [(["K", "AE", "T"], ["H", "AE", "T"], 1),
                  (["B", "AE", "T"], ["K", "AE", "T"], 1),
                  (["D", "AO", "G"], ["F", "AO", "G"], 1),
                  (["L", "AO", "G"], ["D", "AO", "G"], 1),
                  (["K", "AE", "T"], ["D", "AO", "G"], 0),
                  (["H", "AE", "T"], ["L", "AO", "G"], 0)]
    base = RhymeModel(seed=0)
    base.train(pairs, epochs=120)
    base.save(path)


class FakeResponse:
    """Stand-in for what `urllib.request.urlopen` returns."""

    def __init__(self, body: bytes = b"", status: int = 200):
        self._body = body
        self.status = status

    def read(self) -> bytes:
        return self._body

    def close(self) -> None:
        pass


# --- build_sequence_pairs (pure) -------------------------------------------

def test_build_sequence_pairs_balanced_and_labelled():
    pairs = trm.build_sequence_pairs(SAMPLE_DATASET, phone_of=fake_phone_of)
    labels = [lbl for _, _, lbl in pairs]
    assert pairs and sum(labels) == len(labels) - sum(labels)  # balanced pos/neg
    # positives share a phoneme tail (same user group); negatives need not
    for a, b, lbl in pairs:
        if lbl == 1:
            assert a[-1] == b[-1], f"positive should share a tail: {a} {b}"


def test_build_sequence_pairs_skips_unpronounceable_words():
    # a word missing from the phone table contributes no pair
    ds = [{
        "video_id": "v",
        "analysis": _analysis([_word(0, "cat"), _word(1, "zzz"), _word(2, "hat")], []),
        "annotation": {"groups": {"0": [0, 1, 2]}},
    }]
    pairs = trm.build_sequence_pairs(ds, phone_of=fake_phone_of)
    # only cat/hat remain → exactly one positive pair, no negatives
    assert pairs == [] or all("zzz" not in "".join(a + b) for a, b, _ in pairs)
    assert len(pairs) == 1 and pairs[0][2] == 1


# --- fetch_dataset (injectable opener, skips un-annotated videos) ----------

def test_fetch_dataset_pulls_only_annotated_videos():
    calls = []

    def opener(req):
        url = req.full_url
        calls.append(url)
        if url.endswith("/api/videos"):
            return FakeResponse(json.dumps([{"id": "v1"}, {"id": "v2"}]).encode())
        if url.endswith("/v1/annotation"):
            return FakeResponse(json.dumps(SAMPLE_DATASET[0]["annotation"]).encode())
        if url.endswith("/v1/analysis"):
            return FakeResponse(json.dumps(SAMPLE_DATASET[0]["analysis"]).encode())
        if url.endswith("/v2/annotation"):
            return FakeResponse(b"", status=204)  # no saved annotation → skipped
        raise AssertionError(f"unexpected url {url}")

    ds = trm.fetch_dataset(base_url="http://localhost:5007", opener=opener)
    assert [r["video_id"] for r in ds] == ["v1"]
    # v2 was skipped at the annotation step → its analysis is never fetched
    assert not any(u.endswith("/v2/analysis") for u in calls)


# --- finetune (loads base → saves rhyme_user.pt) ---------------------------

def test_finetune_produces_rhyme_user_model_that_ranks_rhyme(tmp_path):
    base = tmp_path / "rhyme_base.pt"
    out = tmp_path / "rhyme_user.pt"
    _tiny_base(base)

    result = trm.finetune(base_model=base, out_path=out, dataset=SAMPLE_DATASET,
                          phone_of=fake_phone_of, epochs=80)

    assert result["finetune"]["trained"] is True
    assert result["out"] == str(out)
    assert out.exists()

    user = RhymeModel.load(out)
    rhyme = user.predict_rhyme(["K", "AE", "T"], ["B", "AE", "T"])
    nonrhyme = user.predict_rhyme(["K", "AE", "T"], ["D", "AO", "G"])
    assert rhyme > nonrhyme


def test_finetune_reports_feature_model_metric(tmp_path):
    base = tmp_path / "rhyme_base.pt"
    _tiny_base(base)
    result = trm.finetune(base_model=base, out_path=tmp_path / "rhyme_user.pt",
                          dataset=SAMPLE_DATASET, phone_of=fake_phone_of, epochs=40)
    # feature-vector pairs go through training.build_pairs/train_eval — honest report
    fm = result["feature_model"]
    assert "trained" in fm
    if not fm["trained"]:
        assert "need more" in fm["message"]  # one small song isn't enough labels


def test_finetune_does_not_save_when_single_class(tmp_path):
    base = tmp_path / "rhyme_base.pt"
    out = tmp_path / "rhyme_user.pt"
    _tiny_base(base)
    # one group only → all positives, nothing separable → no user model written
    single = [{
        "video_id": "v",
        "analysis": _analysis([_word(0, "cat"), _word(1, "hat"), _word(2, "bat")], []),
        "annotation": {"groups": {"0": [0, 1, 2]}},
    }]
    result = trm.finetune(base_model=base, out_path=out, dataset=single,
                          phone_of=fake_phone_of, epochs=20)
    assert result["finetune"]["trained"] is False
    assert result["out"] is None
    assert not out.exists()


# --- ToS / key-free guard --------------------------------------------------

def test_script_makes_no_llm_call_and_imports_no_anthropic_sdk():
    src = (_REPO_ROOT / "scripts" / "train_rhyme_model.py").read_text()
    assert "import anthropic" not in src
    assert "from anthropic" not in src
    assert "ANTHROPIC_API_KEY" not in src

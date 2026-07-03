"""Precision-favored hybrid ensemble over synthetic signals.

The ensemble combines up to five INDEPENDENT signals per candidate word pair —
canonical-key match, vowel-run overlap, delivered-phoneme match, the local
`rhyme_model` P(rhyme), and an optional AI-draft vote — and proposes a rhyme
only when >= min_signals of them agree (precision over recall). These tests
drive the combine policy on synthetic signals and the `auto_annotate` grouping
on RhymeEvents, with a stub model (no torch training needed).
"""
from freestyle_extractor.models import RhymeEvent
from freestyle_extractor import ensemble


_WORDS = ["cat", "hat", "bat", "dog", "log", "frog", "moon", "spoon"]


def _ev(wi, bar=0, ii=0, canonical=None, delivered=None, vs=None, text=None):
    return RhymeEvent(
        word_index=wi, text=text or _WORDS[wi], bar_index=bar, intra_bar_index=ii,
        start=float(wi), end=float(wi) + 0.1,
        canonical_key=canonical, delivered_key=delivered,
        vowel_seq=vs if vs is not None else ([canonical] if canonical else []),
        stress=0,
    )


class _StubModel:
    """Stand-in for a trained RhymeModel: fixed P(rhyme) by (text) pair."""

    def __init__(self, prob=1.0):
        self.prob = prob
        self.calls = []

    def predict_rhyme(self, a, b) -> float:
        self.calls.append((a, b))
        return self.prob


# --- combine policy (synthetic signals) ------------------------------------

def test_combine_needs_two_agreeing_signals():
    # a single positive signal is NOT enough (precision favored)
    proposed, conf = ensemble.combine({"canonical": True})
    assert proposed is False

    proposed, conf = ensemble.combine({"canonical": True, "delivered": True})
    assert proposed is True
    assert conf == 1.0


def test_combine_disagreement_lowers_confidence():
    # two agree, one dissents -> still proposed but confidence < 1
    proposed, conf = ensemble.combine(
        {"canonical": True, "delivered": True, "vowel_run": False})
    assert proposed is True
    assert conf == 2 / 3


def test_combine_single_strong_model_vote_is_rejected():
    # even a confident local-model vote alone does not clear the bar
    proposed, conf = ensemble.combine({"model": True, "canonical": False, "delivered": False})
    assert proposed is False


def test_combine_min_signals_configurable():
    sigs = {"canonical": True, "delivered": True}
    assert ensemble.combine(sigs, min_signals=2)[0] is True
    assert ensemble.combine(sigs, min_signals=3)[0] is False


def test_combine_empty_signals():
    proposed, conf = ensemble.combine({})
    assert proposed is False
    assert conf == 0.0


# --- pair_signals ----------------------------------------------------------

def test_pair_signals_canonical_and_delivered_match():
    a = _ev(0, canonical="AE_T", delivered="AE", vs=["ae"])
    b = _ev(1, canonical="AE_T", delivered="AE", vs=["ae"])
    sig = ensemble.pair_signals(a, b)
    assert sig["canonical"] is True
    assert sig["delivered"] is True


def test_pair_signals_omits_absent_signals():
    # neither word carries a delivered key -> the delivered signal abstains
    a = _ev(0, canonical="AE_T", vs=["ae"])
    b = _ev(1, canonical="AE_T", vs=["ae"])
    sig = ensemble.pair_signals(a, b)
    assert "delivered" not in sig
    assert sig["canonical"] is True


def test_pair_signals_vowel_run_needs_multisyllabic_overlap():
    # a single shared vowel is not a vowel-RUN; two contiguous shared vowels is
    a = _ev(0, canonical="k", vs=["e", "o"])
    b = _ev(1, canonical="k", vs=["e", "o"])
    sig = ensemble.pair_signals(a, b)
    assert sig["vowel_run"] is True

    c = _ev(2, canonical="k", vs=["e"])
    d = _ev(3, canonical="k", vs=["e"])
    assert ensemble.pair_signals(c, d)["vowel_run"] is False


def test_pair_signals_model_vote_uses_threshold():
    a = _ev(0, canonical="AE_T", vs=["ae"])
    b = _ev(1, canonical="AE_T", vs=["ae"])
    hot = ensemble.pair_signals(a, b, model=_StubModel(0.9))
    cold = ensemble.pair_signals(a, b, model=_StubModel(0.1))
    assert hot["model"] is True
    assert cold["model"] is False


def test_pair_signals_ai_draft_vote():
    a = _ev(0, canonical="AE_T", vs=["ae"])
    b = _ev(1, canonical="AE_T", vs=["ae"])
    # word 0 and 1 co-grouped in the AI draft
    ai_group_of = {0: "0", 1: "0"}
    assert ensemble.pair_signals(a, b, ai_group_of=ai_group_of)["ai_draft"] is True
    # different AI groups -> the vote dissents (present but False)
    assert ensemble.pair_signals(a, b, ai_group_of={0: "0", 1: "1"})["ai_draft"] is False


# --- auto_annotate ---------------------------------------------------------

def _analysis(events):
    from freestyle_extractor.models import Analysis
    return Analysis(events=events)


def test_auto_annotate_groups_pair_with_two_signals():
    # canonical + delivered agree; no vowel_seq -> vowel_run abstains, conf 1.0
    evs = [
        _ev(0, canonical="AE_T", delivered="AE", vs=[]),
        _ev(1, bar=1, canonical="AE_T", delivered="AE", vs=[]),
    ]
    result = ensemble.auto_annotate(_analysis(evs))
    assert len(result.groups) == 1
    (gid, members), = result.groups.items()
    assert set(members) == {0, 1}
    assert result.confidences[gid] == 1.0


def test_auto_annotate_single_signal_pair_is_not_grouped():
    # matching canonical key ONLY (no delivered, no vowel run) -> below the bar
    evs = [
        _ev(0, canonical="AE_T", vs=["ae"]),
        _ev(1, bar=1, canonical="AE_T", vs=["ae"]),
    ]
    result = ensemble.auto_annotate(_analysis(evs))
    assert result.groups == {}


def test_auto_annotate_ai_draft_can_supply_the_second_signal():
    # canonical matches (1 signal); the AI draft co-groups them (2nd signal) -> proposed
    evs = [
        _ev(0, canonical="AE_T", vs=["ae"]),
        _ev(1, bar=1, canonical="AE_T", vs=["ae"]),
    ]
    ai_draft = {"bars": [[0], [1]], "groups": {"0": [0, 1]}}
    result = ensemble.auto_annotate(_analysis(evs), ai_draft=ai_draft)
    assert len(result.groups) == 1
    (_gid, members), = result.groups.items()
    assert set(members) == {0, 1}


def test_auto_annotate_precision_drops_spurious_ai_only_group():
    # AI draft alone (no phonetic backing) must NOT create a group — precision.
    evs = [
        _ev(0, canonical="AE_T", vs=["ae"]),
        _ev(1, bar=1, canonical="IY_N", vs=["iy"], text="green"),
    ]
    ai_draft = {"bars": [[0], [1]], "groups": {"0": [0, 1]}}
    result = ensemble.auto_annotate(_analysis(evs), ai_draft=ai_draft)
    assert result.groups == {}


def test_auto_annotate_transitive_grouping_three_words():
    evs = [
        _ev(0, canonical="AE_T", delivered="AE", vs=["ae"]),
        _ev(1, bar=1, canonical="AE_T", delivered="AE", vs=["ae"]),
        _ev(2, bar=2, canonical="AE_T", delivered="AE", vs=["ae"], text="bat"),
    ]
    result = ensemble.auto_annotate(_analysis(evs))
    assert len(result.groups) == 1
    (_gid, members), = result.groups.items()
    assert set(members) == {0, 1, 2}


def test_auto_annotate_two_distinct_groups():
    evs = [
        _ev(0, canonical="AE_T", delivered="AE", vs=["ae"]),
        _ev(1, bar=1, canonical="AE_T", delivered="AE", vs=["ae"]),
        _ev(2, bar=2, canonical="OG", delivered="OG", vs=["o"], text="dog"),
        _ev(3, bar=3, canonical="OG", delivered="OG", vs=["o"], text="log"),
    ]
    result = ensemble.auto_annotate(_analysis(evs))
    assert len(result.groups) == 2
    all_members = {wi for m in result.groups.values() for wi in m}
    assert all_members == {0, 1, 2, 3}


def test_auto_annotate_respects_bar_window():
    # far-apart bars are not candidate pairs even with matching keys
    evs = [
        _ev(0, bar=0, canonical="AE_T", delivered="AE", vs=["ae"]),
        _ev(1, bar=99, canonical="AE_T", delivered="AE", vs=["ae"]),
    ]
    result = ensemble.auto_annotate(_analysis(evs), window_bars=6)
    assert result.groups == {}


def test_auto_annotate_drops_stopwords():
    evs = [
        _ev(0, canonical="AH", delivered="AH", vs=["ah"], text="the"),
        _ev(1, bar=1, canonical="AH", delivered="AH", vs=["ah"], text="a"),
    ]
    result = ensemble.auto_annotate(_analysis(evs))
    assert result.groups == {}


def test_auto_annotate_model_signal_wired_through():
    # canonical matches (1) + a hot model vote (2) -> grouped
    evs = [
        _ev(0, canonical="AE_T", vs=["ae"]),
        _ev(1, bar=1, canonical="AE_T", vs=["ae"]),
    ]
    model = _StubModel(0.99)
    result = ensemble.auto_annotate(_analysis(evs), model=model)
    assert len(result.groups) == 1
    assert model.calls  # the local model was actually consulted

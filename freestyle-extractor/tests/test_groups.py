from freestyle_extractor.models import RhymeEvent
from freestyle_extractor.groups import build_groups, scheme_labels, _PALETTE

# Distinct, non-stopword content words per index (grouping now requires >= 2
# DISTINCT content words, and drops stopwords / non-alphabetic tokens).
_WORDS = ["cat", "dog", "bat", "log", "fish", "dish", "tree", "bee", "moon", "spoon"]


def _ev(wi, bar=0, ii=0, canonical=None, delivered=None, vs=None, text=None):
    return RhymeEvent(
        word_index=wi, text=text or _WORDS[wi], bar_index=bar, intra_bar_index=ii,
        start=float(wi), end=float(wi) + 0.1,
        canonical_key=canonical, delivered_key=delivered,
        vowel_seq=vs or [canonical or ""], stress=0,
    )


def test_two_rhyming_words_same_group_and_hue():
    evs = [_ev(0, canonical="o@"), _ev(1, canonical="o@")]
    groups = build_groups(evs)
    assert len(groups) == 1
    g = groups[0]
    assert set(g.word_indices) == {0, 1}
    assert g.group_index == 0
    assert g.hue == _PALETTE[0]        # first group -> first palette hue
    assert g.key == "o@"


def test_hue_from_palette_by_first_appearance():
    # two independent rhyme groups -> first two distinct palette hues
    evs = [_ev(0, canonical="o@"), _ev(1, canonical="eɪ"),
           _ev(2, canonical="o@"), _ev(3, canonical="eɪ")]
    groups = build_groups(evs)
    assert len(groups) == 2
    assert [g.group_index for g in groups] == [0, 1]
    assert [g.hue for g in groups] == [_PALETTE[0], _PALETTE[1]]


def test_union_on_delivered_key():
    # no shared canonical key, but a shared delivered key unions them
    evs = [_ev(0, canonical="x", delivered="or"),
           _ev(1, canonical="y", delivered="or")]
    groups = build_groups(evs)
    assert len(groups) == 1
    assert set(groups[0].word_indices) == {0, 1}


def test_non_rhyming_words_form_no_group():
    evs = [_ev(0, canonical="q"), _ev(1, canonical="z")]
    assert build_groups(evs) == []


def test_repeated_same_word_is_not_a_rhyme_group():
    # "up up up" (same word) shares a key but is repetition, not a rhyme
    evs = [_ev(0, canonical="Vp", text="up"),
           _ev(1, canonical="Vp", text="up,"),
           _ev(2, canonical="Vp", text="up?")]
    assert build_groups(evs) == []


def test_stopwords_do_not_anchor_groups():
    # "a" (stopword) shares the eɪ key with "play"/"hey"; only the content
    # words should form the group, "a" excluded.
    evs = [_ev(0, canonical="eɪ", text="a"),
           _ev(1, canonical="eɪ", text="play"),
           _ev(2, canonical="eɪ", text="hey")]
    groups = build_groups(evs)
    assert len(groups) == 1
    assert set(groups[0].word_indices) == {1, 2}   # "a" not in the group


def test_abab_scheme():
    # bar0 & bar2 share a key (A); bar1 & bar3 share a key (B)
    evs = [_ev(0, bar=0, ii=0, canonical="a"),
           _ev(1, bar=1, ii=0, canonical="b"),
           _ev(2, bar=2, ii=0, canonical="a"),
           _ev(3, bar=3, ii=0, canonical="b")]
    groups = build_groups(evs)
    schemes = scheme_labels(evs, groups)
    assert schemes[0] == "ABAB"


def test_aabb_scheme():
    evs = [_ev(0, bar=0, ii=0, canonical="a"),
           _ev(1, bar=1, ii=0, canonical="a"),
           _ev(2, bar=2, ii=0, canonical="b"),
           _ev(3, bar=3, ii=0, canonical="b")]
    schemes = scheme_labels(evs, build_groups(evs))
    assert schemes[0] == "AABB"


def test_abcb_scheme_with_unmatched_bar():
    # bar2 final rhymes with nothing -> gets its own letter C
    evs = [_ev(0, bar=0, ii=0, canonical="a"),
           _ev(1, bar=1, ii=0, canonical="b"),
           _ev(2, bar=2, ii=0, canonical="c"),
           _ev(3, bar=3, ii=0, canonical="b")]
    schemes = scheme_labels(evs, build_groups(evs))
    assert schemes[0] == "ABCB"

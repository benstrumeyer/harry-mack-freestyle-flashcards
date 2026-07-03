from freestyle_extractor.models import RhymeEvent
from freestyle_extractor.groups import build_groups, scheme_labels


def _ev(wi, bar=0, ii=0, canonical=None, delivered=None, vs=None):
    return RhymeEvent(
        word_index=wi, text=str(wi), bar_index=bar, intra_bar_index=ii,
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
    assert g.hue == int(360 * 0 / 1)   # single group -> hue 0
    assert g.key == "o@"


def test_hue_evenly_spaced_by_first_appearance():
    # two independent rhyme groups -> hues 0 and 180
    evs = [_ev(0, canonical="a"), _ev(1, canonical="b"),
           _ev(2, canonical="a"), _ev(3, canonical="b")]
    groups = build_groups(evs)
    assert len(groups) == 2
    assert [g.group_index for g in groups] == [0, 1]
    assert [g.hue for g in groups] == [int(360 * 0 / 2), int(360 * 1 / 2)]  # 0, 180


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

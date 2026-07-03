from freestyle_extractor.models import RhymeEvent
from freestyle_extractor.density import rhyme_density


def _ev(wi, vs, bar=0, ii=0, canonical=None, delivered=None):
    return RhymeEvent(
        word_index=wi, text=str(wi), bar_index=bar, intra_bar_index=ii,
        start=float(wi), end=float(wi) + 0.1,
        canonical_key=canonical, delivered_key=delivered,
        vowel_seq=vs, stress=0,
    )


def test_empty_events_zero_density():
    assert rhyme_density([]) == 0.0


def test_no_syllables_zero_density():
    # events with empty vowel sequences -> no syllables -> 0, no divide-by-zero
    evs = [_ev(0, []), _ev(1, [])]
    assert rhyme_density(evs) == 0.0


def test_dense_repeated_multis_beats_sparse():
    multi = ["eI", "S", "@", "nz"]
    dense = [_ev(i, list(multi), bar=i) for i in range(4)]
    sparse = [_ev(0, ["a"], bar=0), _ev(1, ["e"], bar=1),
              _ev(2, ["i"], bar=2), _ev(3, ["o"], bar=3)]
    assert rhyme_density(dense) > rhyme_density(sparse)


def test_returns_float_in_expected_range():
    multi = ["eI", "S", "@", "nz"]
    dense = [_ev(i, list(multi), bar=i) for i in range(4)]
    d = rhyme_density(dense)
    assert isinstance(d, float)
    assert 0.0 <= d <= 1.5


def test_all_matching_multis_near_one():
    # every event after the first matches a full 4-vowel run against a prior
    multi = ["eI", "S", "@", "nz"]
    evs = [_ev(i, list(multi), bar=i) for i in range(5)]
    # matched = 4*4 (events 1..4) / total 20 syllables = 16/20 = 0.8
    assert rhyme_density(evs) == 16.0 / 20.0

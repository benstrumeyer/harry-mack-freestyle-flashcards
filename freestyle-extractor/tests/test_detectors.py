from freestyle_extractor.models import RhymeEvent
from freestyle_extractor.detectors import label_events


def _ev(wi, bi, ii, ck, dk=None, vs=None, last=False, **kw):
    return RhymeEvent(word_index=wi, text=str(wi), bar_index=bi, intra_bar_index=ii,
                      start=float(wi), end=float(wi)+0.1, canonical_key=ck, delivered_key=dk,
                      vowel_seq=vs or [ck or ""], stress=0)


def test_perfect_end():
    # two bars, each final word same canonical key
    evs = [_ev(0,0,0,"a"), _ev(1,0,1,"o@"), _ev(2,1,0,"b"), _ev(3,1,1,"o@")]
    lab = label_events(evs)
    assert lab[1] == "perfect-end" and lab[3] == "perfect-end"


def test_slant_end():
    evs = [_ev(0,0,0,"a"), _ev(1,0,1,"o@", dk="or"), _ev(2,1,0,"b"), _ev(3,1,1,"OO", dk="or")]
    lab = label_events(evs)
    assert lab[1] == "slant-end" and lab[3] == "slant-end"


def test_internal():
    evs = [_ev(0,0,0,"aI"), _ev(1,0,1,"aI"), _ev(2,0,2,"z")]
    lab = label_events(evs)
    assert lab[0] == "internal" or lab[1] == "internal"


def test_multisyllabic():
    evs = [_ev(0,0,0,"x", vs=["eI","S","@","nz"]), _ev(1,1,0,"y", vs=["eI","S","@","nz"])]
    lab = label_events(evs)
    assert "multisyllabic" in (lab[0], lab[1])


def test_chain():
    evs = [_ev(0,0,1,"o@"), _ev(1,1,1,"o@"), _ev(2,2,1,"o@")]
    lab = label_events(evs)
    assert list(lab.values()).count("chain") >= 3


def test_none():
    evs = [_ev(0,0,0,"q"), _ev(1,1,0,"z")]
    lab = label_events(evs)
    assert lab[0] == "none" and lab[1] == "none"

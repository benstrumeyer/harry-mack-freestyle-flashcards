from freestyle_extractor.phonetics import rhyme_tail, rhymes

def test_rhyming_pair_matches():
    assert rhymes("care", "air") is True
    assert rhymes("care", "table") is False

def test_identical_words_rhyme():
    assert rhymes("flow", "flow") is True

def test_rhyme_tail_nonempty_for_real_word():
    assert rhyme_tail("side")  # e.g. "aI d"

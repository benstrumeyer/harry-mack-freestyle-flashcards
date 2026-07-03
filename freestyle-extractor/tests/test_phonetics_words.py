from freestyle_extractor.phonetics import word_phonemes, vowel_sequence, longest_common_vowel_run


def test_vowel_sequence_multisyllabic():
    seq = vowel_sequence("explorations")
    assert len(seq) >= 3            # e-plo-ra-tions -> multiple vowels
    assert all(isinstance(v, str) and v for v in seq)


def test_word_phonemes_shape():
    wp = word_phonemes("explore")
    assert set(wp) == {"ipa", "vowel_seq", "n_syllables"}
    assert wp["ipa"]
    assert wp["n_syllables"] == len(wp["vowel_seq"])


def test_longest_common_vowel_run_matches_multisyllabic():
    a, b = vowel_sequence("creations"), vowel_sequence("explorations")
    assert longest_common_vowel_run(a, b) >= 2   # ...eIS@nz shared tail


def test_longest_common_vowel_run_single():
    a, b = vowel_sequence("explore"), vowel_sequence("more")
    assert longest_common_vowel_run(a, b) >= 1

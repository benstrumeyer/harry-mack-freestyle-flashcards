from freestyle_extractor import separate

def test_vocals_path_shape(tmp_path):
    assert separate.vocals_path("song", str(tmp_path)).endswith("vocals.wav")

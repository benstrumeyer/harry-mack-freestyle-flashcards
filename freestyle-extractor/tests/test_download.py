import json
from freestyle_extractor import download as dl

def test_video_id_extracted_from_url():
    assert dl.video_id("https://youtu.be/abc123XYZ_1") == "abc123XYZ_1"
    assert dl.video_id("https://www.youtube.com/watch?v=abc123XYZ_1") == "abc123XYZ_1"

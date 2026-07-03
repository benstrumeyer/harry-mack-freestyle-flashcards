"""The train-as-you-go pipeline learns rhyme from labels on separable data."""
from freestyle_extractor.training import WordFeat, build_pairs, train_eval, pair_features


def _wf(wi, key, bar, final=True):
    return WordFeat(word_index=wi, text=f"w{wi}", canonical=key, delivered=None,
                    vowel_seq=list(key), bar_index=bar, stress=0, is_bar_final=final)


def test_pair_features_shape():
    a = _wf(0, "aIp", 0); b = _wf(1, "aIp", 1)
    f = pair_features(a, b)
    assert len(f) == 7 and f[0] == 1.0  # same canonical


def test_trains_and_learns_on_separable_labels():
    # 4 families; aIp/aIt share the "aI" run (→ hard negatives), o@/iːn are distinct.
    # The user groups strictly by exact sound, so same_canonical separates them.
    feats, groups = [], {"aIp": [], "aIt": [], "o@": [], "iːn": []}
    wi = 0
    for bar in range(20):
        for key in ("aIp", "aIt", "o@", "iːn"):
            feats.append(_wf(wi, key, bar))
            groups[key].append(wi)
            wi += 1
    X, y = build_pairs(feats, groups, window_bars=6)
    assert len(X) >= 40 and 0 < sum(y) < len(y)
    res = train_eval(X, y)
    assert res["trained"] is True
    assert res["cv_auc"] >= 0.9          # same-sound is highly predictive -> model learns it
    assert res["weights"]["same_canonical"] > 0


def test_reports_when_too_few_labels():
    feats = [_wf(0, "aIp", 0), _wf(1, "aIp", 1)]
    res = train_eval(*build_pairs(feats, {"aIp": [0, 1]}))
    assert res["trained"] is False and "need more" in res["message"]

"""Free/local trainable rhyme model — a PyTorch phoneme-sequence Siamese scorer.

Two sequences (phoneme token lists, or whitespace-separated phoneme strings, or
plain words that get char-tokenised) are each embedded and run through a shared
GRU encoder; a distance head over |a-b| and a*b emits a single logit → `P(rhyme)`.

This is the "learn-as-you-go" base: `scripts/pretrain_rhyme_model.py` pretrains it on
CMUdict rhyme pairs and saves `models/rhyme_base.pt`; user annotation pairs (from
`training.build_pairs`) fine-tune it. Here we only define the model + train/predict +
save/load; keep training runs SMALL — it converges fast on separable rhyme signal.

Public surface:
    RhymeModel().train(pairs) -> metrics   # pairs = list of (seq_a, seq_b, label)
    model.predict_rhyme(a, b) -> float      # P(rhyme) in [0, 1]
    model.save(path) / RhymeModel.load(path)
"""
from __future__ import annotations

import random
from pathlib import Path

import torch
import torch.nn as nn

PAD, UNK = "<pad>", "<unk>"

# a phoneme sequence may arrive as a list of tokens, a whitespace-separated string
# ("K AE T"), or a bare word ("cat" -> char tokens).
Seq = "list[str] | str"


def _tokenize(x) -> list[str]:
    if isinstance(x, str):
        parts = x.split()
        toks = parts if len(parts) > 1 else list(x)
    else:
        toks = [str(t) for t in x]
    return toks or [UNK]


class _SiameseNet(nn.Module):
    """Shared phoneme embedding + BiGRU encoder + distance head → one logit."""

    def __init__(self, vocab_size: int, embed_dim: int = 24, hidden: int = 32):
        super().__init__()
        self.embed = nn.Embedding(vocab_size, embed_dim, padding_idx=0)
        self.gru = nn.GRU(embed_dim, hidden, batch_first=True, bidirectional=True)
        self.head = nn.Sequential(
            nn.Linear(4 * hidden, hidden),
            nn.ReLU(),
            nn.Linear(hidden, 1),
        )

    def encode(self, ids: torch.Tensor, lengths: torch.Tensor) -> torch.Tensor:
        emb = self.embed(ids)
        packed = nn.utils.rnn.pack_padded_sequence(
            emb, lengths.cpu(), batch_first=True, enforce_sorted=False
        )
        _, h = self.gru(packed)  # h: (2, batch, hidden) — both GRU directions
        return torch.cat([h[0], h[1]], dim=-1)  # (batch, 2*hidden)

    def forward(self, a_ids, a_len, b_ids, b_len) -> torch.Tensor:
        ea = self.encode(a_ids, a_len)
        eb = self.encode(b_ids, b_len)
        feat = torch.cat([torch.abs(ea - eb), ea * eb], dim=-1)  # (batch, 4*hidden)
        return self.head(feat).squeeze(-1)  # logits, (batch,)


def _auc(labels: list[int], scores: list[float]) -> float:
    """Mann-Whitney AUC (no sklearn dependency)."""
    pos = [s for s, l in zip(scores, labels) if l == 1]
    neg = [s for s, l in zip(scores, labels) if l == 0]
    if not pos or not neg:
        return float("nan")
    wins = sum(1.0 if p > n else 0.5 if p == n else 0.0 for p in pos for n in neg)
    return wins / (len(pos) * len(neg))


class RhymeModel:
    """Siamese `P(rhyme)` scorer over phoneme sequences with save/load."""

    def __init__(self, embed_dim: int = 24, hidden: int = 32, seed: int = 0):
        self.embed_dim = embed_dim
        self.hidden = hidden
        self.seed = seed
        self.vocab: dict[str, int] = {PAD: 0, UNK: 1}
        self.net: _SiameseNet | None = None

    # -- encoding -----------------------------------------------------------
    def _ids(self, x) -> list[int]:
        return [self.vocab.get(t, 1) for t in _tokenize(x)]

    def _build_vocab(self, pairs) -> None:
        for a, b, _ in pairs:
            for t in _tokenize(a) + _tokenize(b):
                if t not in self.vocab:
                    self.vocab[t] = len(self.vocab)

    def _batch(self, seqs: list[list[int]]) -> tuple[torch.Tensor, torch.Tensor]:
        lengths = torch.tensor([max(1, len(s)) for s in seqs], dtype=torch.long)
        width = int(lengths.max())
        ids = torch.zeros((len(seqs), width), dtype=torch.long)  # PAD=0
        for i, s in enumerate(seqs):
            if s:
                ids[i, : len(s)] = torch.tensor(s, dtype=torch.long)
        return ids, lengths

    # -- training -----------------------------------------------------------
    def train(self, pairs, epochs: int = 200, lr: float = 0.01) -> dict:
        """pairs = list of (seq_a, seq_b, label). Full-batch train; return metrics.

        Reports honestly when there is nothing separable to learn (single class)."""
        torch.manual_seed(self.seed)
        random.seed(self.seed)
        n = len(pairs)
        labels = [int(l) for _, _, l in pairs]
        pos = sum(labels)
        if n == 0 or pos == 0 or pos == n:
            return {"trained": False, "n": n, "positives": pos,
                    "message": "need both rhyme and non-rhyme pairs to train"}

        self._build_vocab(pairs)
        self.net = _SiameseNet(len(self.vocab), self.embed_dim, self.hidden)

        a_ids, a_len = self._batch([self._ids(a) for a, _, _ in pairs])
        b_ids, b_len = self._batch([self._ids(b) for _, b, _ in pairs])
        y = torch.tensor(labels, dtype=torch.float32)

        opt = torch.optim.Adam(self.net.parameters(), lr=lr)
        loss_fn = nn.BCEWithLogitsLoss()
        self.net.train()
        last_loss = float("nan")
        for _ in range(epochs):
            opt.zero_grad()
            logits = self.net(a_ids, a_len, b_ids, b_len)
            loss = loss_fn(logits, y)
            loss.backward()
            opt.step()
            last_loss = loss.item()

        self.net.eval()
        with torch.no_grad():
            probs = torch.sigmoid(self.net(a_ids, a_len, b_ids, b_len)).tolist()
        preds = [1 if p >= 0.5 else 0 for p in probs]
        acc = sum(int(p == t) for p, t in zip(preds, labels)) / n
        return {"trained": True, "n": n, "positives": pos, "epochs": epochs,
                "loss": round(last_loss, 4), "accuracy": round(acc, 4),
                "auc": round(_auc(labels, probs), 4)}

    # -- inference ----------------------------------------------------------
    def predict_rhyme(self, a, b) -> float:
        """P(rhyme) in [0, 1] for two phoneme sequences (or words)."""
        if self.net is None:
            raise RuntimeError("RhymeModel is untrained — call train() or load() first")
        self.net.eval()
        a_ids, a_len = self._batch([self._ids(a)])
        b_ids, b_len = self._batch([self._ids(b)])
        with torch.no_grad():
            return float(torch.sigmoid(self.net(a_ids, a_len, b_ids, b_len))[0])

    # -- persistence --------------------------------------------------------
    def save(self, path) -> None:
        if self.net is None:
            raise RuntimeError("nothing to save — model is untrained")
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        torch.save({
            "vocab": self.vocab,
            "embed_dim": self.embed_dim,
            "hidden": self.hidden,
            "seed": self.seed,
            "state_dict": self.net.state_dict(),
        }, str(path))

    @classmethod
    def load(cls, path) -> "RhymeModel":
        ckpt = torch.load(str(path), map_location="cpu", weights_only=False)
        model = cls(embed_dim=ckpt["embed_dim"], hidden=ckpt["hidden"],
                    seed=ckpt.get("seed", 0))
        model.vocab = ckpt["vocab"]
        model.net = _SiameseNet(len(model.vocab), model.embed_dim, model.hidden)
        model.net.load_state_dict(ckpt["state_dict"])
        model.net.eval()
        return model

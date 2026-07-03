#!/usr/bin/env python
"""Dump a video's transcript + per-word phonetic keys as a compact prompt bundle for
Claude Code to annotate, and load the produced annotation back as an AI DRAFT.

The LLM pass is NOT done here. This script is key-free and ToS-clean: it never calls
Claude/Anthropic and imports no `anthropic` SDK. The flow is:

    1.  `prompt_bundle.py <video_id> --out bundle.json`
        → GET /api/videos/{id}/analysis, distill it to a compact bundle (transcript
          words + canonical/delivered phonetic keys + bar hints + the target
          annotation schema) that Claude Code reads.
    2.  Claude Code (the user's Max plan, its intended context) reads the bundle and
        writes an annotation JSON in `UserAnnotationDto` shape (bars/groups/paras/types).
    3.  `prompt_bundle.py <video_id> --push annotation.json`
        → PUT /api/videos/{id}/ai-draft. The draft is a suggestion source only; the
          backend NEVER lets it overwrite the user's saved annotation.

Run (from repo root):
    ~/rapenv/bin/python scripts/prompt_bundle.py vjb7TegEIYs --out bundle.json
    ~/rapenv/bin/python scripts/prompt_bundle.py vjb7TegEIYs --push draft.json
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.request

# default host of the .NET backend (see backend/.../launchSettings.json + vite proxy)
DEFAULT_BASE_URL = "http://localhost:5007"

# What Claude Code should produce — mirrors UserAnnotationDto (camelCase over the wire).
ANNOTATION_SCHEMA = {
    "bars": "list of bars, each a list of word indices (i) in reading order",
    "groups": "map of rhyme-group id (string) -> list of word indices that rhyme together",
    "paras": "list of bar indices that start a new verse/paragraph",
    "types": "map of word index (string) -> one of end|internal|slant|multi",
}

_INSTRUCTIONS = (
    "You are annotating a freestyle rap transcript. Each item in `words` is one word "
    "with its index `i`, `text`, timing, and phonetic keys: `canonical` (dictionary "
    "pronunciation) and `delivered` (how it was actually rapped). `bar` is a suggested "
    "bar index. Group words that rhyme (use `delivered` for slant/forced rhymes), split "
    "the transcript into bars, mark verse starts in `paras`, and tag each rhyming word's "
    "type in `types`. Return ONLY JSON in the shape described by `annotation_schema`."
)


def build_bundle(analysis: dict, video_id: str | None = None) -> dict:
    """Distill an analysis payload into a compact bundle for Claude Code.

    `analysis` is the `GET /api/videos/{id}/analysis` response (VideoAnalysisDto).
    Each word gets a `canonical` and `delivered` phonetic key: from its rhyme event
    when present, else falling back to the word's own `ipa` / `deliveredIpa`. Null
    keys are omitted to keep the bundle compact."""
    events_by_word = {e["wordIndex"]: e for e in analysis.get("events", [])}

    words = []
    for w in analysis.get("words", []):
        i = w["wordIndex"]
        ev = events_by_word.get(i)
        entry: dict = {"i": i, "text": w.get("text", "")}

        canonical = (ev or {}).get("canonicalKey") or w.get("ipa")
        delivered = (ev or {}).get("deliveredKey") or w.get("deliveredIpa")
        if canonical:
            entry["canonical"] = canonical
        if delivered:
            entry["delivered"] = delivered
        if ev is not None and ev.get("barIndex") is not None:
            entry["bar"] = ev["barIndex"]
        words.append(entry)

    vid = video_id or analysis.get("video", {}).get("id")
    return {
        "video_id": vid,
        "instructions": _INSTRUCTIONS,
        "annotation_schema": ANNOTATION_SCHEMA,
        "words": words,
    }


def _send(method: str, url: str, opener, data: bytes | None = None,
          headers: dict | None = None) -> tuple[int, bytes]:
    """Issue one HTTP request via the injectable `opener` (default urlopen)."""
    opener = opener or urllib.request.urlopen
    req = urllib.request.Request(url, data=data, method=method, headers=headers or {})
    resp = opener(req)
    try:
        body = resp.read()
        status = getattr(resp, "status", None)
        if status is None:
            status = resp.getcode()
    finally:
        close = getattr(resp, "close", None)
        if close is not None:
            close()
    return status, body


def fetch_analysis(video_id: str, base_url: str = DEFAULT_BASE_URL, opener=None) -> dict:
    """GET /api/videos/{id}/analysis and return the parsed JSON payload."""
    url = f"{base_url.rstrip('/')}/api/videos/{video_id}/analysis"
    _status, body = _send("GET", url, opener)
    return json.loads(body)


def push_draft(video_id: str, annotation: dict, base_url: str = DEFAULT_BASE_URL,
               opener=None) -> int:
    """PUT a Claude-Code-produced annotation to /api/videos/{id}/ai-draft.

    Validates the annotation carries at least `bars` and `groups` (UserAnnotationDto)
    before sending. Returns the HTTP status code. This only ever writes the AI draft;
    the backend keeps it separate from the user's saved annotation."""
    for required in ("bars", "groups"):
        if required not in annotation:
            raise ValueError(f"annotation is missing required key {required!r}")

    url = f"{base_url.rstrip('/')}/api/videos/{video_id}/ai-draft"
    data = json.dumps(annotation).encode("utf-8")
    status, _body = _send("PUT", url, opener, data=data,
                          headers={"Content-Type": "application/json"})
    return status


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(
        description="Dump a prompt bundle for Claude Code, or push its annotation as an AI draft.")
    ap.add_argument("video_id", help="video id (e.g. vjb7TegEIYs)")
    ap.add_argument("--base-url", default=DEFAULT_BASE_URL, help="backend base URL")
    ap.add_argument("--out", help="write the bundle JSON here (default: stdout)")
    ap.add_argument("--push", metavar="FILE",
                    help="PUT this annotation JSON file to /ai-draft instead of dumping a bundle")
    args = ap.parse_args(argv)

    if args.push:
        annotation = json.loads(open(args.push, encoding="utf-8").read())
        status = push_draft(args.video_id, annotation, base_url=args.base_url)
        print(f"PUT /ai-draft -> {status}")
        return 0 if 200 <= status < 300 else 1

    analysis = fetch_analysis(args.video_id, base_url=args.base_url)
    bundle = build_bundle(analysis, video_id=args.video_id)
    text = json.dumps(bundle, indent=2, ensure_ascii=False)
    if args.out:
        with open(args.out, "w", encoding="utf-8") as fh:
            fh.write(text)
        print(f"wrote bundle for {args.video_id} ({len(bundle['words'])} words) -> {args.out}")
    else:
        print(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

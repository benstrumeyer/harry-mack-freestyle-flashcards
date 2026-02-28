# Future Improvements

## Typographic Emphasis for Rap Articulation

### What it is

When displaying bars (openers, flashcards, dictionary entries), automatically apply **bold** and *italic* formatting to words based on their role in the bar — so the text itself communicates how to deliver it, the same way a rapper would stress certain syllables or punch certain words when performing.

### Why

Reading rap bars as plain text loses the performance intent. The way a word is *said* carries meaning — the stress pattern, the punch, the stretched syllable. Encoding that into typography lets you read a bar and already feel the right delivery before you open your mouth.

### Rules

| Emphasis | Applied to | Rationale |
|----------|-----------|-----------|
| **Bold** | Rhyme words (end-of-bar rhymes) | The rhyme is the punch — it lands hard, always stressed |
| **Bold** | Alliterative words in a cluster (2+ consecutive same-letter starts) | Alliteration gets leaned into; the repeated sound gets weight |
| *Italic* | Filler/glue words used for rhythm ("on the", "in a", "with the") | These are light, fast, almost whispered — italics show they're de-emphasized |
| *Italic* | Stretch words — multi-syllable words that carry the flow between punches | Italics signal elongation, the held note feel |
| **Bold** *Italic* | Subject word in the opener (the topic word given by the audience) | It's the anchor of the whole bar — maximum weight + distinction |

### How it works

The LLM already identifies `rhyme_word`, `opener`, and `rhyme_key` per bar. Extend the extraction to also return:

```json
{
  "emphasis_map": {
    "rhyme_word": "care",
    "alliterative_cluster": ["born", "be", "bound"],
    "filler_words": ["in a", "where the"],
    "subject_word": "world"
  }
}
```

The frontend then applies Tailwind typography classes (`font-bold`, `italic`) to each token when rendering bar text — no manual tagging needed.

### Display example

Bar text as plain text:
```
I was born in a world where the people don't care
```

Bar text with typographic emphasis:
```
I was **born** *in a* **world** *where the* people don't **care**
```

Rendered: I was **born** *in a* **world** *where the* people don't **care**

### Where it applies

- Flashcard page — the full bar shown after tapping
- Opener Dictionary — bar preview text under each opener
- Rhyme Dictionary — bar examples shown when a word is tapped

### Implementation path

1. Extend `LlmExtractor` prompt to return `emphasis_map` alongside existing fields
2. Add `EmphasisMap` to `ExtractedBar` model and persist it (JSONB column on `bars` table)
3. Add a `renderEmphasisBar(text, emphasisMap)` utility in the frontend that tokenizes the bar and wraps tokens in `<strong>` / `<em>` based on the map
4. Swap plain text renders for `renderEmphasisBar` in `FlashcardPage`, `OpenerDictionaryPage`, `RhymeDictionaryPage`

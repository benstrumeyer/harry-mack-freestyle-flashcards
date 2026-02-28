using System.Text.RegularExpressions;
using HarryMack.Api.Models;

namespace HarryMack.Api.Services;

public class TranscriptParser
{
    private static readonly Regex TimestampPattern = new(@"^\[(\d+):(\d{2})\]\s*(.+)$");
    private static readonly Regex FreestyleHeader = new(@"^\[FREESTYLE\s*-\s*""(.*)""");
    private static readonly Regex SegmentHeader = new(@"^---\s*SEGMENT");

    public List<RawLine> ParseLocalTxt(string filePath)
    {
        var lines = File.ReadAllLines(filePath);
        var result = new List<RawLine>();
        bool insideFreestyle = false;
        int index = 0;

        foreach (var line in lines)
        {
            var trimmed = line.Trim();

            if (FreestyleHeader.IsMatch(trimmed))
            {
                insideFreestyle = true;
                continue;
            }

            if (SegmentHeader.IsMatch(trimmed))
            {
                insideFreestyle = false;
                continue;
            }

            if (!insideFreestyle) continue;

            if (string.IsNullOrWhiteSpace(trimmed)) continue;

            var match = TimestampPattern.Match(trimmed);
            if (match.Success)
            {
                var minutes = int.Parse(match.Groups[1].Value);
                var seconds = int.Parse(match.Groups[2].Value);
                var text = match.Groups[3].Value.Trim();
                result.Add(new RawLine(text, minutes * 60f + seconds, index++));
            }
            else
            {
                // Non-timestamped line inside a freestyle section — include it
                result.Add(new RawLine(trimmed, null, index++));
            }
        }

        return result;
    }

    // YouTube auto-captions use a rolling window: each VTT cue shows the 3-6 words
    // currently on screen. Consecutive cues heavily overlap (e.g. "I'm the best in" →
    // "best in the game"). This method reconstructs full lines by:
    //  1. Finding the word overlap between consecutive cues and keeping only novel words.
    //  2. Grouping the resulting word stream into lines by timestamp gaps.
    public List<RawLine> ParseVtt(string filePath)
    {
        var lines = File.ReadAllLines(filePath);
        var vttTimestamp = new Regex(@"^(\d{2}):(\d{2}):(\d{2})\.\d+ -->");
        var htmlTag = new Regex(@"<[^>]+>");

        // Pass 1: collect raw (timestamp, text) cues
        var cues = new List<(float ts, string text)>();
        float? currentTs = null;

        foreach (var raw in lines)
        {
            var trimmed = raw.Trim();
            if (string.IsNullOrWhiteSpace(trimmed) || trimmed == "WEBVTT" || trimmed.StartsWith("NOTE"))
            {
                currentTs = null;
                continue;
            }

            var tsMatch = vttTimestamp.Match(trimmed);
            if (tsMatch.Success)
            {
                var h = int.Parse(tsMatch.Groups[1].Value);
                var m = int.Parse(tsMatch.Groups[2].Value);
                var s = int.Parse(tsMatch.Groups[3].Value);
                currentTs = h * 3600f + m * 60f + s;
                continue;
            }

            if (int.TryParse(trimmed, out _)) continue;

            if (currentTs.HasValue)
            {
                // Strip HTML timing tags YouTube embeds (<c>, <00:00:10.240>, etc.)
                var clean = htmlTag.Replace(trimmed, " ").Trim();
                clean = Regex.Replace(clean, @"\s{2,}", " ").Trim();
                if (!string.IsNullOrWhiteSpace(clean))
                    cues.Add((currentTs.Value, clean));
            }
        }

        // Pass 2: build a word stream, keeping only words not overlapping with previous cue
        var wordStream = new List<(string word, float ts)>();
        string[] prevWords = [];

        foreach (var (ts, text) in cues)
        {
            var currWords = text.Split(' ', StringSplitOptions.RemoveEmptyEntries);
            if (currWords.Length == 0) continue;

            // Find longest N such that prevWords ends with currWords[0..N-1]
            int overlap = 0;
            int maxCheck = Math.Min(prevWords.Length, currWords.Length);
            for (int n = maxCheck; n >= 1; n--)
            {
                bool match = true;
                for (int k = 0; k < n; k++)
                {
                    if (!prevWords[prevWords.Length - n + k].Equals(currWords[k], StringComparison.OrdinalIgnoreCase))
                    {
                        match = false;
                        break;
                    }
                }
                if (match) { overlap = n; break; }
            }

            for (int i = overlap; i < currWords.Length; i++)
                wordStream.Add((currWords[i], ts));

            prevWords = currWords;
        }

        // Pass 3: group words into lines by timestamp gap (gap > 2s = new line)
        const float LineGapSeconds = 2.0f;
        var result = new List<RawLine>();
        if (wordStream.Count == 0) return result;

        var lineWords = new List<string>();
        float lineTs = wordStream[0].ts;
        int index = 0;

        for (int i = 0; i < wordStream.Count; i++)
        {
            var (word, ts) = wordStream[i];
            lineWords.Add(word);

            bool isLast = i == wordStream.Count - 1;
            bool hasGap = !isLast && (wordStream[i + 1].ts - ts > LineGapSeconds);

            if (hasGap || isLast)
            {
                var lineText = string.Join(" ", lineWords).Trim();
                if (!string.IsNullOrWhiteSpace(lineText))
                    result.Add(new RawLine(lineText, lineTs, index++));
                lineWords.Clear();
                if (!isLast) lineTs = wordStream[i + 1].ts;
            }
        }

        return result;
    }
}

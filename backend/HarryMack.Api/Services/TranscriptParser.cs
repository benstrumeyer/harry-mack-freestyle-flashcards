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
}

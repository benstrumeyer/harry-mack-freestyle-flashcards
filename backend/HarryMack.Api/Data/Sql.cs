using System.Globalization;

namespace HarryMack.Api.Data;

public static class Sql
{
    // SQLite stores our timestamps as TEXT (datetime('now') → UTC "YYYY-MM-DD HH:MM:SS").
    public static DateTimeOffset Ts(string s) =>
        DateTimeOffset.Parse(s, CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal);
}

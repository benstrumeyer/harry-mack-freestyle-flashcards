using HarryMack.Api.Services;
using Npgsql;
using OpenAI;
using OpenAI.Chat;
using System.ClientModel;

var builder = WebApplication.CreateBuilder(args);

// PostgreSQL
var connectionString = builder.Configuration.GetConnectionString("Default")
    ?? throw new InvalidOperationException("ConnectionStrings:Default is required.");
var dataSource = NpgsqlDataSource.Create(connectionString);
builder.Services.AddSingleton(dataSource);

// Gemini (via OpenAI-compatible API)
var geminiKey = builder.Configuration["GEMINI_API_KEY"]
    ?? Environment.GetEnvironmentVariable("GEMINI_API_KEY")
    ?? throw new InvalidOperationException("GEMINI_API_KEY is required.");
var geminiOptions = new OpenAIClientOptions
{
    Endpoint = new Uri("https://generativelanguage.googleapis.com/v1beta/openai/"),
    NetworkTimeout = TimeSpan.FromMinutes(5)
};
var chatClient = new OpenAIClient(new ApiKeyCredential(geminiKey), geminiOptions)
    .GetChatClient("gemini-2.5-flash");
builder.Services.AddSingleton(chatClient);

// Services
builder.Services.AddSingleton<TranscriptParser>();
builder.Services.AddSingleton<LlmExtractor>();
builder.Services.AddSingleton<PhoneticService>();
builder.Services.AddScoped<PipelineService>();

// Controllers + CORS
builder.Services.AddControllers();
builder.Services.AddCors(options =>
    options.AddDefaultPolicy(policy =>
        policy.AllowAnyOrigin().AllowAnyMethod().AllowAnyHeader()));

var app = builder.Build();

// Auto-migrate: add rhyme_word_bars if it doesn't exist yet
{
    await using var migConn = await dataSource.OpenConnectionAsync();
    await using var migCmd = migConn.CreateCommand();
    migCmd.CommandText = @"
        CREATE TABLE IF NOT EXISTS rhyme_word_bars (
            word_id UUID REFERENCES rhyme_words(id) ON DELETE CASCADE,
            bar_id  UUID REFERENCES bars(id) ON DELETE CASCADE,
            PRIMARY KEY (word_id, bar_id)
        )";
    await migCmd.ExecuteNonQueryAsync();
}

app.UseCors();
app.MapControllers();
app.Run();

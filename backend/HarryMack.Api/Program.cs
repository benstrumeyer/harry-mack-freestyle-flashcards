using HarryMack.Api.Data;
using HarryMack.Api.Services;
using OpenAI;
using OpenAI.Chat;
using System.ClientModel;

var builder = WebApplication.CreateBuilder(args);

// SQLite
var connectionString = builder.Configuration.GetConnectionString("Default")
    ?? "Data Source=freestyle.db";
builder.Services.AddSingleton(new Db(connectionString));

// Gemini (via OpenAI-compatible API) — optional; pipeline features require it
var geminiKey = builder.Configuration["GEMINI_API_KEY"]
    ?? Environment.GetEnvironmentVariable("GEMINI_API_KEY");
if (!string.IsNullOrEmpty(geminiKey))
{
    var geminiOptions = new OpenAIClientOptions
    {
        Endpoint = new Uri("https://generativelanguage.googleapis.com/v1beta/openai/"),
        NetworkTimeout = TimeSpan.FromMinutes(5)
    };
    var chatClient = new OpenAIClient(new ApiKeyCredential(geminiKey), geminiOptions)
        .GetChatClient("gemini-2.5-flash");
    builder.Services.AddSingleton(chatClient);
}
else
{
    Console.WriteLine("WARNING: GEMINI_API_KEY not set — pipeline features will be unavailable.");
}

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

// SQLite schema bootstrap (file auto-creates on first run)
await Db.InitSchemaAsync(connectionString);

app.UseCors();
app.MapControllers();
app.Run();

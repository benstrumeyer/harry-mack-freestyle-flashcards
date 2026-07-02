using HarryMack.Api.Data;
using HarryMack.Api.Services;

var builder = WebApplication.CreateBuilder(args);

// SQLite
var connectionString = builder.Configuration.GetConnectionString("Default")
    ?? "Data Source=freestyle.db";
builder.Services.AddSingleton(new Db(connectionString));

// Services
builder.Services.AddSingleton<PhoneticService>();
builder.Services.AddHttpClient<IExtractorClient, ExtractorClient>(c =>
    c.BaseAddress = new Uri(builder.Configuration["ExtractorBaseUrl"] ?? "http://localhost:8900"));
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

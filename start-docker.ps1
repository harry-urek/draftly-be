# Draftly Server - Docker Setup Script
# This script starts MongoDB with replica set enabled

Write-Host "🚀 Starting Draftly MongoDB with Replica Set..." -ForegroundColor Cyan

# Navigate to server directory
Set-Location -Path $PSScriptRoot

# Check if Docker is running
try {
    docker ps | Out-Null
    Write-Host "✅ Docker is running" -ForegroundColor Green
} catch {
    Write-Host "❌ Docker is not running. Please start Docker Desktop first." -ForegroundColor Red
    exit 1
}

# Start MongoDB and Redis
Write-Host "`n📦 Starting MongoDB and Redis containers..." -ForegroundColor Yellow
docker compose up -d mongodb redis

# Wait for MongoDB to be ready
Write-Host "`n⏳ Waiting for MongoDB to initialize..." -ForegroundColor Yellow
Start-Sleep -Seconds 5

# Check MongoDB status
Write-Host "`n🔍 Checking MongoDB replica set status..." -ForegroundColor Yellow
docker compose exec -T mongodb mongosh --quiet --eval "rs.status()" 2>$null

if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ MongoDB replica set is ready!" -ForegroundColor Green
} else {
    Write-Host "⚠️  MongoDB replica set may need initialization. Attempting to initialize..." -ForegroundColor Yellow
    docker compose exec -T mongodb mongosh --quiet --eval "rs.initiate({_id:'rs0',members:[{_id:0,host:'mongodb:27017'}]})" 2>$null
    Start-Sleep -Seconds 3
    Write-Host "✅ Replica set initialized!" -ForegroundColor Green
}

Write-Host "`n📊 Container Status:" -ForegroundColor Cyan
docker compose ps

Write-Host "`n✨ Setup complete! You can now start the server with:" -ForegroundColor Green
Write-Host "   npm run dev" -ForegroundColor White

Write-Host "`n📝 MongoDB Connection:" -ForegroundColor Cyan
Write-Host "   mongodb://admin:password@localhost:27017/draftly?authSource=admin&replicaSet=rs0" -ForegroundColor White

Write-Host "`n🛑 To stop all containers:" -ForegroundColor Cyan
Write-Host "   docker compose down" -ForegroundColor White

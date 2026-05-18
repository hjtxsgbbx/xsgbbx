#!/usr/bin/env pwsh
# agent_1 Daily Standup Script (PowerShell / Windows)

param(
    [switch]$Yesterday,
    [switch]$Blocker
)

$standupDir = ".github/standups"
$date = Get-Date -Format "yyyy-MM-dd"
$standupFile = "$standupDir/$date.md"
New-Item -ItemType Directory -Path $standupDir -Force | Out-Null

Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "  agent_1 Daily Standup — $date" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""

$yesterdayText = ""
$todayText = ""
$blockerText = ""

if (-not $Yesterday -and -not $Blocker) {
    Write-Host "  What did you work on YESTERDAY?" -ForegroundColor Yellow
    Write-Host "  (Type your answer and press Enter twice to finish)" -ForegroundColor Gray
    $yesterdayText = Read-Host "  > "
    if (-not $yesterdayText) { $yesterdayText = "(not provided)" }

    Write-Host ""
    Write-Host "  What will you work on TODAY?" -ForegroundColor Yellow
    Write-Host "  (Type your answer and press Enter)" -ForegroundColor Gray
    $todayText = Read-Host "  > "
    if (-not $todayText) { $todayText = "(not provided)" }

    Write-Host ""
    Write-Host "  Any BLOCKERS or impediments?" -ForegroundColor Yellow
    Write-Host "  (Type 'none' if nothing is blocking you)" -ForegroundColor Gray
    $blockerText = Read-Host "  > "
    if (-not $blockerText) { $blockerText = "None" }
} elseif ($Yesterday) {
    Write-Host "  Yesterday's summary:" -ForegroundColor Yellow
    $yesterdayText = Read-Host "  > "
    if (-not $yesterdayText) { $yesterdayText = "(not provided)" }
    $todayText = "(add today's plan)"
    $blockerText = "(add blockers if any)"
} elseif ($Blocker) {
    Write-Host "  What is blocking you?" -ForegroundColor Red
    $blockerText = Read-Host "  > "
    if (-not $blockerText) { $blockerText = "(not provided)" }
    $yesterdayText = "(add yesterday's work)"
    $todayText = "(add today's plan)"
}

$standupContent = @"
# Daily Standup — $date

## Yesterday
$yesterdayText

## Today
$todayText

## Blockers
$blockerText

---
*Submitted: $(Get-Date -Format 'HH:mm')*
"@

Set-Content -Path $standupFile -Value $standupContent

Write-Host ""
Write-Host "  Standup saved to: $standupFile" -ForegroundColor Green
Write-Host ""
Write-Host "  Daily Standup Checklist:" -ForegroundColor Cyan
Write-Host "  ----------------------------------------" -ForegroundColor Cyan
Write-Host "  [ ] Check CI pipeline status" -ForegroundColor Gray
Write-Host "  [ ] Review open PRs and reviews requested" -ForegroundColor Gray
Write-Host "  [ ] Check benchmark report from last run" -ForegroundColor Gray
Write-Host "  [ ] Update sprint burndown (npm run sprint:report)" -ForegroundColor Gray
Write-Host "  [ ] Note any user feedback received" -ForegroundColor Gray
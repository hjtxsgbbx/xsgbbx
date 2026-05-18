#!/usr/bin/env pwsh
# agent_1 Feedback Collector
# Collects, categorizes, and summarizes user feedback for sprint planning

param(
    [string]$Since = (Get-Date).AddDays(-14).ToString("yyyy-MM-dd")
)

Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "  agent_1 Feedback Collector" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""

$feedbackDir = ".github/feedback"
$collectedFile = "$feedbackDir/feedback-collected.json"
New-Item -ItemType Directory -Path $feedbackDir -Force | Out-Null

if (-not (Test-Path $collectedFile)) {
    @{ feedback = @(); collectedAt = $null; totalFeedback = 0; sentimentDistribution = @{ positive = 0; neutral = 0; negative = 0 } } | ConvertTo-Json -Depth 4 | Set-Content $collectedFile -NoNewline
}

Write-Host "  Feedback Collection Period: $Since → $(Get-Date -Format 'yyyy-MM-dd')" -ForegroundColor Yellow
Write-Host ""

Write-Host "  Sources:" -ForegroundColor Yellow
Write-Host "    - GitHub Issues (label: user-feedback)" -ForegroundColor Gray
Write-Host "    - Desktop/Web FeedbackButton submissions" -ForegroundColor Gray
Write-Host "    - Sprint retrospective notes" -ForegroundColor Gray
Write-Host "    - Direct user interviews" -ForegroundColor Gray
Write-Host ""

Write-Host "  Enter feedback items (one per entry, empty line to finish):" -ForegroundColor Yellow
Write-Host "  Format: category | sentiment (😊😐😞) | description" -ForegroundColor Gray
Write-Host ""

$items = @()
while ($true) {
    $input = Read-Host "  "
    if (-not $input.Trim()) { break }
    $parts = $input -split '\s*\|\s*', 3
    if ($parts.Length -ge 2) {
        $items += @{
            category = $parts[0].Trim()
            sentiment = $parts[1].Trim()
            description = if ($parts.Length -ge 3) { $parts[2].Trim() } else { "" }
            date = Get-Date -Format "yyyy-MM-dd"
        }
    }
}

$existing = Get-Content $collectedFile -Raw | ConvertFrom-Json
$existing.feedback += $items
$existing.collectedAt = Get-Date -Format "yyyy-MM-dd HH:mm"
$existing.totalFeedback = $existing.feedback.Count

$pos = ($existing.feedback | Where-Object { $_.sentiment -match "😊|positive" }).Count
$neu = ($existing.feedback | Where-Object { $_.sentiment -match "😐|neutral" }).Count
$neg = ($existing.feedback | Where-Object { $_.sentiment -match "😞|negative" }).Count
$existing.sentimentDistribution = @{ positive = $pos; neutral = $neu; negative = $neg }

$existing | ConvertTo-Json -Depth 5 | Set-Content $collectedFile -NoNewline

Write-Host ""
Write-Host "  Collected: $($items.Count) items" -ForegroundColor Green
Write-Host "  Total:     $($existing.totalFeedback) items" -ForegroundColor Green
Write-Host "  Pos: $pos | Neu: $neu | Neg: $neg" -ForegroundColor Green
Write-Host ""
Write-Host "  Summary Report:" -ForegroundColor Cyan

$byCategory = $items | Group-Object -Property category
foreach ($group in $byCategory) {
    Write-Host "    $($group.Name): $($group.Count) items" -ForegroundColor Gray
    foreach ($item in $group.Group) {
        $sentimentIcon = switch -Regex ($item.sentiment) {
            "😊|positive" { "😊" }
            "😐|neutral" { "😐" }
            "😞|negative" { "😞" }
            default { "❓" }
        }
        Write-Host "      $sentimentIcon $($item.description)" -ForegroundColor Gray
    }
}

Write-Host ""
Write-Host "  Feedback saved to: $collectedFile" -ForegroundColor Green

$report = @"
# Feedback Collection Report — $(Get-Date -Format 'yyyy-MM-dd')

**Period**: $Since → $(Get-Date -Format 'yyyy-MM-dd')
**Total Items**: $($existing.totalFeedback)

## Sentiment Distribution
- 😊 Positive: $pos
- 😐 Neutral: $neu
- 😞 Negative: $neg

## By Category
$(
  ($byCategory | ForEach-Object {
    "- **$($_.Name)**: $($_.Count) items"
  }) -join "`n"
)

## Action Items
$(
  ($items | Where-Object { $_.sentiment -match "😞|negative" } | ForEach-Object {
    "- [ ] Address: $($_.description) ($($_.category))"
  }) -join "`n"
)
"@

$reportFile = "$feedbackDir/report-$(Get-Date -Format 'yyyy-MM-dd').md"
$report | Set-Content $reportFile
Write-Host "  Report saved to: $reportFile" -ForegroundColor Green
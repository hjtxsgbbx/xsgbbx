#!/usr/bin/env pwsh
# agent_1 Version Bump & Changelog Generator (PowerShell)
# Usage: pwsh scripts/version.ps1 [major|minor|patch]

param([string]$BumpType = "patch")

Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "  agent_1 Version Manager" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""

$pkg = Get-Content package.json | ConvertFrom-Json
$currentVersion = $pkg.version
Write-Host "  Current version: $currentVersion"
Write-Host "  Bump type:       $BumpType"

$parts = $currentVersion -split '\.'
$major = [int]$parts[0]; $minor = [int]$parts[1]; $patch = [int]$parts[2]

switch ($BumpType) {
    "major" { $newMajor = $major + 1; $newVersion = "$newMajor.0.0" }
    "minor" { $newMinor = $minor + 1; $newVersion = "$major.$newMinor.0" }
    default { $newPatch = $patch + 1; $newVersion = "$major.$minor.$newPatch" }
}

Write-Host "  New version:     $newVersion"

$date = Get-Date -Format "yyyy-MM-dd"

$changelogEntry = @"
## [$newVersion] - $date

### Added
- 

### Changed
- 

### Fixed
- 

### Deprecated
- 

### Removed
- 

### Security
- 
"@

if (Test-Path CHANGELOG.md) {
    $existing = Get-Content CHANGELOG.md -Raw
    $header = ""
    if ($existing -match "^(# Changelog.*?\n)") {
        $header = $matches[1]
    }
    $changelogEntry + "`n" + $existing | Set-Content CHANGELOG.md -NoNewline
} else {
    "# Changelog`n`n$changelogEntry" | Set-Content CHANGELOG.md -NoNewline
}

$pkg.version = $newVersion
$pkg | ConvertTo-Json -Depth 10 | Set-Content package.json -NoNewline
Add-Content package.json "`n"

Write-Host ""
Write-Host "  Updated:" -ForegroundColor Green
Write-Host "    - package.json -> $newVersion"
Write-Host "    - CHANGELOG.md (entry added)"
Write-Host ""
Write-Host "  Next steps:"
Write-Host "    1. Edit CHANGELOG.md to fill in changes"
Write-Host "    2. git add package.json CHANGELOG.md"
Write-Host '    3. git commit -m "chore(release): bump version to $newVersion"'
Write-Host "    4. git tag `"v$newVersion`""
Write-Host "    5. git push --tags"
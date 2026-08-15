# GRUNDO — biztonsági szabályok élesítése
#
# FONTOS: a Firestore- és a Storage-szabályokat KÜLÖN kell deployolni.
# A `firebase deploy --only firestore:rules` önmagában NEM frissíti a
# storage.rules fájlt — ez már okozott fejtörést korábbi projektben.
#
# Használat:
#   .\scripts\deploy-rules.ps1            # dev projektre
#   .\scripts\deploy-rules.ps1 -Env prod  # élesre (megerősítést kér)

param(
    [ValidateSet('dev', 'prod')]
    [string]$Env = 'dev'
)

$ErrorActionPreference = 'Stop'

Write-Host "Cél környezet: $Env" -ForegroundColor Cyan
Write-Host "Firestore adatbázis: grundo-db (NEM a default!)" -ForegroundColor Yellow

if ($Env -eq 'prod') {
    $answer = Read-Host "Éles környezetre deployolsz. Írd be a 'IGEN' szót a folytatáshoz"
    if ($answer -ne 'IGEN') {
        Write-Host "Megszakítva." -ForegroundColor Red
        exit 1
    }
}

firebase use $Env
if (-not $?) { throw "A projekt kiválasztása nem sikerült." }

Write-Host "`n[1/3] Firestore szabályok..." -ForegroundColor Green
firebase deploy --only firestore:rules
if (-not $?) { throw "A Firestore szabályok deployja nem sikerült." }

Write-Host "`n[2/3] Firestore indexek..." -ForegroundColor Green
firebase deploy --only firestore:indexes
if (-not $?) { throw "Az indexek deployja nem sikerült." }

Write-Host "`n[3/3] Storage szabályok..." -ForegroundColor Green
firebase deploy --only storage
if (-not $?) { throw "A Storage szabályok deployja nem sikerült." }

Write-Host "`nKész." -ForegroundColor Green

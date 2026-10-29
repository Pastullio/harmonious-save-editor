# Harmonious Save Editor: collect the No Man's Sky files needed to build our own item library.
#
# Finds your No Man's Sky install through Steam, downloads HGPAKtool (MIT licence, by monkeyman192,
# https://github.com/monkeyman192/HGPAKtool) to read the game's .pak archives, and pulls out only:
#   - the item tables (METADATA/REALITY/TABLES) and stat tables (METADATA/GAMESTATE/STATS)
#   - the English text (LANGUAGE/*ENGLISH*)
#   - a sample of the item icons (TEXTURES/UI/FRONTEND/ICONS), plus a list of all of them
#   - the list of every file in every .pak (no contents)
# and zips them onto your Desktop. Nothing in the game folder is changed.
#
# Run it by double-clicking extract-nms-item-files.bat next to this file.

param(
    [string]$GameDir = '',      # the "No Man's Sky" folder, if it can't be found automatically
    [string]$HgpakTool = '',    # a hgpaktool.exe you already have
    [string]$OutDir = ''        # where the zip goes (default: your Desktop)
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # makes downloads much faster in Windows PowerShell

function Say($text) { Write-Host $text }
function Fail($text) { Write-Host ''; Write-Host $text -ForegroundColor Red; exit 1 }

# ---------------------------------------------------------------- 1. find the game
function Find-SteamRoots {
    $roots = @()
    foreach ($key in 'HKCU:\Software\Valve\Steam', 'HKLM:\SOFTWARE\WOW6432Node\Valve\Steam', 'HKLM:\SOFTWARE\Valve\Steam') {
        try {
            $p = Get-ItemProperty -Path $key -ErrorAction Stop
            if ($p.SteamPath) { $roots += ($p.SteamPath -replace '/', '\') }
            if ($p.InstallPath) { $roots += $p.InstallPath }
        } catch { }
    }
    $roots += 'C:\Program Files (x86)\Steam', 'C:\Program Files\Steam'
    $all = @()
    foreach ($r in ($roots | Select-Object -Unique)) {
        if (-not (Test-Path $r)) { continue }
        $all += $r
        $vdf = Join-Path $r 'steamapps\libraryfolders.vdf'
        if (Test-Path $vdf) {
            foreach ($m in [regex]::Matches((Get-Content $vdf -Raw), '"path"\s+"([^"]+)"')) {
                $all += ($m.Groups[1].Value -replace '\\\\', '\')
            }
        }
    }
    return $all | Select-Object -Unique
}

if (-not $GameDir) {
    foreach ($lib in Find-SteamRoots) {
        $c = Join-Path $lib "steamapps\common\No Man's Sky"
        if (Test-Path (Join-Path $c 'GAMEDATA\PCBANKS')) { $GameDir = $c; break }
    }
}
if (-not $GameDir) {
    Say "Couldn't find No Man's Sky through Steam."
    $GameDir = Read-Host "Paste the path of your No Man's Sky folder (the one that contains GAMEDATA)"
    $GameDir = $GameDir.Trim('"', ' ')
}
$banks = Join-Path $GameDir 'GAMEDATA\PCBANKS'
if (-not (Test-Path $banks)) { Fail "There's no GAMEDATA\PCBANKS folder in $GameDir." }
Say "Game files: $banks"

# ---------------------------------------------------------------- 2. get HGPAKtool
$work = Join-Path ([IO.Path]::GetTempPath()) 'hse-nms-extract'
if (Test-Path $work) { Remove-Item $work -Recurse -Force }
New-Item -ItemType Directory -Path $work | Out-Null

if (-not $HgpakTool) {
    Say 'Downloading HGPAKtool from GitHub...'
    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        $rel = Invoke-RestMethod -Uri 'https://api.github.com/repos/monkeyman192/HGPAKtool/releases/latest' -Headers @{ 'User-Agent' = 'HarmoniousSaveEditor' }
    } catch { Fail "Couldn't reach GitHub to download HGPAKtool: $($_.Exception.Message)" }
    $asset = $rel.assets | Where-Object { $_.name -match '\.exe$' -and $_.name -notmatch 'linux|mac' } | Select-Object -First 1
    if (-not $asset) { $asset = $rel.assets | Where-Object { $_.name -match 'win' } | Select-Object -First 1 }
    if (-not $asset) { Fail "Couldn't find a Windows download in HGPAKtool's latest release ($($rel.tag_name))." }
    $dl = Join-Path $work $asset.name
    Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $dl -Headers @{ 'User-Agent' = 'HarmoniousSaveEditor' }
    if ($dl -match '\.zip$') {
        Expand-Archive -Path $dl -DestinationPath (Join-Path $work 'tool') -Force
        $HgpakTool = (Get-ChildItem (Join-Path $work 'tool') -Recurse -Filter '*.exe' | Select-Object -First 1).FullName
    } else { $HgpakTool = $dl }
    Say "Using HGPAKtool $($rel.tag_name)"
}
if (-not (Test-Path $HgpakTool)) { Fail "HGPAKtool wasn't found at $HgpakTool." }

# ---------------------------------------------------------------- 3. list every pak, then pull out what we need
Push-Location $work
try {
    Say 'Listing what is inside the game archives (about a minute)...'
    & $HgpakTool -U -L -q $banks
    if (-not (Test-Path (Join-Path $work 'filenames.json'))) { Fail 'HGPAKtool did not produce a file list. Is the game up to date (5.50 or later)?' }

    Say 'Extracting item tables, English text and icons (a few minutes)...'
    $ext = Join-Path $work 'EXTRACTED'
    & $HgpakTool -U -q -O $ext `
        -f '*metadata/reality/tables/*' `
        -f '*metadata/gamestate/stats/*' `
        -f '*language/*english*' `
        -f '*textures/ui/frontend/icons/*' `
        $banks
} finally { Pop-Location }

# ---------------------------------------------------------------- 4. pack it up
$pack = Join-Path $work 'pack'
New-Item -ItemType Directory -Path $pack | Out-Null
Copy-Item (Join-Path $work 'filenames.json') $pack

$all = @(Get-ChildItem $ext -Recurse -File)
$tables = $all | Where-Object { $_.FullName -match '[\\/](tables|stats)[\\/]' }
$lang = $all | Where-Object { $_.FullName -match '[\\/]language[\\/]' }
$icons = $all | Where-Object { $_.FullName -match '[\\/]icons[\\/]' }
if (-not $tables) { Fail ("No item tables were extracted. Send Claude the file filenames.json from $work instead.") }

function Copy-Keep($file) {
    $rel = $file.FullName.Substring($ext.Length).TrimStart('\', '/')
    $dest = Join-Path $pack $rel
    New-Item -ItemType Directory -Path (Split-Path $dest) -Force | Out-Null
    Copy-Item $file.FullName $dest
}
$tables | ForEach-Object { Copy-Keep $_ }
$lang | ForEach-Object { Copy-Keep $_ }

# every icon's path and size, and a sample of up to 30 per folder (600 at most) so the zip stays small
$icons | ForEach-Object { "{0}`t{1}" -f $_.FullName.Substring($ext.Length).TrimStart('\', '/'), $_.Length } | Set-Content (Join-Path $pack 'icons-index.txt') -Encoding UTF8
$sample = @()
foreach ($grp in ($icons | Group-Object DirectoryName)) { $sample += ($grp.Group | Select-Object -First 30) }
$sample | Select-Object -First 600 | ForEach-Object { Copy-Keep $_ }

@(
    "No Man's Sky folder: $GameDir"
    "Files extracted: $($all.Count) (tables $(@($tables).Count), language $(@($lang).Count), icons $(@($icons).Count))"
    "Icons in the zip: $([Math]::Min(@($sample).Count, 600))"
    "Created: $(Get-Date -Format s)"
) | Set-Content (Join-Path $pack 'about.txt') -Encoding UTF8

if (-not $OutDir) { $OutDir = [Environment]::GetFolderPath('Desktop') }
$zip = Join-Path $OutDir 'NMS item files for Harmonious.zip'
if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path (Join-Path $pack '*') -DestinationPath $zip
$mb = [Math]::Round((Get-Item $zip).Length / 1MB, 1)

Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
Say ''
Write-Host "Done. Made $zip ($mb MB)." -ForegroundColor Green
Say 'Send that zip to Claude in the chat.'

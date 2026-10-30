# Harmonious Save Editor: collect the No Man's Sky model files needed to render real ships and
# multi-tools from the game's own models.
#
# Finds your No Man's Sky install through Steam, downloads HGPAKtool (MIT licence, by monkeyman192,
# https://github.com/monkeyman192/HGPAKtool) to read the game's .pak archives, and pulls out only the
# scene, descriptor and geometry files of the fighter ships and the multi-tools (no textures, materials
# or animations), then zips them onto your Desktop. Nothing in the game folder is changed.
#
# Run it by double-clicking extract-nms-model-files.bat next to this file.

param(
    [string]$GameDir = '',      # the "No Man's Sky" folder, if it can't be found automatically
    [string]$HgpakTool = '',    # a hgpaktool.exe you already have
    [string]$OutDir = '',       # where the zip goes (default: your Desktop)
    [string]$Sets = 'fighters,multitools'  # which model folders: fighters, multitools, freighters, exocraft, corvettes, baseparts
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
$work = Join-Path ([IO.Path]::GetTempPath()) 'hse-nms-models'
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

# ---------------------------------------------------------------- 3. pull out the model files
Push-Location $work
try {
    $folders = @{
        fighters   = 'models/common/spacecraft/fighters'
        multitools = 'models/common/weapons/multitool'
        freighters = 'models/common/spacecraft/industrial'
        exocraft   = 'models/common/vehicles'
        # corvette modules; the base-building parts (walls, pipes, lights…) corvettes also use are a separate set,
        # so each zip stays under the chat's upload limit
        corvettes  = 'models/common/spacecraft/biggs'
        baseparts  = 'models/planets/biomes/common/buildings/parts/buildableparts'
    }
    $args2 = @('-U', '-q', '-O', (Join-Path $work 'EXTRACTED'))
    foreach ($set in ($Sets -split ',')) {
        $f = $folders[$set.Trim()]
        if (-not $f) { Fail "Unknown set '$set'." }
        foreach ($folder in ($f -split '\|')) {
            foreach ($ext in '*.scene.mbin', '*.descriptor.mbin', '*.geometry.mbin.pc', '*.geometry.data.mbin.pc') { $args2 += @('-f', "*$folder/$ext") }
        }
    }
    Say "Extracting models ($Sets), a few minutes..."
    $ext = Join-Path $work 'EXTRACTED'
    & $HgpakTool @args2 $banks
} finally { Pop-Location }

# ---------------------------------------------------------------- 4. pack it up
$all = @(Get-ChildItem $ext -Recurse -File)
if (-not $all) { Fail 'No model files were extracted. Is the game up to date (5.50 or later)?' }
$total = [Math]::Round((($all | Measure-Object Length -Sum).Sum) / 1MB, 1)
@(
    "No Man's Sky folder: $GameDir"
    "Files extracted: $($all.Count) ($total MB)"
    "Created: $(Get-Date -Format s)"
) | Set-Content (Join-Path $ext 'about.txt') -Encoding UTF8

if (-not $OutDir) { $OutDir = [Environment]::GetFolderPath('Desktop') }
$zip = Join-Path $OutDir ("NMS model files for Harmonious (" + ($Sets -replace ',', ', ') + ").zip")
if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path (Join-Path $ext '*') -DestinationPath $zip
$mb = [Math]::Round((Get-Item $zip).Length / 1MB, 1)

Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
Say ''
Write-Host "Done. Made $zip ($mb MB)." -ForegroundColor Green
Say 'Send that zip to Claude in the chat.'

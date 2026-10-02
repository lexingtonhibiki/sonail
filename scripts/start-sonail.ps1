[CmdletBinding()]
param([int]$ApiPort=19100,[int]$UiPort=19101,[bool]$CompactHarness=$true,[switch]$Open)
$ErrorActionPreference='Stop'
$appRoot=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$sha=[Security.Cryptography.SHA256]::Create()
try{$instanceId=([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($appRoot.ToLowerInvariant())))).Replace('-','').Substring(0,12)}finally{$sha.Dispose()}
$startMutex=New-Object Threading.Mutex($false,"Local\Sonail.Start.$instanceId")
$held=$false
try{
try{$held=$startMutex.WaitOne(60000)}catch [Threading.AbandonedMutexException]{$held=$true}
if(-not $held){throw 'Another Sonail launch is still in progress; retry shortly'}
$runtimeDir=Join-Path $appRoot 'data/runtime'
New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
$nodeExe=(Get-Command node.exe).Source
if(-not(Test-Path -LiteralPath (Join-Path $appRoot 'packages/server/dist/index.js')) -or -not(Test-Path -LiteralPath (Join-Path $appRoot 'packages/client/dist/index.html')) -or -not(Test-Path -LiteralPath (Join-Path $appRoot 'shared/dist/workflow.js'))){throw 'Build missing. Run npm ci, then npm run build before starting Sonail.'}
$factsPath=Join-Path $runtimeDir 'processes.json'
$facts=@()
if(Test-Path -LiteralPath $factsPath){$facts=@(Get-Content -LiteralPath $factsPath -Raw | ConvertFrom-Json)}
function Start-Owned([string]$name,[int]$port,[string]$directory,[string[]]$arguments,[hashtable]$variables){
    $previous=$script:facts | Where-Object name -eq $name | Select-Object -Last 1
    if($previous){
        $existing=Get-CimInstance Win32_Process -Filter "ProcessId=$($previous.pid)"
        if($existing -and ([DateTimeOffset]$existing.CreationDate).ToUnixTimeMilliseconds() -eq ([DateTimeOffset]$previous.creationDate).ToUnixTimeMilliseconds() -and $existing.ExecutablePath -eq $previous.executablePath -and $existing.CommandLine -eq $previous.commandLine){if($previous.port -ne $port){throw "$name is already running on another port"};Write-Output "$name already running :$port"; return}
    }
    if(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue){throw "Port $port occupied. No other process stopped."}
    $saved=@{}
    try{
        foreach($key in $variables.Keys){$saved[$key]=[Environment]::GetEnvironmentVariable($key,'Process');[Environment]::SetEnvironmentVariable($key,$variables[$key],'Process')}
        $empty=Join-Path $runtimeDir 'stdin.empty';if(-not(Test-Path -LiteralPath $empty)){[IO.File]::WriteAllText($empty,'')}
        $argumentLine=($arguments | ForEach-Object {'"'+$_+'"'}) -join ' '
        $p=Start-Process -FilePath $nodeExe -ArgumentList $argumentLine -WorkingDirectory $directory -WindowStyle Hidden -PassThru -RedirectStandardInput $empty -RedirectStandardOutput (Join-Path $runtimeDir "$name.out.log") -RedirectStandardError (Join-Path $runtimeDir "$name.err.log")
    }finally{foreach($key in $saved.Keys){[Environment]::SetEnvironmentVariable($key,$saved[$key],'Process')}}
    Start-Sleep -Milliseconds 400
    $info=Get-CimInstance Win32_Process -Filter "ProcessId=$($p.Id)"
    if(-not $info){throw "$name exited. See $runtimeDir"}
    $script:facts=@($script:facts | Where-Object name -ne $name)+[pscustomobject]@{name=$name;pid=$info.ProcessId;creationDate=$info.CreationDate.ToString('o');executablePath=$info.ExecutablePath;commandLine=$info.CommandLine;port=$port}
    $script:facts | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $factsPath -Encoding utf8
    Write-Output "$name started :$port PID$($p.Id)"
}
$extraPath=if(Test-Path 'D:/DevTools/OpenCodeCLI/node_modules/opencode-ai/bin'){'D:\DevTools\OpenCodeCLI\node_modules\opencode-ai\bin;'}else{''}
$runtimeBunOptions=$env:BUN_OPTIONS
if($CompactHarness){$runtimeBunOptions=("$runtimeBunOptions --smol").Trim()}
$allowedRoots=@((Split-Path (Split-Path $appRoot -Parent) -Parent),$env:USERPROFILE,$env:TEMP)
if(Test-Path 'E:/Projects'){$allowedRoots+='E:/Projects'}
Start-Owned 'sonail-api' $ApiPort $appRoot @('packages/server/dist/index.js') @{BUN_OPTIONS=$runtimeBunOptions;AGENTBOARD_DISABLE_AGENT_STARTUP='1';HOST='127.0.0.1';PORT="$ApiPort";DB_PATH=(Join-Path $appRoot 'data/board.db');SONAIL_WORKFLOW_FILE=(Join-Path $appRoot 'data/workflow.json');AGENTBOARD_HOME=(Join-Path $appRoot 'data/home');PROJECTS_DIR=(Join-Path $appRoot 'data/projects');DATABASE_URL=$null;API_KEY=$null;SERVICE_TOKENS=$null;ALLOWED_REPO_ROOTS=($allowedRoots -join ',');ALLOWED_ORIGINS="http://127.0.0.1:$UiPort,http://localhost:$UiPort";OPENCODE_MODEL='opencode/space-bunny-free';PATH=($extraPath+$env:PATH)}
Start-Owned 'sonail-ui' $UiPort (Join-Path $appRoot 'packages/client') @((Join-Path $appRoot 'node_modules/vite/bin/vite.js'),'preview','--host','127.0.0.1','--port',"$UiPort",'--strictPort') @{HOST='127.0.0.1';API_URL="http://127.0.0.1:$ApiPort";VITE_API_KEY=$null}
$ready=$false
$readyDeadline=(Get-Date).AddSeconds(30)
do {
    try { $health=Invoke-WebRequest "http://127.0.0.1:$ApiPort/api/health" -UseBasicParsing -TimeoutSec 2; $ui=Invoke-WebRequest "http://127.0.0.1:$UiPort/workbench" -UseBasicParsing -TimeoutSec 2; $ready=($health.StatusCode -eq 200 -and $ui.StatusCode -eq 200) } catch {}
    if(-not $ready){Start-Sleep -Milliseconds 500}
}while(-not $ready -and (Get-Date) -lt $readyDeadline)
if(-not $ready){throw "Sonail did not become ready. See $runtimeDir; other processes were not stopped."}
Write-Output "Sonail ready: http://127.0.0.1:$UiPort/workbench"
if($Open){Start-Process "http://127.0.0.1:$UiPort/workbench"}
}finally{if($held){$startMutex.ReleaseMutex()};$startMutex.Dispose()}

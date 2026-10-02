$ErrorActionPreference='Stop'
$appRoot=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$factsPath=Join-Path $appRoot 'data/runtime/processes.json'
if(-not(Test-Path -LiteralPath $factsPath)){Write-Output 'No owned Sonail processes';exit 0}
$facts=@(Get-Content -LiteralPath $factsPath -Raw | ConvertFrom-Json)
foreach($fact in $facts){
    $info=Get-CimInstance Win32_Process -Filter "ProcessId=$($fact.pid)"
    if(-not $info){continue}
    if(([DateTimeOffset]$info.CreationDate).ToUnixTimeMilliseconds() -ne ([DateTimeOffset]$fact.creationDate).ToUnixTimeMilliseconds() -or $info.ExecutablePath -ne $fact.executablePath -or $info.CommandLine -ne $fact.commandLine){Write-Output "Identity changed; left PID$($fact.pid) alone";continue}
    taskkill.exe /PID $fact.pid /T /F | Out-Null
    Write-Output "Stopped owned $($fact.name)"
}

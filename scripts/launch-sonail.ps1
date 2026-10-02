[CmdletBinding()]
param([switch]$Open)
$ErrorActionPreference='Stop'
$appRoot=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$runtime=Join-Path $appRoot 'data/runtime'
New-Item -ItemType Directory -Path $runtime -Force | Out-Null
$log=Join-Path $runtime 'launcher.log'
try{
    Add-Content -LiteralPath $log -Value ((Get-Date).ToString('o')+' starting') -Encoding UTF8
    & (Join-Path $PSScriptRoot 'start-sonail.ps1') -Open:$Open
    Add-Content -LiteralPath $log -Value ((Get-Date).ToString('o')+' ready') -Encoding UTF8
}catch{
    $message='Sonail could not start: '+$_.Exception.Message+"`nLogs: "+$runtime
    Add-Content -LiteralPath $log -Value ((Get-Date).ToString('o')+' failed: '+$_.Exception.Message) -Encoding UTF8
    if($Open){Add-Type -AssemblyName System.Windows.Forms; [void][Windows.Forms.MessageBox]::Show($message,'Sonail')}
    Write-Error $message -ErrorAction Continue
    exit 1
}

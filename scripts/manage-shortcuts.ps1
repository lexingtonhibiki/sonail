[CmdletBinding()]
param(
    [ValidateSet('Status','EnableAutostart','DisableAutostart','CreateDesktop')][string]$Action='Status',
    [string]$StartupDirectory,
    [string]$DesktopDirectory
)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)
$appRoot=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$sha=[Security.Cryptography.SHA256]::Create()
try{$instanceId=([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($appRoot.ToLowerInvariant())))).Replace('-','').Substring(0,12).ToLowerInvariant()}finally{$sha.Dispose()}
if(-not $StartupDirectory){$StartupDirectory=[Environment]::GetFolderPath('Startup')}
if(-not $DesktopDirectory){$DesktopDirectory=[Environment]::GetFolderPath('Desktop')}
if(-not $StartupDirectory -or -not $DesktopDirectory){throw 'Windows user folders unavailable'}
$powershellPath=Join-Path $env:WINDIR 'System32/WindowsPowerShell/v1.0/powershell.exe'
$launcher=Join-Path $PSScriptRoot 'launch-sonail.ps1'
$baseArguments='-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "'+$launcher+'"'
$startupPath=Join-Path $StartupDirectory "Sonail-$instanceId.lnk"
$desktopPath=Join-Path $DesktopDirectory "Sonail-$instanceId.lnk"
$description="Sonail local workbench ($instanceId)"
$shell=New-Object -ComObject WScript.Shell
function Shortcut-State([string]$file,[string]$arguments){
    if(-not(Test-Path -LiteralPath $file)){return @{exists=$false;owned=$false}}
    try{
        $link=$shell.CreateShortcut($file)
        return @{exists=$true;owned=($link.TargetPath -eq $powershellPath -and $link.Arguments -ceq $arguments -and $link.Description -ceq $description)}
    }catch{return @{exists=$true;owned=$false}}
}
function Create-Owned([string]$file,[string]$arguments){
    $state=Shortcut-State $file $arguments
    if($state.exists -and -not $state.owned){throw 'Existing shortcut is not owned by this Sonail instance; left unchanged'}
    if($state.owned){return}
    $parent=Split-Path $file -Parent
    if(-not(Test-Path -LiteralPath $parent)){New-Item -ItemType Directory -Path $parent -Force | Out-Null}
    $link=$shell.CreateShortcut($file)
    $link.TargetPath=$powershellPath; $link.Arguments=$arguments; $link.WorkingDirectory=$appRoot
    $link.Description=$description; $link.WindowStyle=7; $link.Save()
}
$mutex=New-Object Threading.Mutex($false,"Local\Sonail.Shortcuts.$instanceId")
$held=$false
try{
    try{$held=$mutex.WaitOne(15000)}catch [Threading.AbandonedMutexException]{$held=$true}
    if(-not $held){throw 'Another shortcut operation is in progress'}
    if($Action -eq 'EnableAutostart'){Create-Owned $startupPath $baseArguments}
    elseif($Action -eq 'DisableAutostart'){
        $state=Shortcut-State $startupPath $baseArguments
        if($state.exists -and -not $state.owned){throw 'Startup shortcut identity mismatch; left unchanged'}
        if($state.owned){Remove-Item -LiteralPath $startupPath -Force}
    }
    elseif($Action -eq 'CreateDesktop'){Create-Owned $desktopPath ($baseArguments+' -Open')}
    $startup=Shortcut-State $startupPath $baseArguments
    $desktop=Shortcut-State $desktopPath ($baseArguments+' -Open')
    @{enabled=$startup.owned;conflict=($startup.exists -and -not $startup.owned);startupPath=$startupPath;desktopPath=$desktopPath;desktopExists=$desktop.owned} | ConvertTo-Json -Compress
}finally{if($held){$mutex.ReleaseMutex()};$mutex.Dispose();[void][Runtime.InteropServices.Marshal]::ReleaseComObject($shell)}

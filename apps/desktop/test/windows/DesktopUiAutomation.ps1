#Requires -Version 5.1

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("WaitForText", "CloseWindows")]
  [string] $Action,

  [Parameter(Mandatory = $true)]
  [int] $ProcessId,

  [string] $ExpectedText,
  [string] $ScreenshotPath,
  [int] $TimeoutSeconds = 30
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

function Get-ProcessWindows {
  $root = [Windows.Automation.AutomationElement]::RootElement
  $condition = [Windows.Automation.PropertyCondition]::new(
    [Windows.Automation.AutomationElement]::ProcessIdProperty,
    $ProcessId
  )
  return @($root.FindAll([Windows.Automation.TreeScope]::Children, $condition))
}

function Test-WindowContainsText {
  param(
    [Windows.Automation.AutomationElement] $Window,
    [string] $Text
  )

  $elements = $Window.FindAll(
    [Windows.Automation.TreeScope]::Subtree,
    [Windows.Automation.Condition]::TrueCondition
  )
  for ($index = 0; $index -lt $elements.Count; $index++) {
    try {
      if ($elements.Item($index).Current.Name -eq $Text) { return $true }
    } catch {
      # A Chromium accessibility element can disappear while the tree is changing.
    }
  }
  return $false
}

function Save-WindowScreenshot {
  param(
    [Windows.Automation.AutomationElement] $Window,
    [string] $Path
  )

  Add-Type -AssemblyName System.Drawing
  $bounds = $Window.Current.BoundingRectangle
  $width = [Math]::Max(1, [int] [Math]::Ceiling($bounds.Width))
  $height = [Math]::Max(1, [int] [Math]::Ceiling($bounds.Height))
  $bitmap = [Drawing.Bitmap]::new($width, $height)
  $graphics = [Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.CopyFromScreen(
      [int] $bounds.Left,
      [int] $bounds.Top,
      0,
      0,
      [Drawing.Size]::new($width, $height)
    )
    $directory = Split-Path -Parent $Path
    New-Item -ItemType Directory -Force -Path $directory | Out-Null
    $bitmap.Save($Path, [Drawing.Imaging.ImageFormat]::Png)
  } finally {
    $graphics.Dispose()
    $bitmap.Dispose()
  }
}

$deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
do {
  $windows = Get-ProcessWindows
  if ($Action -eq "CloseWindows" -and $windows.Count -gt 0) {
    $closed = 0
    foreach ($window in $windows) {
      try {
        $pattern = $window.GetCurrentPattern([Windows.Automation.WindowPattern]::Pattern)
        ([Windows.Automation.WindowPattern] $pattern).Close()
        $closed++
      } catch {
        throw "A Breev desktop window did not expose the standard close operation"
      }
    }
    [ordered]@{ action = $Action; processId = $ProcessId; windowCount = $windows.Count; closed = $closed } |
      ConvertTo-Json -Compress
    exit 0
  }

  if ($Action -eq "WaitForText" -and -not [string]::IsNullOrWhiteSpace($ExpectedText)) {
    foreach ($window in $windows) {
      if (Test-WindowContainsText -Window $window -Text $ExpectedText) {
        if (-not [string]::IsNullOrWhiteSpace($ScreenshotPath)) {
          Save-WindowScreenshot -Window $window -Path ([IO.Path]::GetFullPath($ScreenshotPath))
        }
        [ordered]@{
          action = $Action
          processId = $ProcessId
          windowCount = $windows.Count
          expectedText = $ExpectedText
          matched = $true
        } | ConvertTo-Json -Compress
        exit 0
      }
    }
  }
  Start-Sleep -Milliseconds 200
} while ([DateTime]::UtcNow -lt $deadline)

throw "Windows UI Automation did not observe the expected Breev desktop state"

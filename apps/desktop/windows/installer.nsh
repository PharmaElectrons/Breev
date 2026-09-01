!include "FileFunc.nsh"
!include "LogicLib.nsh"

!ifndef BUILD_UNINSTALLER
  Var BreevRole
  Var BreevRoleExplicit
  Var BreevSkipRolePage
  Var BreevInstalledRole
  Var BreevMainState
  Var BreevTerminalState
  Var BreevMainRoleRadio
  Var BreevTerminalRoleRadio

  !macro BreevFailRole MESSAGE
    ${IfNot} ${Silent}
      MessageBox MB_OK|MB_ICONSTOP "${MESSAGE}"
    ${EndIf}
    SetErrorLevel 87
    Quit
  !macroend

  !macro customInit
    StrCpy $BreevRole "main"
    StrCpy $BreevRoleExplicit "0"
    StrCpy $BreevSkipRolePage "0"
    StrCpy $BreevInstalledRole ""
    StrCpy $BreevMainState "0"
    StrCpy $BreevTerminalState "0"

    ${GetParameters} $R7
    ClearErrors
    ${GetOptions} $R7 "/ROLE=" $R6
    ${IfNot} ${Errors}
      StrCpy $BreevRoleExplicit "1"
      StrCpy $BreevRole $R6
      ${If} $BreevRole != "main"
      ${AndIf} $BreevRole != "terminal"
        !insertmacro BreevFailRole 'The /ROLE option must be exactly /ROLE=main or /ROLE=terminal.'
      ${EndIf}
    ${EndIf}

    ReadEnvStr $R5 "ProgramData"
    ${If} $R5 == ""
      !insertmacro BreevFailRole 'Windows did not provide ProgramData, so Breev cannot resolve the installed device role.'
    ${EndIf}
    StrCpy $R5 "$R5\Breev"

    ${If} ${FileExists} "$R5\config\device-role"
      ClearErrors
      FileOpen $R4 "$R5\config\device-role" r
      ${If} ${Errors}
        !insertmacro BreevFailRole 'The installed Breev device role cannot be read. Repair is required.'
      ${EndIf}
      FileRead $R4 $R3
      FileClose $R4
      ${If} $R3 != "main"
      ${AndIf} $R3 != "terminal"
        !insertmacro BreevFailRole 'The installed Breev device role is invalid. Repair is required.'
      ${EndIf}
      StrCpy $BreevInstalledRole $R3
    ${EndIf}

    ${If} ${FileExists} "$R5\config\database-url"
      StrCpy $BreevMainState "1"
    ${ElseIf} ${FileExists} "$R5\config\schema-owner-url"
      StrCpy $BreevMainState "1"
    ${ElseIf} ${FileExists} "$R5\config\main-device.json"
      StrCpy $BreevMainState "1"
    ${ElseIf} ${FileExists} "$R5\postgresql\*.*"
      StrCpy $BreevMainState "1"
    ${EndIf}
    ${If} ${FileExists} "$R5\config\terminal\*.*"
      StrCpy $BreevTerminalState "1"
    ${EndIf}

    ${If} $BreevMainState == "1"
    ${AndIf} $BreevTerminalState == "1"
      !insertmacro BreevFailRole 'Breev found conflicting Main and POS Terminal data. A reviewed Repair is required.'
    ${EndIf}

    ${If} $BreevInstalledRole != ""
      ${If} $BreevRoleExplicit == "1"
      ${AndIf} $BreevRole != $BreevInstalledRole
        !insertmacro BreevFailRole 'The requested /ROLE conflicts with this computer$\'s installed Breev role.'
      ${EndIf}
      StrCpy $BreevRole $BreevInstalledRole
      StrCpy $BreevSkipRolePage "1"
    ${ElseIf} $BreevRoleExplicit == "1"
      StrCpy $BreevSkipRolePage "1"
    ${ElseIf} $BreevMainState == "1"
      StrCpy $BreevRole "main"
      StrCpy $BreevSkipRolePage "1"
    ${EndIf}

    ${If} ${isUpdated}
      StrCpy $BreevSkipRolePage "1"
    ${EndIf}
    ${If} ${Silent}
      StrCpy $BreevSkipRolePage "1"
    ${EndIf}

    ${If} $BreevRole == "terminal"
    ${AndIf} $BreevMainState == "1"
      !insertmacro BreevFailRole 'The POS Terminal role conflicts with preserved Main Server data.'
    ${EndIf}
    ${If} $BreevRole == "main"
    ${AndIf} $BreevTerminalState == "1"
    ${AndIf} $BreevSkipRolePage == "1"
      !insertmacro BreevFailRole 'The Main Server role conflicts with preserved POS Terminal data. Repair with /ROLE=terminal.'
    ${EndIf}
  !macroend

  !macro customPageAfterChangeDir
    Function BreevRolePageCreate
      ${If} $BreevSkipRolePage == "1"
        Abort
      ${EndIf}

      nsDialogs::Create 1018
      Pop $R0
      ${If} $R0 == error
        Abort
      ${EndIf}

      ${NSD_CreateGroupBox} 0 0 100% 72u "Device role"
      Pop $R0
      ${NSD_CreateRadioButton} 8u 16u 92% 18u "Main Pharmacy Server && Station (Primary Computer)"
      Pop $BreevMainRoleRadio
      ${NSD_CreateRadioButton} 8u 42u 92% 18u "Additional POS Terminal (Cashier / Sales Counter)"
      Pop $BreevTerminalRoleRadio

      ${If} $BreevRole == "terminal"
        ${NSD_Check} $BreevTerminalRoleRadio
      ${Else}
        ${NSD_Check} $BreevMainRoleRadio
      ${EndIf}
      nsDialogs::Show
    FunctionEnd

    Function BreevRolePageLeave
      ${NSD_GetState} $BreevTerminalRoleRadio $R0
      ${If} $R0 == ${BST_CHECKED}
        StrCpy $BreevRole "terminal"
      ${Else}
        StrCpy $BreevRole "main"
      ${EndIf}

      ${If} $BreevRole == "main"
      ${AndIf} $BreevTerminalState == "1"
        MessageBox MB_OK|MB_ICONSTOP "This computer contains POS Terminal state. Select Additional POS Terminal to repair it."
        Abort
      ${EndIf}
    FunctionEnd

    Page custom BreevRolePageCreate BreevRolePageLeave
  !macroend
!endif

!macro RunBreevLifecycle ACTION
  ReadEnvStr $R8 "BREEV_WINDOWS_INJECT_FAILURE"
  ${If} $R8 == ""
    StrCpy $R8 "None"
  ${EndIf}

  DetailPrint "Running the Breev ${ACTION} lifecycle"
  StrCpy $R9 "-1"
  ClearErrors
  ExecWait '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\resources\windows-payload\lifecycle.ps1" -Action "${ACTION}" -InstallRoot "$INSTDIR" -PayloadRoot "$INSTDIR\resources\windows-payload" -Role "$BreevRole" -InjectFailure "$R8"' $R9
  ${If} ${Errors}
    StrCpy $R9 "-1"
  ${EndIf}
  ${If} $R9 != 0
    DetailPrint "The Breev ${ACTION} lifecycle failed with exit code $R9"
    SetErrorLevel $R9
    Abort
  ${EndIf}
!macroend

!macro customInstall
  ${GetParameters} $R7
  ${GetOptions} $R7 "/repair" $R6
  ${If} ${Errors}
    !insertmacro RunBreevLifecycle "Install"
  ${Else}
    !insertmacro RunBreevLifecycle "Repair"
  ${EndIf}
!macroend

!macro customUnInstall
  ; This uninstaller only ever runs the data-preserving Uninstall action. It
  ; stops and removes the services and closes the LAN firewall rule, and leaves
  ; the pharmacy data and the pharmacy CA in place.
  ;
  ; Destroying pharmacy data is a separate, separately authorized action that
  ; no installer path reaches. An administrator runs it by hand from an
  ; elevated PowerShell:
  ;
  ;   powershell.exe -NoProfile -ExecutionPolicy Bypass
  ;     -File "$INSTDIR\resources\windows-payload\lifecycle.ps1"
  ;     -Action DestructiveUninstall -InstallRoot "$INSTDIR"
  ;     -PayloadRoot "$INSTDIR\resources\windows-payload"
  ;     -DataDestructionAuthorized -DestructionConfirmation destroy-pharmacy-data
  ;
  ; The uninstall lifecycle must never abort the uninstaller: any nonzero
  ; result here (including a PowerShell launch or parameter-binding failure
  ; the script itself cannot catch) would send electron-builder's
  ; uninstallOldVersion into its "cannot be closed" retry loop and block
  ; every reinstall. The lifecycle script is itself best-effort for
  ; Uninstall and records what it could not do.
  ReadEnvStr $R8 "BREEV_WINDOWS_INJECT_FAILURE"
  ${If} $R8 == ""
    StrCpy $R8 "None"
  ${EndIf}
  DetailPrint "Running the Breev Uninstall lifecycle"
  StrCpy $R9 "-1"
  ClearErrors
  ExecWait '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\resources\windows-payload\lifecycle.ps1" -Action "Uninstall" -InstallRoot "$INSTDIR" -PayloadRoot "$INSTDIR\resources\windows-payload" -InjectFailure "$R8"' $R9
  ${If} ${Errors}
    StrCpy $R9 "-1"
  ${EndIf}
  ${If} $R9 != 0
    DetailPrint "The Breev Uninstall lifecycle reported exit code $R9; continuing removal"
  ${EndIf}
!macroend

; Raven Forge — custom NSIS behaviour: where the launcher installs, and what an
; uninstall does with the player's data.
;
; electron-builder picks this file up on its own, because it is named
; installer.nsh and sits in `directories.buildResources`. There is deliberately
; no key for it in electron-builder.config.js — adding one would only restate
; the default and give a second place to keep in sync. It is included at the
; very top of both the installer and the uninstaller script.

; ── The install folder ──────────────────────────────────────────────────────
;
; electron-builder names the folder after the product — "Raven Forge Launcher",
; spaces and all — for any installer that offers a choice of directory, and
; after the package only for a one-click one. The launcher's data lives in a
; folder named after the package (src/core/config/app-home.ts), with no spaces
; for the sake of the game and the mods that are started from inside it; the
; program goes in a folder of the same name, so that there is one name to
; recognise and none of them needs quoting.
;
; APP_FILENAME is the single lever: the default directory, the "add a folder of
; our own if the chosen one is not it" rule on the directory page, and the
; uninstaller's idea of where the app data is are all spelled with it. It
; arrives as a command-line define, hence the !undef.
;
; APP_PRODUCT_FILENAME is what the template calls the *other* of the two names
; when they differ, and its uninstaller clears app data under both. Defining it
; here keeps that true, which is what removes the old-named data folder of an
; install that was never started after updating.
!undef APP_FILENAME
!define APP_FILENAME "${APP_PACKAGE_NAME}"
!ifndef APP_PRODUCT_FILENAME
  !define APP_PRODUCT_FILENAME "${PRODUCT_FILENAME}"
!endif

; An install made by an older build sits in "…\Raven Forge Launcher", and the
; registry says so, so that is the folder the installer proposes.
;
; An update leaves it there. Updates run silently, no page is shown and none of
; this runs, and moving a working install out from under its shortcuts is not
; something to do without anybody asking.
;
; Run by hand, the installer puts this version in the same place under the new
; name. Left alone the old name would do worse than stay: the step after the
; directory page checks that the folder carries the app's name and, finding the
; old spelling, appends the new — installing into
; "…\Raven Forge Launcher\raven-forge-launcher". The previous copy is removed
; from where it was by the installer's own handling of an existing install,
; which goes by the registry and not by this variable.
!macro ravenForgeInstallFolder
  StrLen $R0 "\${APP_PRODUCT_FILENAME}"
  StrCpy $R1 $INSTDIR "" -$R0
  ${If} $R1 == "\${APP_PRODUCT_FILENAME}"
    StrLen $R2 $INSTDIR
    IntOp $R2 $R2 - $R0
    StrCpy $R1 $INSTDIR $R2
    StrCpy $INSTDIR "$R1\${APP_FILENAME}"
  ${EndIf}
!macroend

; It has to happen here, between the directory page and the copying, and not
; when the installer starts: the "for whom" page sets the folder from the
; registry again as it is left, which undoes anything settled before it. A page
; with nothing on it — the function names the folder and skips itself.
;
; That alone left the directory page showing one folder and the installer
; using another: the old name was on the page, and the new one was settled
; after the page had been left. So the page is put right as well. NSIS calls
; `.onVerifyInstDir` with whatever its field holds — when the page opens, and
; at every change, a browse or a keystroke — and a folder that ends in the old
; name is written back into the field under the new one, which is what the
; installer then reads. The field is found by its id in the page's dialog
; (1019, NSIS's own directory box); on any other page there is no such control
; and nothing is sent.
;
; Not when the installer runs silently. It is asked about the folder then too,
; once, and an update must stay where it is.
;
; Both live in this macro because it is the one place the template gives that
; is in the installer only and comes after its includes.
!macro customPageAfterChangeDir
  Page custom ravenForgeNameInstallFolder
  Function ravenForgeNameInstallFolder
    !insertmacro ravenForgeInstallFolder
    Abort
  FunctionEnd

  Function .onVerifyInstDir
    ${IfNot} ${Silent}
      Push $R0
      Push $R1
      Push $R2
      Push $R3
      StrCpy $R3 $INSTDIR
      !insertmacro ravenForgeInstallFolder
      ${If} $INSTDIR != $R3
        FindWindow $R3 "#32770" "" $HWNDPARENT
        GetDlgItem $R3 $R3 1019
        SendMessage $R3 ${WM_SETTEXT} 0 "STR:$INSTDIR"
      ${EndIf}
      Pop $R3
      Pop $R2
      Pop $R1
      Pop $R0
    ${EndIf}
  FunctionEnd
!macroend

; ── The player's data on uninstall ──────────────────────────────────────────
;
; Why this exists: a profile carries its own .minecraft — mods, worlds, resource
; packs — next to the Minecraft assets and the Java runtime downloaded for it,
; so the data directory is routinely several gigabytes. electron-builder's own
; lever, `deleteAppDataOnUninstall`, is all or nothing: leave it off and all of
; that stays behind with nothing on screen saying where, turn it on and someone
; uninstalling to fix a broken install loses every world they ever built.
; Neither is a decision to make silently on a player's behalf, so we ask.
;
; Since the data directory became movable (Settings → Data → Move…), where it
; is can no longer be assumed. `data-root.txt` names it, one line of text, and
; stays in the launcher's folder under %APPDATA% whatever the data does — see
; src/core/config/data-root.ts, which writes it for exactly this reader.
; Without following it the dialog below would name a folder the data is not in
; and then promise to delete it.

; Reads the moved data directory into $R9, or "" when the data never moved.
;
; The pointer is UTF-16LE: the plain `FileRead` decodes in the machine's ANSI
; code page, and a path with a letter outside it — "D:\Gry\Świat" — came back as
; a folder that does not exist. An install that predates that has a pointer in
; the old-named folder, written as UTF-8 by a build that knew no better; it is
; read the old way, which is right for every path that old way ever got right.
;
; This only works in an installer compiled on Windows, which is where the
; packaging and release jobs compile it. The Linux makensis that comes with
; electron-builder's NSIS (3.0.4.1) compiles `FileReadUTF16LE` into something
; the installer does not run: the read comes back empty, no error is raised,
; and the uninstaller behaves as though the data had never moved.
;
; Registers: $R3-$R9 only. $R0-$R2 are left alone because the stock uninstall
; section uses them either side of where this macro is inserted, and the
; trailing newline is stripped by hand rather than with `${TrimNewLines}` —
; that lives in TextFunc.nsh, which electron-builder's template does not
; include, and pulling it in would mean the `un.` function dance for one trim.
!macro readRavenForgeDataRoot
  StrCpy $R9 ""
  ${If} ${FileExists} "$APPDATA\${APP_FILENAME}\data-root.txt"
    ClearErrors
    FileOpen $R5 "$APPDATA\${APP_FILENAME}\data-root.txt" r
    ${IfNot} ${Errors}
      FileReadUTF16LE $R5 $R9
      FileClose $R5
    ${EndIf}
    ; The byte-order mark, where the read did not already step over it.
    StrCpy $R4 $R9 1
    ${If} $R4 == "${U+FEFF}"
      StrCpy $R9 $R9 "" 1
    ${EndIf}
  ${ElseIf} ${FileExists} "$APPDATA\${APP_PRODUCT_FILENAME}\data-root.txt"
    ClearErrors
    FileOpen $R5 "$APPDATA\${APP_PRODUCT_FILENAME}\data-root.txt" r
    ${IfNot} ${Errors}
      FileRead $R5 $R9
      FileClose $R5
    ${EndIf}
  ${EndIf}

  rfTrimPointer:
  StrCpy $R4 $R9 1 -1
  ${If} $R4 == "$\n"
  ${OrIf} $R4 == "$\r"
  ${OrIf} $R4 == " "
  ${OrIf} $R4 == "$\t"
    StrCpy $R9 $R9 -1
    Goto rfTrimPointer
  ${EndIf}

  ; Anything shorter than `C:\x` is not a directory somebody moved gigabytes
  ; into. A truncated read or a hand-edited file must not be acted on.
  StrLen $R4 $R9
  ${If} $R4 < 4
    StrCpy $R9 ""
  ${ElseIfNot} ${FileExists} "$R9\*.*"
    StrCpy $R9 ""
  ${EndIf}

  ; And what is there has to be the launcher's data, by the same three signs
  ; the launcher itself goes by (`usable` in src/core/config/data-root.ts). The
  ; deleting below is by name, and `cache`, `logs` and `profiles` are names
  ; other programs use too: a pointer that had come to name some other folder
  ; must not have them taken out of it.
  ${If} $R9 != ""
  ${AndIfNot} ${FileExists} "$R9\settings.json"
  ${AndIfNot} ${FileExists} "$R9\profiles.json"
  ${AndIfNot} ${FileExists} "$R9\profiles\*.*"
    StrCpy $R9 ""
  ${EndIf}
!macroend

; Deletes the launcher's data from a folder the player chose, and nothing else
; in it.
;
; Entry by entry, by name, and then the folder itself only if that left it
; empty. This used to be `RMDir /r` on whatever the pointer named — and the
; pointer names whatever was picked in the "Move…" dialog, which the launcher
; then used as it stood. Pointed at D:\Games, "delete the launcher's data"
; deleted D:\Games. The launcher now makes a folder of its own inside a folder
; that holds other things, but an install moved before that fix may still be
; pointing at one, and this is the half that makes sure it does not matter.
;
; The names are the ones in MOVABLE_NAMES in src/core/config/data-root-move.ts,
; plus the state files that were set aside as unreadable and the marker of a
; move that never finished.
!macro deleteRavenForgeData DIR
  Delete "${DIR}\settings.json"
  Delete "${DIR}\settings.json.broken-*"
  Delete "${DIR}\profiles.json"
  Delete "${DIR}\profiles.json.broken-*"
  Delete "${DIR}\auth.json"
  Delete "${DIR}\auth.json.broken-*"
  Delete "${DIR}\.raven-forge-moving"
  RMDir /r "${DIR}\profiles"
  RMDir /r "${DIR}\loaders"
  RMDir /r "${DIR}\java"
  RMDir /r "${DIR}\cache"
  RMDir /r "${DIR}\logs"
  RMDir /r "${DIR}\crash-reports"
  RMDir "${DIR}"
!macroend

!macro customUnInstall
  ; Electron writes to the *user's* AppData even when the app was installed for
  ; all users, and for such an install the template has the shell context set
  ; to "all" by now — so $APPDATA would be ProgramData, the pointer would not
  ; be found there, and the question below would name the wrong folder. The
  ; context is put back at the end of this macro.
  ${if} $installMode == "all"
    SetShellVarContext current
  ${endif}

  ; Where the data went, in a variable of its own and not in the register the
  ; macro hands it back in. electron-builder writes a test for each of its
  ; command-line flags — `${isUpdated}` is one — and every one of them leaves
  ; its answer in $R9: "true" or "false". The path used to be kept there across
  ; `${isUpdated}` below, so from the first build that followed a move the
  ; question named a folder called `false`, for everybody, and a folder the
  ; data had been moved to was never deleted when the answer was "delete".
  Var /GLOBAL ravenForgeDataRoot
  !insertmacro readRavenForgeDataRoot
  StrCpy $ravenForgeDataRoot $R9

  ; `--delete-app-data` is what the docs give people for a silent uninstall that
  ; removes the data, and the stock template's own handling of it only knows
  ; about %APPDATA%. The moved folder is the part that is actually large, so it
  ; has to be honoured here or the flag quietly does a fraction of its job.
  ${GetParameters} $R7
  ClearErrors
  ${GetOptions} $R7 "--delete-app-data" $R6
  ${IfNot} ${Errors}
  ${AndIf} $ravenForgeDataRoot != ""
    !insertmacro deleteRavenForgeData "$ravenForgeDataRoot"
  ${EndIf}

  ; Two paths must never see a dialog. An auto-update runs this uninstaller as
  ; `/S --updated`, and the data is precisely what has to survive it; any other
  ; silent uninstall has no window to click a modal box in and would hang on
  ; one. Passing `--delete-app-data` still works in both cases — the stock
  ; template handles that flag further down the section, untouched by this.
  ${IfNot} ${Silent}
  ${AndIfNot} ${isUpdated}
    ; The path the message quotes is the one the data is really in, so the
    ; sentence stays true after a move and the "delete" button keeps its word.
    ${If} $ravenForgeDataRoot != ""
      StrCpy $R3 "$ravenForgeDataRoot"
    ${ElseIf} ${FileExists} "$APPDATA\${APP_FILENAME}\*.*"
      StrCpy $R3 "$APPDATA\${APP_FILENAME}"
    ${Else}
      ; Installed by an older build and never started since: the data is still
      ; under the old name.
      StrCpy $R3 "$APPDATA\${APP_PRODUCT_FILENAME}"
    ${EndIf}

    ; NSIS resolves a LangString with no entry for the running language to an
    ; *empty* string, and electron-builder bundles 26 installer languages with
    ; more listed as todo — so a translation table here would eventually show
    ; somebody a blank dialog with two buttons. Choosing the text by hand
    ; cannot fail that way: anything that is not Polish gets English.
    ${If} $LANGUAGE == 1045
      StrCpy $R8 "Zachować dane Raven Forge?$\r$\n$\r$\nProfile, mody, światy, pobrane pliki Minecrafta i środowiska Java znajdują się w:$\r$\n$R3$\r$\n$\r$\nPotrafią zajmować kilka gigabajtów, ale dzięki nim ponowna instalacja zastaje wszystko na swoim miejscu.$\r$\n$\r$\nTak — zachowaj je.$\r$\nNie — usuń bezpowrotnie."
    ${Else}
      StrCpy $R8 "Keep your Raven Forge data?$\r$\n$\r$\nProfiles, mods, worlds, downloaded Minecraft files and Java runtimes live in:$\r$\n$R3$\r$\n$\r$\nThat is often several gigabytes, and keeping it means a reinstall finds everything where you left it.$\r$\n$\r$\nYes — keep them.$\r$\nNo — delete them permanently."
    ${EndIf}

    MessageBox MB_YESNO|MB_ICONQUESTION $R8 IDYES keepRavenForgeData

      ; The moved directory first: it holds everything the dialog just listed,
      ; and it is the one the block below would not reach.
      ${If} $ravenForgeDataRoot != ""
        !insertmacro deleteRavenForgeData "$ravenForgeDataRoot"
      ${EndIf}

      ; The launcher's own folder under %APPDATA%, by both the names it has
      ; had. These are the launcher's from the top down — nobody picked them —
      ; so they go whole. After a move they hold only the pointer and the
      ; embedded browser's files.
      RMDir /r "$APPDATA\${APP_FILENAME}"
      RMDir /r "$APPDATA\${APP_PRODUCT_FILENAME}"

    keepRavenForgeData:
  ${EndIf}

  ; electron-updater's download cache — `updaterCacheDirName` in app-update.yml,
  ; which electron-builder derives from package.json `name`. The installer puts
  ; a whole copy of itself there to work out later updates from, a hundred
  ; megabytes of it, and nothing else ever clears it. It goes with the program
  ; whatever was answered above: it is the installer's own and none of the
  ; player's files, and it used to be what "keep my data" left behind on a
  ; machine the launcher was no longer on.
  ;
  ; Not when this is an update. The old version's uninstaller is run for one as
  ; well — by the updater, and by an installer started by hand over an existing
  ; install — and the folder then holds the installer that is running.
  ${IfNot} ${isUpdated}
    RMDir /r "$LOCALAPPDATA\${APP_PACKAGE_NAME}-updater"
  ${EndIf}

  ${if} $installMode == "all"
    SetShellVarContext all
  ${endif}
!macroend

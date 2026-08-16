; Raven Forge — custom NSIS uninstaller behaviour.
;
; electron-builder picks this file up on its own, because it is named
; installer.nsh and sits in `directories.buildResources`. There is deliberately
; no key for it in electron-builder.config.js — adding one would only restate
; the default and give a second place to keep in sync.
;
; Why it exists: a profile carries its own .minecraft — mods, worlds, resource
; packs — next to the Minecraft assets and the Java runtime downloaded for it,
; so the data directory is routinely several gigabytes. electron-builder's own
; lever, `deleteAppDataOnUninstall`, is all or nothing: leave it off and all of
; that stays behind with nothing on screen saying where, turn it on and someone
; uninstalling to fix a broken install loses every world they ever built.
; Neither is a decision to make silently on a player's behalf, so we ask.

!macro customUnInstall
  ; Two paths must never see a dialog. An auto-update runs this uninstaller as
  ; `/S --updated`, and the data is precisely what has to survive it; any other
  ; silent uninstall has no window to click a modal box in and would hang on
  ; one. Passing `--delete-app-data` still works in both cases — the stock
  ; template handles that flag further down the section, untouched by this.
  ${IfNot} ${Silent}
  ${AndIfNot} ${isUpdated}
    ; NSIS resolves a LangString with no entry for the running language to an
    ; *empty* string, and electron-builder bundles 26 installer languages with
    ; more listed as todo — so a translation table here would eventually show
    ; somebody a blank dialog with two buttons. Choosing the text by hand
    ; cannot fail that way: anything that is not Polish gets English.
    ${If} $LANGUAGE == 1045
      StrCpy $R8 "Zachować dane Raven Forge?$\r$\n$\r$\nProfile, mody, światy, pobrane pliki Minecrafta i środowiska Java znajdują się w:$\r$\n$APPDATA\${APP_FILENAME}$\r$\n$\r$\nPotrafią zajmować kilka gigabajtów, ale dzięki nim ponowna instalacja zastaje wszystko na swoim miejscu.$\r$\n$\r$\nTak — zachowaj je.$\r$\nNie — usuń bezpowrotnie."
    ${Else}
      StrCpy $R8 "Keep your Raven Forge data?$\r$\n$\r$\nProfiles, mods, worlds, downloaded Minecraft files and Java runtimes live in:$\r$\n$APPDATA\${APP_FILENAME}$\r$\n$\r$\nThat is often several gigabytes, and keeping it means a reinstall finds everything where you left it.$\r$\n$\r$\nYes — keep them.$\r$\nNo — delete them permanently."
    ${EndIf}

    MessageBox MB_YESNO|MB_ICONQUESTION $R8 IDYES keepRavenForgeData

      ; Electron writes to the *user's* AppData even when the app was installed
      ; for all users, so the shell context has to be flipped back before
      ; $APPDATA and $LOCALAPPDATA resolve to the right profile. Same reasoning,
      ; and the same three directories, as the stock uninstaller's own
      ; --delete-app-data block.
      ${if} $installMode == "all"
        SetShellVarContext current
      ${endif}
      RMDir /r "$APPDATA\${APP_FILENAME}"
      !ifdef APP_PRODUCT_FILENAME
        RMDir /r "$APPDATA\${APP_PRODUCT_FILENAME}"
      !endif
      ; Chromium keys its caches off the package name, not the product name.
      !ifdef APP_PACKAGE_NAME
        RMDir /r "$APPDATA\${APP_PACKAGE_NAME}"
      !endif
      ; electron-updater's download cache — `updaterCacheDirName` in
      ; app-update.yml, which electron-builder derives from package.json `name`.
      ; Nothing else ever clears it and it holds a full installer of the version
      ; being removed. Only on this branch: the other one has just promised to
      ; keep the player's files, so it touches nothing at all.
      RMDir /r "$LOCALAPPDATA\raven-forge-launcher-updater"
      ${if} $installMode == "all"
        SetShellVarContext all
      ${endif}

    keepRavenForgeData:
  ${EndIf}
!macroend

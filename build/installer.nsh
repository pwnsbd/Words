; Custom NSIS hooks for the Words installer (electron-builder picks this up
; via build.nsis.include in package.json).

!macro customUnInstall
  ; The app downloads its ~5GB of GGUF model files into <install dir>\models
  ; on first run -- after the installer has already recorded its file list,
  ; so electron-builder's generated uninstaller doesn't know about them.
  ; Remove that folder explicitly so uninstalling Words really does take the
  ; models with it.
  RMDir /r "$INSTDIR\models"

  ; Journal entries and settings live in %APPDATA%\words, outside the install
  ; dir, and normally survive an uninstall so that reinstalling keeps your
  ; writing. Offer to erase them too -- default is No (keep). Skipped on a
  ; silent uninstall, which keeps the data.
  IfSilent words_keep_data
  MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Also delete your Words journal?$\r$\n$\r$\nThis permanently erases every entry you have written and your settings (in $APPDATA\words).$\r$\n$\r$\nChoose No to keep them for a future reinstall." IDNO words_keep_data
  RMDir /r "$APPDATA\words"
  RMDir /r "$APPDATA\Words"
  words_keep_data:
!macroend

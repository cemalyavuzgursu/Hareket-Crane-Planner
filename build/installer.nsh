; Hareket Crane Planner — özel NSIS kurulum eklentisi.
; Kurulum dizini seçildikten sonra kullanıcıya hangi kısayolların
; oluşturulacağını soran bir sayfa ekler (masaüstü + başlat menüsü).
;
; ÖNEMLİ: Bu dosya electron-builder tarafından hem kurulum hem kaldırma
; betiğine !include edilir. Bu nedenle serbest (makro dışı) Function/Var/Page
; TANIMLANMAZ — hepsi electron-builder'ın makro kancalarına yerleştirilir:
;   customHeader            -> kurulum betiği başlığı (Var + Function tanımları)
;   customPageAfterChangeDir-> dizin sayfasından sonra özel sayfa
;   customInstall/UnInstall -> kurulum/kaldırma eylemleri

!macro customHeader
  ; Sayfa fonksiyonları yalnızca KURULUM betiğinde tanımlanmalı; kaldırma
  ; betiğinde tanımlanırsa "referans edilmemiş fonksiyon" uyarısı verir.
  !ifndef BUILD_UNINSTALLER
  !include "nsDialogs.nsh"
  !include "LogicLib.nsh"

  Var HkDesktopChk
  Var HkStartMenuChk
  Var HkMakeDesktop
  Var HkMakeStartMenu

  Function hkShortcutsPageCreate
    !insertmacro MUI_HEADER_TEXT "Kısayollar" "Hangi kısayollar oluşturulsun?"
    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
      Abort
    ${EndIf}

    ${NSD_CreateLabel} 0 0 100% 22u "Hareket Crane Planner için oluşturulacak kısayolları seçin:"
    Pop $1

    ${NSD_CreateCheckbox} 0 28u 100% 12u "Masaüstü kısayolu oluştur"
    Pop $HkDesktopChk
    ${NSD_Check} $HkDesktopChk

    ${NSD_CreateCheckbox} 0 46u 100% 12u "Başlat menüsü kısayolu oluştur"
    Pop $HkStartMenuChk
    ${NSD_Check} $HkStartMenuChk

    nsDialogs::Show
  FunctionEnd

  Function hkShortcutsPageLeave
    ${NSD_GetState} $HkDesktopChk $HkMakeDesktop
    ${NSD_GetState} $HkStartMenuChk $HkMakeStartMenu
  FunctionEnd
  !endif
!macroend

; Dizin seçim sayfasından sonra özel kısayol sayfasını ekle.
!macro customPageAfterChangeDir
  Page custom hkShortcutsPageCreate hkShortcutsPageLeave
!macroend

; Kurulum sırasında, seçime göre kısayolları oluştur.
!macro customInstall
  ${If} $HkMakeDesktop == 1
    CreateShortCut "$DESKTOP\${PRODUCT_NAME}.lnk" "$INSTDIR\${PRODUCT_FILENAME}.exe"
  ${EndIf}
  ${If} $HkMakeStartMenu == 1
    CreateShortCut "$SMPROGRAMS\${PRODUCT_NAME}.lnk" "$INSTDIR\${PRODUCT_FILENAME}.exe"
  ${EndIf}
!macroend

; Kaldırırken kısayolları temizle.
!macro customUnInstall
  Delete "$DESKTOP\${PRODUCT_NAME}.lnk"
  Delete "$SMPROGRAMS\${PRODUCT_NAME}.lnk"
!macroend

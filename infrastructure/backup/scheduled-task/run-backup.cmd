@echo off
rem Ghasedak daily backup - ASCII-only wrapper (see run-backup.ps1 header).
rem Old failure: Persian script path inside this .cmd got mangled by the
rem scheduler codepage -> node MODULE_NOT_FOUND. Now: no non-ASCII here at all.
rem %* forwards optional --Url/--Out overrides (e.g. for restore-source tests).
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\ghasedak-tools\run-backup.ps1" %*
exit /b %ERRORLEVEL%

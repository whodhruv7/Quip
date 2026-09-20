' Quip — silent desktop launcher (no terminal window, ever).
' Double-click (or the Quip desktop shortcut) starts Quip with the console
' window hidden. Portable: it locates the repo from its own folder, so it
' works no matter where the Quip project lives on the laptop.
Option Explicit

Dim fso, shell, root, cmd
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

root = fso.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = root

cmd = """" & root & "\run-quip.cmd"""
' 0 = hidden window, False = don't wait for exit
shell.Run cmd, 0, False

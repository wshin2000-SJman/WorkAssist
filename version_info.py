# -*- coding: utf-8 -*-
# Version info script - run this to generate file_version_info.txt
# Usage: python version_info.py

version_info = """
VSVersionInfo(
  ffi=FixedFileInfo(
    filevers=(1, 0, 1, 0),
    prodvers=(1, 0, 1, 0),
    mask=0x3f,
    flags=0x0,
    OS=0x40004,
    fileType=0x1,
    subtype=0x0,
    date=(0, 0)
  ),
  kids=[
    StringFileInfo(
      [
        StringTable(
          u'040904B0',
          [
            StringStruct(u'CompanyName', u'Samjeong Automation'),
            StringStruct(u'FileDescription', u'SJ Kanban - Task Management'),
            StringStruct(u'FileVersion', u'1.0.1.0'),
            StringStruct(u'InternalName', u'SJ_Kanban'),
            StringStruct(u'LegalCopyright', u'Copyright (c) 2026 Samjeong Automation. All rights reserved.'),
            StringStruct(u'OriginalFilename', u'SJ_Kanban.exe'),
            StringStruct(u'ProductName', u'SJ Kanban'),
            StringStruct(u'ProductVersion', u'1.0.1.0'),
          ]
        )
      ]
    ),
    VarFileInfo([VarStruct(u'Translation', [1033, 1200])])
  ]
)
"""

with open('file_version_info.txt', 'w', encoding='utf-8') as f:
    f.write(version_info.strip())

print("file_version_info.txt generated successfully!")

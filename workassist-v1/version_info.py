# -*- coding: utf-8 -*-
# Version info script - run this to generate file_version_info.txt
# Usage: python version_info.py
from version import VERSION

# Convert "1.0.0" to (1, 0, 0, 0)
v_parts = [int(p) for p in VERSION.split('.')]
while len(v_parts) < 4:
    v_parts.append(0)
v_tuple = tuple(v_parts)
v_str = ".".join(map(str, v_parts))

version_info_template = """
VSVersionInfo(
  ffi=FixedFileInfo(
    filevers={v_tuple},
    prodvers={v_tuple},
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
            StringStruct(u'FileDescription', u'WorkAssist - Task Management'),
            StringStruct(u'FileVersion', u'{v_str}'),
            StringStruct(u'InternalName', u'WorkAssist'),
            StringStruct(u'LegalCopyright', u'Copyright (c) 2026 Samjeong Automation. All rights reserved.'),
            StringStruct(u'OriginalFilename', u'WorkAssist.exe'),
            StringStruct(u'ProductName', u'WorkAssist'),
            StringStruct(u'ProductVersion', u'{v_str}'),
          ]
        )
      ]
    ),
    VarFileInfo([VarStruct(u'Translation', [1033, 1200])])
  ]
)
"""

version_info = version_info_template.format(v_tuple=v_tuple, v_str=v_str)

with open('file_version_info.txt', 'w', encoding='utf-8') as f:
    f.write(version_info.strip())

print(f"file_version_info.txt generated successfully with version {v_str}!")

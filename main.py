import webview
import os
import sys
from api import API

def get_asset_path(filename):
    if getattr(sys, 'frozen', False):
        # Running as compiled PyInstaller executable
        base_path = sys._MEIPASS
    else:
        # Running as normal Python script
        base_path = os.path.dirname(os.path.abspath(__file__))
    
    return os.path.join(base_path, 'assets', filename)

def get_desktop_path():
    """Get the actual desktop path, handling OneDrive and other redirections."""
    import winreg
    try:
        # Check User Shell Folders for the actual Desktop location
        key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders")
        path, _ = winreg.QueryValueEx(key, "Desktop")
        winreg.CloseKey(key)
        # Expand environment variables like %USERPROFILE%
        return os.path.expandvars(path)
    except:
        # Fallback to default
        return os.path.join(os.environ['USERPROFILE'], 'Desktop')

def create_desktop_shortcut():
    """Create a desktop shortcut if it doesn't exist."""
    import subprocess
    
    # If running in python environment (not frozen), skip shortcut creation
    if not getattr(sys, 'frozen', False):
        return
        
    exe_path = os.path.abspath(sys.executable)
    desktop = get_desktop_path()
    shortcut_path = os.path.join(desktop, 'SJ Kanban.lnk')
    
    if not os.path.exists(shortcut_path):
        icon_path = get_asset_path('logo.ico')
        # Use PowerShell to create shortcut to avoid extra dependencies
        powershell_cmd = f"$s=(New-Object -COM WScript.Shell).CreateShortcut('{shortcut_path}');$s.TargetPath='{exe_path}';$s.IconLocation='{icon_path}';$s.Save()"
        subprocess.run(['powershell', '-Command', powershell_cmd], capture_output=True)

if __name__ == '__main__':
    # Create desktop shortcut on startup
    create_desktop_shortcut()
    
    api = API()
    
    # Enable debugging during development if needed, disable in production
    html_file = get_asset_path('index.html')
    
    # Create the window
    window = webview.create_window(
        'SJ WorkAssist',
        url=html_file,
        js_api=api,
        width=1200,
        height=800,
        min_size=(800, 600),
        text_select=True,
        background_color='#121212'
    )
    api.set_window(window)
    
    # Start the application
    webview.start(debug=False)

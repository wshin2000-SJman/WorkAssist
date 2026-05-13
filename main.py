import webview
import os
import sys
import logging
from api import API

# Mute pywebview logging to prevent AccessibilityObject recursion crash
logging.getLogger('pywebview').setLevel(logging.CRITICAL)

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
    except Exception:
        # Fallback to default
        return os.path.join(os.environ['USERPROFILE'], 'Desktop')

def create_desktop_shortcut():
    """Create a desktop shortcut, or update it if it points to a different exe."""
    import subprocess
    
    # If running in python environment (not frozen), skip shortcut creation
    if not getattr(sys, 'frozen', False):
        return
        
    exe_path = os.path.abspath(sys.executable)
    desktop = get_desktop_path()
    shortcut_path = os.path.join(desktop, 'WorkAssist.lnk')
    icon_path = get_asset_path('logo.ico')
    
    should_create = False
    
    if not os.path.exists(shortcut_path):
        should_create = True
    else:
        # Check if existing shortcut points to current exe; update if different
        try:
            check_cmd = f"(New-Object -COM WScript.Shell).CreateShortcut('{shortcut_path}').TargetPath"
            result = subprocess.run(['powershell', '-Command', check_cmd], capture_output=True, text=True, timeout=5)
            current_target = result.stdout.strip()
            if current_target.lower() != exe_path.lower():
                should_create = True
        except Exception:
            pass
    
    if should_create:
        powershell_cmd = f"$s=(New-Object -COM WScript.Shell).CreateShortcut('{shortcut_path}');$s.TargetPath='{exe_path}';$s.IconLocation='{icon_path}';$s.Save()"
        subprocess.run(['powershell', '-Command', powershell_cmd], capture_output=True)

if __name__ == '__main__':
    import threading
    # Create desktop shortcut in a background thread to avoid blocking startup
    threading.Thread(target=create_desktop_shortcut, daemon=True).start()
    
    api = API()
    
    # Enable debugging during development if needed, disable in production
    html_file = get_asset_path('index.html')
    
    # Create the window
    window = webview.create_window(
        'WorkAssist',
        url=html_file,
        js_api=api,
        width=1200,
        height=800,
        min_size=(800, 600),
        text_select=True,
        background_color='#121212'
    )
    api.set_window(window)
    
    # Register closing event
    window.events.closing += lambda: api.backup_db('closing')
    
    # Start periodic backup (every 15 minutes)
    def periodic_backup_thread():
        import time
        # Wait for app to settle
        time.sleep(60)
        while True:
            try:
                api.backup_db('periodic')
            except Exception:
                pass
            time.sleep(900)
            
    threading.Thread(target=periodic_backup_thread, daemon=True).start()
    
    # Start the application
    # Let pywebview choose the best GUI engine automatically for better stability
    webview.start(debug=False)

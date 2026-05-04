import webview
import time
import threading
import sys

def test_save(window):
    print("Testing save dialog...")
    try:
        file_types = ('Excel Files (*.xlsx)', 'All files (*.*)')
        result = window.create_file_dialog(
            webview.SAVE_DIALOG, 
            save_filename="Test.xlsx", 
            file_types=file_types
        )
        print("Result:", result)
    except Exception as e:
        print("Exception:", str(e))
    finally:
        window.destroy()

def main():
    window = webview.create_window('Test Dialog', html='<h1>Testing...</h1>')
    
    def on_loaded():
        time.sleep(1)
        test_save(window)
        
    window.events.loaded += on_loaded
    webview.start()

if __name__ == '__main__':
    main()

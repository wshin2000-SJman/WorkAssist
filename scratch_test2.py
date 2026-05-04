import webview
import time
import sys

class Api:
    def set_window(self, window):
        self.window = window

    def test_save(self):
        print("API test_save called from thread!")
        try:
            file_types = ('Excel Files (*.xlsx)', 'All files (*.*)')
            result = self.window.create_file_dialog(
                webview.SAVE_DIALOG, 
                save_filename="Test.xlsx", 
                file_types=file_types
            )
            print("Result:", result)
        except Exception as e:
            print("Exception:", str(e))
        finally:
            self.window.destroy()

api = Api()

def main():
    window = webview.create_window('Test Dialog', html='<h1>Testing...</h1>', js_api=api)
    api.set_window(window)
    
    def on_loaded():
        print("Loaded. Invoking via JS to simulate background thread...")
        window.evaluate_js('window.pywebview.api.test_save()')
        
    window.events.loaded += on_loaded
    webview.start()

if __name__ == '__main__':
    main()

import tkinter as tk
from tkinter import filedialog
import threading
import time

def test_tk_dialog():
    print("Testing tk dialog...")
    root = tk.Tk()
    root.withdraw()
    root.attributes('-topmost', True)
    dest_path = filedialog.asksaveasfilename(
        defaultextension=".xlsx",
        filetypes=[("Excel Files", "*.xlsx"), ("All Files", "*.*")],
        initialfile="Test_TK.xlsx"
    )
    root.destroy()
    print("Result:", dest_path)

def simulate_api_thread():
    time.sleep(1)
    test_tk_dialog()

threading.Thread(target=simulate_api_thread).start()

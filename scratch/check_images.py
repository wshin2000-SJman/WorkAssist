from PIL import Image
import os

assets_dir = r"c:\Users\user\Desktop\Work\SJautomation\Antigravity\SJ_WorkAssist\assets"
images = ["Title IMG_1.png", "Title IMG_2.png", "Title IMG_AUG.png", "Title IMG_DEC.png"]

for img_name in images:
    path = os.path.join(assets_dir, img_name)
    if os.path.exists(path):
        with Image.open(path) as img:
            print(f"{img_name}: {img.size} {img.format}")

from PIL import Image
import os

assets_dir = r"c:\Users\user\Desktop\Work\SJautomation\Antigravity\SJ_WorkAssist\assets"
images = ["Title IMG_1.png", "Title IMG_2.png", "Title IMG_AUG.png", "Title IMG_DEC.png"]

for img_name in images:
    path = os.path.join(assets_dir, img_name)
    if os.path.exists(path):
        with Image.open(path) as img:
            # Maintain aspect ratio
            w_percent = (1200 / float(img.size[0]))
            h_size = int((float(img.size[1]) * float(w_percent)))
            img = img.resize((1200, h_size), Image.Resampling.LANCZOS)
            
            new_name = img_name.replace(".png", ".webp")
            new_path = os.path.join(assets_dir, new_name)
            img.save(new_path, "WEBP", quality=80)
            print(f"Saved {new_name}")
            
            # Delete original
            os.remove(path)
            print(f"Deleted {img_name}")

import os
import glob

# Find Cargo registry directory
cargo_home = os.environ.get("CARGO_HOME", os.path.expanduser("~/.cargo"))
registry_src = os.path.join(cargo_home, "registry", "src")

print(f"Searching in Cargo registry: {registry_src}")

# Search for calamine directory
calamine_dirs = glob.glob(os.path.join(registry_src, "*", "calamine-*"))
if not calamine_dirs:
    print("calamine directory not found in cargo registry.")
else:
    for d in calamine_dirs:
        print(f"Found calamine dir: {d}")
        # Search for as_datetime in .rs files
        for root, dirs, files in os.walk(d):
            for file in files:
                if file.endswith(".rs"):
                    path = os.path.join(root, file)
                    try:
                        with open(path, "r", encoding="utf-8") as f:
                            lines = f.readlines()
                            for idx, line in enumerate(lines):
                                if "as_datetime" in line:
                                    print(f"{os.path.relpath(path, d)}:{idx+1}: {line.strip()}")
                    except Exception as e:
                        pass

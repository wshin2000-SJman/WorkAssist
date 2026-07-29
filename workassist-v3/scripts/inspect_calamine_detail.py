import os

cargo_home = os.environ.get("CARGO_HOME", os.path.expanduser("~/.cargo"))
path = os.path.join(cargo_home, "registry", "src", "index.crates.io-1949cf8c6b5b557f", "calamine-0.26.1", "src", "datatype.rs")

if os.path.exists(path):
    with open(path, "r", encoding="utf-8") as f:
        lines = f.readlines()
        for idx in range(630, 665):
            if idx < len(lines):
                print(f"{idx+1}: {lines[idx].strip()}")
else:
    print(f"File not found: {path}")

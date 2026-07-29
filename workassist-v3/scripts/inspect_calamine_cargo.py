import os

cargo_home = os.environ.get("CARGO_HOME", os.path.expanduser("~/.cargo"))
path = os.path.join(cargo_home, "registry", "src", "index.crates.io-1949cf8c6b5b557f", "calamine-0.26.1", "Cargo.toml")

if os.path.exists(path):
    with open(path, "r", encoding="utf-8") as f:
        print(f.read())
else:
    print(f"File not found: {path}")
